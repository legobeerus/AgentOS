const express = require("express");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require("discord.js");
const config = require("../config");

/**
 * Creates an Express server to handle form submissions from Google Apps Script
 * @param {Client} client - Discord client instance
 * @returns {Express.Application} Express app
 */
function createFormServer(client) {
  const app = express();
  app.use(express.json());

  // Log all incoming requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  /**
   * POST /form-submission
   * Receives form data from Google Apps Script and posts it to Discord
   * Expected body from Google Forms:
   * {
   *   "timestamp": "2024-01-01 12:00:00",
   *   "answers": {
   *     "Question 1": "Answer 1",
   *     "Question 2": "Answer 2"
   *   }
   * }
   */
  app.post("/form-submission", async (req, res) => {
    console.log("📨 Form submission received:", req.body);
    try {
      const { timestamp, answers } = req.body;

      if (!answers || typeof answers !== "object") {
        return res.status(400).json({ error: "Invalid form data: missing or invalid answers" });
      }

      // Use VOTING_CHANNEL_ID from config
      const channelId = config.VOTING_CHANNEL_ID;

      // Fetch the channel
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.error(`Could not fetch channel ${channelId}`);
        return res.status(400).json({ error: "Invalid channel ID or channel is not a text channel" });
      }

      // Convert answers object to fields array
      // We'll split into multiple embeds if needed. Discord embed limits: max 25 fields,
      // field name max 256 chars, value max 1024 chars. Also avoid sending messages
      // over 2000 characters by chunking fields into multiple embeds.
      const MAX_NAME_LEN = 250;
      const MAX_VALUE_LEN = 1000;

      const rawFields = Object.entries(answers).map(([question, answer]) => ({
        name: String(question).slice(0, MAX_NAME_LEN),
        value: String(answer ?? "").slice(0, MAX_VALUE_LEN),
        inline: false
      }));

        // Attempt to extract Roblox username or userId from answers
        let robloxUsername = null;
        let robloxUserId = null;
        for (const [key, value] of Object.entries(answers)) {
          if (/roblox.*username/i.test(key)) robloxUsername = value;
          if (/roblox.*user.?id/i.test(key)) robloxUserId = value;
        }

        // If only username is present, fetch userId
        if (!robloxUserId && robloxUsername) {
          try {
            const userRes = await require("axios").post(
              "https://users.roblox.com/v1/usernames/users",
              { usernames: [robloxUsername], excludeBannedUsers: true }
            );
            if (userRes.data.data[0]) robloxUserId = userRes.data.data[0].id;
          } catch (err) {
            console.warn("Failed to fetch Roblox userId for BGC", err);
          }
        }

        // Prepare BGC info
        let bgcEmbed = null;
        if (robloxUserId) {
          try {
            // Check groups
            const groupsRes = await require("axios").get(
              `https://groups.roblox.com/v2/users/${robloxUserId}/groups/roles`
            );
            const groups = groupsRes.data.data;
            // Hostile/blacklisted group IDs
            const HOSTILE = [34810794, 35686873];
            const BLACKLISTED = [765802690, 16140130];
            const SGC_ID = 6762663;
            let hostileGroups = groups.filter(g => HOSTILE.includes(g.group.id));
            let blacklistedGroups = groups.filter(g => BLACKLISTED.includes(g.group.id));
            let sgc = groups.find(g => g.group.id === SGC_ID);

            bgcEmbed = new (require("discord.js").EmbedBuilder)()
              .setTitle("Background Check")
              .setColor(0x00aff1)
              .setFooter({ text: `User ID: ${robloxUserId}` });

            if (hostileGroups.length)
              bgcEmbed.addFields({ name: "Hostile Factions", value: hostileGroups.map(g => `**${g.group.name}**\nRole: ${g.role.name}\nRank: ${g.role.rank}`).join("\n\n"), inline: false });
            if (blacklistedGroups.length)
              bgcEmbed.addFields({ name: "Blacklisted Groups", value: blacklistedGroups.map(g => `**${g.group.name}**\nRole: ${g.role.name}\nRank: ${g.role.rank}`).join("\n\n"), inline: false });
            if (sgc)
              bgcEmbed.addFields({ name: "SGC Rank", value: `Role: ${sgc.role.name}\nRank: ${sgc.role.rank}`, inline: false });
            if (!hostileGroups.length && !blacklistedGroups.length && !sgc)
              bgcEmbed.setDescription("⚠️ No hostile/blacklisted groups or SGC rank found.");
          } catch (err) {
            bgcEmbed = new (require("discord.js").EmbedBuilder)()
              .setTitle("Background Check")
              .setColor(0xed4245)
              .setDescription("⚠️ Could not fetch group info.");
          }
        }

      // Chunk fields into groups where each embed has at most 25 fields and total
      // approx character length per embed stays under ~1800 characters to avoid
      // hitting message/content limits when rendered.
      const MAX_FIELDS_PER_EMBED = 25;
      const MAX_EMBED_CHARS = 1800;
      const fieldGroups = [];
      let currentGroup = [];
      let currentLen = 0;

      for (const f of rawFields) {
        const fLen = (f.name?.length || 0) + (f.value?.length || 0) + 4; // estimate
        if (currentGroup.length >= MAX_FIELDS_PER_EMBED || (currentLen + fLen) > MAX_EMBED_CHARS) {
          fieldGroups.push(currentGroup);
          currentGroup = [];
          currentLen = 0;
        }
        currentGroup.push(f);
        currentLen += fLen;
      }
      if (currentGroup.length > 0) fieldGroups.push(currentGroup);

      // Prevent spamming too many embeds; cap the number of embeds and note omissions
      const MAX_EMBEDS = 5;
      const omittedEmbeds = fieldGroups.length > MAX_EMBEDS ? fieldGroups.length - MAX_EMBEDS : 0;
      const groupsToSend = omittedEmbeds ? fieldGroups.slice(0, MAX_EMBEDS) : fieldGroups;

      // Prepare base embed meta
      const baseTitle = "Form Submission";
      const baseColor = 0x00aff1;
      const baseTimestamp = timestamp ? new Date(timestamp) : new Date();

      // Build embeds array from groupsToSend
      // Generate a unique application identifier (timestamp or UUID)
      const appId = timestamp ? String(timestamp) : String(Date.now());
      const embeds = groupsToSend.map((group, idx) => {
        const e = new EmbedBuilder()
          .setTitle(idx === 0 ? baseTitle : `${baseTitle} (continued ${idx})`)
          .setColor(baseColor)
          .setTimestamp(baseTimestamp)
          .addFields(group)
          .setFooter({ text: `AppID: ${appId}` });
        return e;
      });

      // If we omitted further groups, append a final note embed
      if (omittedEmbeds > 0) {
        const note = new EmbedBuilder()
          .setTitle(`${baseTitle} (truncated)`)
          .setColor(baseColor)
          .setDescription(`+${omittedEmbeds} additional parts omitted to avoid spamming.`)
          .setTimestamp(baseTimestamp);
        embeds.push(note);
      }

      // Create approve/deny buttons
      const approveButton = new ButtonBuilder()
        .setCustomId("approve")
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success);

      const denyButton = new ButtonBuilder()
        .setCustomId("deny")
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger);

      const components = [new ActionRowBuilder().addComponents(approveButton, denyButton)];

      // Send the embed parts to the channel. Attach buttons only to the first message.
      for (let i = 0; i < embeds.length; i++) {
        const payload = { embeds: [embeds[i]] };
        if (i === 0) {
          payload.components = components;
          if (bgcEmbed) payload.embeds.push(bgcEmbed);
                  if (bgcEmbed) bgcEmbed.setFooter({ text: `AppID: ${appId}` });
        }
        await channel.send(payload).catch(err => console.error("Failed to send embed part:", err));
      }

      console.log("✅ Form posted to Discord successfully.");
      res.status(200).json({ success: true, message: "Form submitted successfully" });
    } catch (error) {
      console.error("Error handling form submission:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Health check endpoint
  app.get("/health", (req, res) => {
    console.log("✅ Health check received");
    res.status(200).json({ status: "ok" });
  });

  // Root endpoint
  app.get("/", (req, res) => {
    res.status(200).json({ message: "Discord bot form server is running" });
  });

  // Catch-all 404 handler
  app.use((req, res) => {
    console.warn(`⚠️ 404: ${req.method} ${req.path} - route not found`);
    res.status(404).json({ error: "Route not found" });
  });

  return app;
}

module.exports = { createFormServer };
