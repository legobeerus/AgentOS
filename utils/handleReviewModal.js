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
  // Look for field names that suggest Discord user ID (flexible matching)
  const idCandidateKeys = [
    "Enter your Discord User ID",
    "User ID",
    "Discord ID",
    "Applicant ID",
    "Discord User ID"
  ];

  let applicantUserId = null;
  console.log("Embed fields available:", embed.fields.map(f => f.name)); // Debug: log all field names

  for (const key of idCandidateKeys) {
    const idField = embed.fields.find(f => f.name && f.name.toLowerCase() === key.toLowerCase());
    if (idField) {
      applicantUserId = idField.value?.toString().trim();
      console.log(`Found user ID field "${key}": ${applicantUserId}`);
      break;
    }
  }

  // Fallback: search for any field with "id" in the name (case-insensitive)
  if (!applicantUserId) {
    const idField = embed.fields.find(f => /\bid\b/i.test(f.name));
    if (idField) {
      applicantUserId = idField.value?.toString().trim();
      console.log(`Found user ID via regex match on "${idField.name}": ${applicantUserId}`);
    }
  }

  // Try to fetch user by ID (most reliable)
  let applicantUser = null;
  let applicantUsername = null; // Define here so it's available throughout the function

  if (applicantUserId) {
    const idMatch = applicantUserId.match(/^<@!?(\d+)>$|^(\d{16,20})$/);
    const userId = idMatch ? (idMatch[1] || idMatch[2]) : applicantUserId;

    try {
      applicantUser = await interaction.client.users.fetch(userId).catch(() => null);
      if (applicantUser) {
        console.log(`Successfully fetched user: ${applicantUser.username} (${applicantUser.id})`);
      } else {
        console.warn(`Could not fetch user by ID ${userId}`);
      }
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
      "Username",
      "Discord User"
    ];

    for (const key of usernameCandidateKeys) {
      const usernameField = embed.fields.find(f => f.name && f.name.toLowerCase() === key.toLowerCase());
      if (usernameField) {
        applicantUsername = usernameField.value?.toString().trim();
        console.log(`Found username field "${key}": ${applicantUsername}`);
        break;
      }
    }

    if (applicantUsername) {
      console.warn(`Falling back to username lookup for: ${applicantUsername}`);
      
      // First try: bot's user cache (may not have user if they haven't interacted recently)
      applicantUser = interaction.client.users.cache.find(u => u.username === applicantUsername);
      
      // Second try: search guild members (more reliable for guild-specific users)
      if (!applicantUser && interaction.guild) {
        try {
          const guildMembers = await interaction.guild.members.fetch().catch(() => null);
          if (guildMembers) {
            const member = guildMembers.find(m => m.user.username === applicantUsername);
            if (member) {
              applicantUser = member.user;
              console.log(`Found user in guild members: ${applicantUser.username} (${applicantUser.id})`);
            }
          }
        } catch (err) {
          console.warn("Could not fetch guild members:", err);
        }
      }
      
      if (!applicantUser) {
        console.warn(`Could not resolve username ${applicantUsername} to a user`);
      }
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

  // Log the decision to LOG_CHANNEL_ID and delete from voting channel to keep it clean
  try {
    const logChannelId = config.LOG_CHANNEL_ID;
    if (logChannelId) {
      const logChannel = await interaction.client.channels.fetch(logChannelId).catch(() => null);
      if (logChannel && (logChannel.type === ChannelType.GuildText || logChannel.type === 0)) {
        // Send the final decision embed to the log channel
        const logEmbed = new EmbedBuilder(updatedEmbed)
          .setFooter({ text: `Decision logged by ${interaction.user.username}` });
        
        await logChannel.send({ embeds: [logEmbed] }).catch(err => {
          console.error("Failed to post to log channel:", err);
        });

        // Delete the original message from voting channel to keep it clean
        await message.delete().catch(err => {
          console.error("Failed to delete original voting message:", err);
        });
      } else {
        console.warn(`Log channel ${logChannelId} not found or not a text channel`);
      }
    }
  } catch (err) {
    console.error("Error archiving decision to log channel:", err);
  }

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