/**
 * Handles modal submission for review feedback
 * @param {ModalSubmitInteraction} interaction - The modal submission interaction
 */
async function handleReviewModal(interaction) {
  if (!interaction.customId.startsWith("feedback_")) return;

  // customId format: feedback_<approve|deny>_<messageId>
  const parts = interaction.customId.split("_");
  const action = parts[1];
  const messageId = parts.slice(2).join("_");
  const approved = action === "approve";
  const feedback = interaction.fields.getTextInputValue("feedback");

  // Try to fetch the original message using the messageId embedded in the modal id
  let message;
  try {
    message = await interaction.channel.messages.fetch(messageId);
  } catch (err) {
    console.error("Could not fetch original message for review modal:", err);
    await interaction.reply({ content: "⚠️ Could not find the original message to update.", ephemeral: true });
    return;
  }

  const embed = message.embeds[0];
  const config = require("../config");
  const { EmbedBuilder, ChannelType } = require("discord.js");

  if (!embed) {
    console.error("No embed found in the message");
    await interaction.reply({ content: "⚠️ Could not find embed in message.", ephemeral: true });
    return;
  }

  // Extract applicant user ID from embed fields (priority: user ID, then fallback to username)
  // Look for field names that suggest Discord user ID
  const idCandidateKeys = [
    "Enter your Discord User ID",
    "User ID",
    "Discord ID",
    "Applicant ID"
  ];

  let applicantUserId = null;
  for (const key of idCandidateKeys) {
    const idField = embed.fields.find(f => f.name && f.name.toLowerCase() === key.toLowerCase());
    if (idField) {
      applicantUserId = idField.value?.toString().trim();
      break;
    }
  }

  // Try to fetch user by ID (most reliable)
  let applicantUser = null;
  if (applicantUserId) {
    const idMatch = applicantUserId.match(/^<@!?(\d+)>$|^(\d{16,20})$/);
    const userId = idMatch ? (idMatch[1] || idMatch[2]) : applicantUserId;

    try {
      applicantUser = await interaction.client.users.fetch(userId).catch(() => null);
    } catch (err) {
      console.warn(`Could not fetch user by ID ${userId}:`, err);
    }
  }

  // Fallback: try to find by username if ID lookup failed (not recommended, but kept as backup)
  if (!applicantUser) {
    const usernameCandidateKeys = [
      "Enter your Discord Username (not your display name)",
      "Discord Username",
      "Applicant",
      "Username"
    ];

    let applicantUsername = null;
    for (const key of usernameCandidateKeys) {
      const usernameField = embed.fields.find(f => f.name && f.name.toLowerCase() === key.toLowerCase());
      if (usernameField) {
        applicantUsername = usernameField.value?.toString().trim();
        break;
      }
    }

    if (applicantUsername) {
      console.warn(`Falling back to username lookup for: ${applicantUsername}`);
      applicantUser = interaction.client.users.cache.find(u => u.username === applicantUsername);
    }
  }

  // Update embed
  const updatedEmbed = {
    ...embed.data,
    color: approved ? 0x57F287 : 0xED4245,
    fields: [
      ...embed.fields,
      {
        name: "Result",
        value: approved ? "✅ Approved" : "❌ Denied",
        inline: true
      },
      {
        name: "Feedback",
        value: feedback,
        inline: false
      }
    ]
  };

  await message.edit({
    embeds: [updatedEmbed],
    components: []
  }).catch(err => {
    console.error("Failed to edit message:", err);
  });

  // Post compact result to configured RESULT_CHANNEL_ID (no application contents)
  try {
    const resultChannelId = config.RESULT_CHANNEL_ID;
    if (resultChannelId) {
      const resultChannel = await interaction.client.channels.fetch(resultChannelId).catch(() => null);
      if (resultChannel && (resultChannel.type === ChannelType.GuildText || resultChannel.type === 0)) {
        const applicantDisplay = applicantUsername || "Unknown";
        const resultEmbed = new EmbedBuilder()
          .setTitle("OSI Application Result")
          .setColor(0x00aff1)
          .addFields(
            { name: "Applicant", value: applicantDisplay, inline: true },
            { name: "Result", value: approved ? "✅ Approved" : "❌ Denied", inline: true },
            { name: "Feedback", value: feedback || "(no feedback)", inline: false }
          )
          .setTimestamp(new Date());

        // Add note if approved
        if (approved) {
          resultEmbed.addFields({
            name: "Notice",
            value: "Expect to be DMed with further instructions shortly",
            inline: false
          });
        }

        const mention = applicantUser ? `<@${applicantUser.id}>` : applicantDisplay;
        await resultChannel.send({ content: `${mention}`, embeds: [resultEmbed] });
      } else {
        console.warn(`Result channel ${resultChannelId} not found or not a text channel`);
      }
    }
  } catch (err) {
    console.error("Failed to post result to result channel:", err);
  }

  await interaction.reply({
    content: "✅ Decision recorded.",
    ephemeral: true
  });
}

module.exports = { handleReviewModal };