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

  // Extract applicant username
  const applicantField = embed.fields.find(f => f.name === "Enter your Discord Username (not your display name)");
  const applicantUsername = applicantField?.value;

  // Try to find the user
  let applicantUser = null;
  if (applicantUsername) {
    // First try: exact username match (modern Discord)
    applicantUser = interaction.client.users.cache.find(
      u => u.username === applicantUsername
    );

    // Fallback: try username#discriminator format (legacy Discord)
    if (!applicantUser && applicantUsername.includes("#")) {
      applicantUser = interaction.client.users.cache.find(
        u => `${u.username}#${u.discriminator}` === applicantUsername
      );
    }

    if (!applicantUser) {
      console.warn(`Could not find user in cache: ${applicantUsername}`);
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