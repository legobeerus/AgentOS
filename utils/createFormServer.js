const express = require("express");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require("discord.js");
const config = require("../config");
const { hasUsername } = require("../utils/blacklistStore");

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
    if (!client || !client.user) {
      console.warn("Bot not ready yet - rejecting form submission");
      return res.status(503).json({ error: "Bot not ready" });
    }
    try {
      const { timestamp, answers } = req.body;

      if (!answers || typeof answers !== "object") {
        return res.status(400).json({ error: "Invalid form data: missing or invalid answers" });
      }

      // Use VOTING_CHANNEL_ID from config
      const channelId = config.VOTING_CHANNEL_ID;

      // Fetch the channel
      const channel = await client.channels.fetch(channelId).catch(err => {
        console.error(`Error fetching channel ${channelId}:`, err);
        return null;
      });
      if (!channel) {
        console.error(`Could not fetch channel ${channelId}`);
        return res.status(400).json({ error: "Invalid channel ID or channel not accessible" });
      }
      if (channel.type !== ChannelType.GuildText) {
        console.error(`Channel ${channelId} is not a GuildText channel (type=${channel.type})`);
        return res.status(400).json({ error: "Channel is not a text channel" });
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

        // (suspensions mini-search moved below so username-only searches run)
        // Fallback: find a generic username field (avoid Discord username)
        if (!robloxUsername) {
          const usernameEntry = Object.entries(answers).find(([key]) => /username/i.test(key) && !/discord/i.test(key));
          if (usernameEntry) robloxUsername = usernameEntry[1];
        }

        // Block submissions from blacklisted usernames and DM applicant if possible
        if (robloxUsername && await hasUsername(robloxUsername)) {
          let applicantDiscordId = null;
          let applicantDiscordUsername = null;
          const discordIdKeys = [
            "Enter your Discord User ID",
            "Discord User ID",
            "Discord ID",
            "User ID",
            "Applicant ID"
          ];
          const discordUsernameKeys = [
            "Enter your Discord Username (not your display name)",
            "Discord Username",
            "Discord User",
            "Username",
            "Applicant"
          ];

          for (const [key, value] of Object.entries(answers)) {
            if (!applicantDiscordId && discordIdKeys.some(k => k.toLowerCase() === String(key).toLowerCase())) {
              applicantDiscordId = String(value || "").trim();
            }
            if (!applicantDiscordUsername && discordUsernameKeys.some(k => k.toLowerCase() === String(key).toLowerCase())) {
              applicantDiscordUsername = String(value || "").trim();
            }
          }

          if (applicantDiscordId) {
            const idMatch = applicantDiscordId.match(/^<@!?([0-9]+)>$|^([0-9]{16,20})$/);
            applicantDiscordId = idMatch ? (idMatch[1] || idMatch[2]) : applicantDiscordId;
          }

          try {
            let userToDm = null;
            if (applicantDiscordId) {
              userToDm = await client.users.fetch(applicantDiscordId).catch(() => null);
            }

            if (!userToDm && applicantDiscordUsername && channel.guild) {
              const cachedMember = channel.guild.members.cache.find(m => m.user.username === applicantDiscordUsername);
              if (cachedMember) userToDm = cachedMember.user;
            }

            if (!userToDm && applicantDiscordUsername && channel.guild) {
              const members = await channel.guild.members.fetch().catch(() => null);
              if (members) {
                const member = members.find(m => m.user.username === applicantDiscordUsername);
                if (member) userToDm = member.user;
              }
            }

            if (userToDm) {
              await userToDm.send(
                `Your application was not sent because the Roblox username "${robloxUsername}" is blacklisted.`
              ).catch(() => null);
            }
          } catch (err) {
            console.warn("Failed to DM blacklisted applicant:", err);
          }

          console.warn(`Blocked application from blacklisted username: ${robloxUsername}`);
          return res.status(200).json({ success: false, message: "Blocked by blacklist" });
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

            // Optionally check a configured Google Sheet for matching entries
            let sheetMatches = [];
            try {
              const {
                GOOGLE_SHEET_ID,
                GOOGLE_SHEETS_API_KEY,
                GOOGLE_SHEETS_RANGE,
                GOOGLE_SERVICE_ACCOUNT_JSON,
                GOOGLE_SERVICE_ACCOUNT_PATH,
                GOOGLE_SHEET_NAME_COL,
                GOOGLE_SHEET_TYPE_COL
              } = require("../config");

              const range = GOOGLE_SHEETS_RANGE || 'Sheet1!A:C';
              let rows = [];

              if (GOOGLE_SHEET_ID && GOOGLE_SHEETS_API_KEY) {
                const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?key=${GOOGLE_SHEETS_API_KEY}`;
                const sheetRes = await require("axios").get(url);
                rows = sheetRes.data.values || [];
              } else if (GOOGLE_SHEET_ID && (GOOGLE_SERVICE_ACCOUNT_JSON || GOOGLE_SERVICE_ACCOUNT_PATH)) {
                try {
                  const { google } = require('googleapis');
                  let keyObj = null;

                  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
                    try {
                      keyObj = typeof GOOGLE_SERVICE_ACCOUNT_JSON === 'string' ? JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON) : GOOGLE_SERVICE_ACCOUNT_JSON;
                    } catch (e) {
                      keyObj = GOOGLE_SERVICE_ACCOUNT_JSON;
                    }
                  } else if (GOOGLE_SERVICE_ACCOUNT_PATH) {
                    const fs = require('fs');
                    const p = GOOGLE_SERVICE_ACCOUNT_PATH;
                    keyObj = JSON.parse(fs.readFileSync(p, 'utf8'));
                  }

                  if (!keyObj) throw new Error('No Google service account credentials available');

                  const jwt = new google.auth.JWT({
                    email: keyObj.client_email,
                    key: keyObj.private_key,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
                  });
                  await jwt.authorize();
                  const sheets = google.sheets({ version: 'v4', auth: jwt });
                  const sheetRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range });
                  rows = (sheetRes && sheetRes.data && sheetRes.data.values) || [];
                } catch (err) {
                  console.warn('Google Sheets service account fetch failed:', err);
                }
              }

              const nameIndex = Number.isFinite(Number(GOOGLE_SHEET_NAME_COL)) ? Number(GOOGLE_SHEET_NAME_COL) : 0;
              const typeIndex = Number.isFinite(Number(GOOGLE_SHEET_TYPE_COL)) ? Number(GOOGLE_SHEET_TYPE_COL) : 1;

              for (const row of rows) {
                const rowStr = row.join(' | ');
                const nameCell = String(row[nameIndex] || '').trim();
                const typeCell = String(row[typeIndex] || '').trim() || 'unknown';

                const matchesName = robloxUsername && (
                  (nameCell && nameCell.toLowerCase().includes(String(robloxUsername).toLowerCase())) ||
                  String(rowStr).toLowerCase().includes(String(robloxUsername).toLowerCase())
                );
                const matchesId = robloxUserId && String(rowStr).includes(String(robloxUserId));

                if (matchesName || matchesId) {
                  const displayName = nameCell || rowStr;
                  sheetMatches.push(`${displayName} | ${typeCell}`);
                }
              }
            } catch (err) {
              console.warn("Failed to query Google Sheets for BGC:", err);
            }

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

            // Add Google Sheets matches to the embed if any were found
            if (sheetMatches.length) {
              const maxShow = 5;
              const shown = sheetMatches.slice(0, maxShow).map(s => `• ${s}`).join('\n');
              const more = sheetMatches.length > maxShow ? `\n+${sheetMatches.length - maxShow} more` : '';
              bgcEmbed.addFields({ name: "⚠️ Blacklist Roster Matches", value: `${shown}${more}`, inline: false });
            }
            // account age will be added after suspensions search so it appears last

            // (suspensions mini-search moved below so username-only searches run)
          } catch (err) {
            bgcEmbed = new (require("discord.js").EmbedBuilder)()
              .setTitle("Background Check")
              .setColor(0xed4245)
              .setDescription("⚠️ Could not fetch group info.");
          }
        }

        // Mini suspensions board search (run after robloxUsername/robloxUserId are resolved)
        try {
          const BOARD_ID = (config && config.TRELLO_SUSPENSIONS_BOARD_ID) ? config.TRELLO_SUSPENSIONS_BOARD_ID : process.env.TRELLO_SUSPENSIONS_BOARD_ID;
          const TRELLO_KEY = process.env.TRELLO_KEY;
          const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
          if (BOARD_ID && TRELLO_KEY && TRELLO_TOKEN && (robloxUsername || robloxUserId)) {
            const cardsRes = await require('axios').get(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
              params: { key: TRELLO_KEY, token: TRELLO_TOKEN, fields: 'name,desc,url,labels' }
            });
            const cards = Array.isArray(cardsRes.data) ? cardsRes.data : [];
            const qName = (String(robloxUsername || '')).toLowerCase();
            const qId = robloxUserId ? String(robloxUserId) : '';
            const matches = cards.filter(c => {
              const hay = `${String(c.name||'')}\n${String(c.desc||'')}`.toLowerCase();
              if (qName && hay.includes(qName)) return true;
              if (qId && (String(c.name||'').includes(qId) || String(c.desc||'').includes(qId))) return true;
              return false;
            });
            if (matches.length) {
              if (!bgcEmbed) {
                bgcEmbed = new EmbedBuilder().setTitle('Background Check').setColor(0x00aff1).setFooter({ text: robloxUserId ? `User ID: ${robloxUserId}` : `User: ${robloxUsername}` });
              }
              const maxShow = 6;
              const shown = matches.slice(0, maxShow).map(c => {
                const labels = Array.isArray(c.labels) ? c.labels.map(l => l.name).filter(Boolean).join(', ') : '';
                const labelPart = labels ? ` — ${labels}` : '';
                return `• [${String(c.name || 'untitled')}](${c.url})${labelPart}`;
              }).join('\n');
              const more = matches.length > maxShow ? `\n+${matches.length - maxShow} more` : '';
              const value = (shown + more).slice(0, 1000);
              bgcEmbed.addFields({ name: 'Suspensions Board Search Results', value, inline: false });
            }
          }
        } catch (err) {
          console.warn('Suspensions board mini-search failed:', err?.message || err);
        }

        // Add account creation date / age as the final BGC field
        try {
          if (robloxUserId) {
            const userInfoRes = await require('axios').get(`https://users.roblox.com/v1/users/${robloxUserId}`);
            const userInfo = userInfoRes.data || {};
            if (userInfo.created) {
              const created = new Date(userInfo.created);
              const now = new Date();
              const ageDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
              const ageYears = (ageDays / 365).toFixed(2);
              const createdStr = created.toISOString().split('T')[0];
              if (!bgcEmbed) bgcEmbed = new EmbedBuilder().setTitle('Background Check').setColor(0x00aff1).setFooter({ text: robloxUserId ? `User ID: ${robloxUserId}` : `User: ${robloxUsername}` });
              bgcEmbed.addFields({ name: 'Account Age', value: `${createdStr} — ${ageDays} day(s) (~${ageYears} years)`, inline: false });
            }
          }
        } catch (err) {
          // ignore account age errors
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
        try {
          const sent = await channel.send(payload);
          console.log(`Sent embed part ${i} to channel ${channelId} (message id: ${sent.id})`);
        } catch (err) {
          console.error(`Failed to send embed part ${i} to channel ${channelId}:`, err);
        }
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
