/**
 * Handles modal submission for review feedback
 * @param {ModalSubmitInteraction} interaction - The modal submission interaction
 */
async function handleReviewModal(interaction) {
  if (!interaction.customId.startsWith("feedback_")) return;
  // Prevent double-processing the same review (debounce window)
  if (!global._processedReviewIds) global._processedReviewIds = new Set();
  const processedSet = global._processedReviewIds;

  // customId format: feedback_<approve|deny>_<messageId>
  const parts = interaction.customId.split("_");
  const action = parts[1];
  const messageId = parts.slice(2).join("_");
  const approved = action === "approve";
  const feedback = interaction.fields.getTextInputValue("feedback");

  // Defer reply to avoid "Unknown interaction" while we do work
  try { await interaction.deferReply({ ephemeral: true }); } catch (e) {}

  // Try to fetch the original message using the messageId embedded in the modal id
  let message;
  // Debounce: if we've processed this message recently, ignore duplicate submission
  if (processedSet.has(messageId)) {
    try { await interaction.editReply({ content: "⚠️ This review was already processed." }); } catch (e) { try { await interaction.followUp({ content: "⚠️ This review was already processed.", ephemeral: true }); } catch (_) {} }
    return;
  }
  // Mark as processing immediately to avoid race conditions
  try { processedSet.add(messageId); setTimeout(() => processedSet.delete(messageId), 10000); } catch (e) {}
  try {
    message = await interaction.channel.messages.fetch(messageId);
  } catch (err) {
    console.error("Could not fetch original message for review modal:", err);
    try { await interaction.editReply({ content: "⚠️ Could not find the original message to update." }); } catch (e) { try { await interaction.followUp({ content: "⚠️ Could not find the original message to update.", ephemeral: true }); } catch (_) {} }
    return;
  }

  const embed = message.embeds[0];
  const config = require("../config");
  const { EmbedBuilder, ChannelType } = require("discord.js");

  if (!embed) {
    console.error("No embed found in the message");
    try { await interaction.editReply({ content: "⚠️ Could not find embed in message." }); } catch (e) { try { await interaction.followUp({ content: "⚠️ Could not find embed in message.", ephemeral: true }); } catch (_) {} }
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
        applicantUsername = applicantUser.tag || applicantUser.username;
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
              applicantUsername = applicantUser.tag || applicantUser.username;
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

  // Add reviewer info to footer while preserving any existing footer/AppID
  try {
    const existingFooter = embed.footer && embed.footer.text ? embed.footer.text : '';
    const reviewerText = `Reviewed by ${interaction.user.tag}`;
    const footerText = existingFooter ? `${existingFooter} • ${reviewerText}` : reviewerText;
    updatedEmbed.footer = { text: footerText };
  } catch (e) {
    // ignore footer build errors
  }

  // Delete excess embeds if present (for long applications)
  // Always replace with only the updated embed and clear components
  // We'll collect any continued embeds across messages that share the same AppID
  // so the log contains the full application. Fetch them before we delete messages.
  const appId = embed.footer?.text?.includes("AppID:") ? embed.footer.text.split("AppID:")[1].trim() : null;

  // We'll fetch related messages (by AppID) before deleting them so we can archive
  // the full application including continued parts. Then update the original
  // voting message to show the decision.

  // Log the decision to LOG_CHANNEL_ID and delete from voting channel to keep it clean
  try {
    const logChannelId = config.LOG_CHANNEL_ID;
    if (logChannelId) {
      const logChannel = await interaction.client.channels.fetch(logChannelId).catch(() => null);
      if (logChannel && (logChannel.type === ChannelType.GuildText || logChannel.type === 0)) {
        // Collect application parts across messages that match AppID (if available)
        const embedsData = [];
        if (appId) {
          try {
            const recent = await interaction.channel.messages.fetch({ limit: 100 });
            const matched = recent.filter(m => m.embeds && m.embeds.some(e => e.footer && e.footer.text && e.footer.text.includes(`AppID: ${appId}`)));
            const sorted = matched.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const m of sorted.values()) {
              for (const e of m.embeds) {
                const data = (e && e.data) ? e.data : e;
                embedsData.push(data);
              }
            }
          } catch (err) {
            console.warn("Failed to fetch related messages for AppID collection:", err);
          }
        }

        // Now update the original voting message (show decision) after collecting data
        await message.edit({ embeds: [updatedEmbed], components: [] }).catch(err => {
          console.error("Failed to edit message:", err);
        });

        // Replace the main application embed (first occurrence of "Form Submission") with updatedEmbed
        let replaced = false;
        const normalizedTitle = (embed.data && embed.data.title) ? String(embed.data.title).toLowerCase() : '';
        const logEmbeds = [];
        for (let i = 0; i < embedsData.length; i++) {
          const d = embedsData[i];
          const title = d && d.title ? String(d.title).toLowerCase() : '';
          const isApplicationPart = title.startsWith('form submission');
          const isBGC = (d && d.title && /background check/i.test(d.title)) || (d && d.footer && d.footer.text && /user id/i.test(d.footer.text));
          if (!replaced && isApplicationPart) {
            try { logEmbeds.push(new EmbedBuilder(updatedEmbed).setFooter({ text: `Decision logged by ${interaction.user.tag}` })); } catch (e) {}
            replaced = true;
          } else {
            try {
              const eb = new EmbedBuilder(d);
              if (isApplicationPart || isBGC) eb.setColor(approved ? 0x57F287 : 0xED4245);
              logEmbeds.push(eb);
            } catch (e) {}
          }
        }
        // If no matched embeds found, just send the updated embed
        if (!replaced) {
          try { logEmbeds.unshift(new EmbedBuilder(updatedEmbed).setFooter({ text: `Decision logged by ${interaction.user.tag}` })); } catch (e) {}
        }

        // Respect embed limits (Discord allows up to 10 embeds per message)
        const toSend = logEmbeds.slice(0, 10);
        await logChannel.send({ embeds: toSend }).catch(err => {
          console.error("Failed to post to log channel:", err);
        });
        // Identify application ID from embed footer
        if (appId) {
          // Fetch recent messages in the channel and delete all with matching AppID
          const messages = await interaction.channel.messages.fetch({ limit: 50 });
          const toDelete = messages.filter(m => m.embeds.some(e => e.footer && e.footer.text && e.footer.text.includes(`AppID: ${appId}`)));
          for (const msg of toDelete.values()) {
            if (msg.id !== message.id) {
              await msg.delete().catch(err => {
                console.error("Failed to delete excess embed message:", err);
              });
            }
          }
        }
        // Delete the original message from voting channel to keep it clean
        await message.delete().catch(err => {
          console.error("Failed to delete original voting message:", err);
        });
      } else {
        console.warn(`Log channel ${logChannelId} not found or not a text channel`);
      }
    }
  } catch (err) {
    console.error("Error archiving decision to log channel or cleaning up excess embeds:", err);
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
        // Add reviewer footer to the compact result
        try {
          resultEmbed.setFooter({ text: `Reviewed by ${interaction.user.tag}` });
        } catch (e) {}
        const mention = applicantUser ? `<@${applicantUser.id}>` : applicantDisplay;
        await resultChannel.send({ content: `${mention}`, embeds: [resultEmbed] });
      } else {
        console.warn(`Result channel ${resultChannelId} not found or not a text channel`);
      }
    }
  } catch (err) {
    console.error("Failed to post result to result channel:", err);
  }

  // If approved, try to create a one-time 24h invite and DM the applicant.
  if (approved) {
    try {
      // Compute a helpful message link for context
      const messageLink = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${message.id}`;

      if (!applicantUser) {
        // Notify staff that we couldn't resolve the user to DM. Use DM_FAIL_CHANNEL_ID if configured,
        // otherwise fall back to LOG_CHANNEL_ID then RESULT_CHANNEL_ID.
        const notifyChannelId = config.DM_FAIL_CHANNEL_ID || config.LOG_CHANNEL_ID || config.RESULT_CHANNEL_ID;
        const notifyChannel = await interaction.client.channels.fetch(notifyChannelId).catch(() => null);
        if (notifyChannel) {
          await notifyChannel.send({ content: `⚠️ Could not resolve applicant to a Discord user to DM for approval. Applicant: ${applicantUsername || "Unknown"}. Please contact them manually. Message: ${messageLink}` }).catch(() => null);
        }
      } else {
        // Determine channel to create invite in
        let inviteChannel = null;
        if (config.INVITE_CHANNEL_ID) {
          inviteChannel = await interaction.client.channels.fetch(config.INVITE_CHANNEL_ID).catch(() => null);
        }
        if (!inviteChannel) inviteChannel = interaction.channel;

        // Create a single-use, 24-hour invite
        const invite = await inviteChannel.createInvite({ maxAge: 24 * 3600, maxUses: 1, unique: true, reason: `Invite for approved applicant ${applicantUsername || applicantUser.tag}` });

        // DM the applicant with the invite
        const dmContent = `Your OSI application has been approved. You must send a request to join the group, and join the server linked. Once you have joined, read the guidelines and begin the Academy.This invite will remain valid for 24 hours: ${invite.url}`;
        await applicantUser.send({ content: dmContent }).catch(async (err) => {
          // If DM fails, notify staff in a configured notify channel (see above fallback order)
          console.error("Failed to DM applicant:", err);
          const notifyChannelId = config.DM_FAIL_CHANNEL_ID || config.LOG_CHANNEL_ID || config.RESULT_CHANNEL_ID;
          const notifyChannel = await interaction.client.channels.fetch(notifyChannelId).catch(() => null);
          if (notifyChannel) {
            await notifyChannel.send({ content: `⚠️ Failed to DM approved user <@${applicantUser.id}>. Please contact them manually. Message: ${messageLink}` }).catch(() => null);
          }
        });
      }
    } catch (err) {
      console.error("Error creating invite or sending DM:", err);
    }
  }

  try { await interaction.editReply({ content: "✅ Decision recorded" }); } catch (e) { try { await interaction.followUp({ content: "✅ Decision recorded", ephemeral: true }); } catch (_) {} }
}

module.exports = { handleReviewModal };