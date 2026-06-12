const express = require("express");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require("discord.js");
const config = require("../config");
const arrestStore = require('./arrestStore');
const verificationStore = require('./verificationStore');
const axios = require('axios');
const { findBlacklistEntry } = require("../utils/blacklistSheet");
const { isSpamAnswers } = require("./spamFilter");

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
    console.debug && console.debug(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
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
    console.debug && console.debug("📨 Form submission received:", req.body);
    if (!client || !client.user) {
      console.warn("Bot not ready yet - rejecting form submission");
      return res.status(503).json({ error: "Bot not ready" });
    }
    try {
      const { timestamp, answers } = req.body;

      if (!answers || typeof answers !== "object") {
        return res.status(400).json({ error: "Invalid form data: missing or invalid answers" });
      }

      // Anti-spam: detect repeated-word spam or mostly-minimal answers
      try {
        if (isSpamAnswers(answers)) {
          console.warn("Blocked application: detected spam-like answers", answers);
          return res.status(200).json({ success: false, message: "Blocked by spam filter" });
        }
      } catch (err) {
        console.warn("Spam filter check failed, continuing:", err);
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

        // Block submissions based on blacklist sheet entries and DM applicant if possible
        if (robloxUsername) {
          try {
            const entry = await findBlacklistEntry({ robloxUsername, robloxUserId });
            if (entry) {
              // Found a blocking blacklist entry (temporary/permanent)
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
                  const notifyMsg = `Your application was not sent, as the username "${robloxUsername}" is blacklisted. Your blacklist is ${entry.type} and ends at ${entry.endDate || '(no end date listed)'}, the reason is listed as: "${entry.reason || '(no reason provided)'}"`;
                  await userToDm.send(notifyMsg).catch(() => null);
                }
              } catch (err) {
                console.warn("Failed to DM blacklisted applicant:", err);
              }

              console.warn(`Blocked application from blacklisted username: ${robloxUsername} — ${entry.type}`);
              return res.status(200).json({ success: false, message: "Blocked by blacklist" });
            }
          } catch (err) {
            console.warn('Blacklist sheet lookup failed, continuing with application flow:', err);
          }
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
            const HOSTILE = [35686873];
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

        // Mini arrest-log DB search (run after robloxUsername/robloxUserId are resolved)
        try {
          // If we only have a userId, try to resolve the username so DB lookups succeed
          if (!robloxUsername && robloxUserId) {
            try {
              const userInfoRes = await require('axios').get(`https://users.roblox.com/v1/users/${robloxUserId}`);
              const userInfo = userInfoRes.data || {};
              // older API uses 'name' while some responses use 'username'
              robloxUsername = userInfo.name || userInfo.username || robloxUsername;
            } catch (e) {
              // ignore resolution errors and continue — arrest lookup will simply skip
            }
          }

          if (robloxUsername) {
            const arrests = await arrestStore.getArrestsByRoblox(String(robloxUsername).trim()).catch(() => []);
            if (arrests && arrests.length) {
              if (!bgcEmbed) bgcEmbed = new EmbedBuilder().setTitle('Background Check').setColor(0x00aff1).setFooter({ text: robloxUserId ? `User ID: ${robloxUserId}` : `User: ${robloxUsername}` });
              const maxShowA = 6;
              const shownA = arrests.slice(0, maxShowA).map(a => {
                const idPart = a.id ? `ID ${a.id}` : '';
                const laws = a.charges || a.incident_summary || a.sentence || '(no laws listed)';
                return `• ${idPart} — ${String(laws).slice(0, 200)}`;
              }).join('\n');
              const moreA = arrests.length > maxShowA ? `\n+${arrests.length - maxShowA} more` : '';
              const valueA = (shownA + moreA).slice(0, 1000);
              bgcEmbed.addFields({ name: 'Arrest Log Search Results', value: valueA, inline: false });
            }
          }
        } catch (err) {
          console.warn('Arrest log mini-search failed:', err?.message || err);
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
              const ts = Math.floor(created.getTime() / 1000);
              if (!bgcEmbed) bgcEmbed = new EmbedBuilder().setTitle('Background Check').setColor(0x00aff1).setFooter({ text: robloxUserId ? `User ID: ${robloxUserId}` : `User: ${robloxUsername}` });
              bgcEmbed.addFields({ name: 'Account Age', value: `<t:${ts}:f> — ${ageDays} day(s) (~${ageYears} years)`, inline: false });
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
          console.debug && console.debug(`Sent embed part ${i} to channel ${channelId} (message id: ${sent.id})`);
        } catch (err) {
          console.error(`Failed to send embed part ${i} to channel ${channelId}:`, err);
        }
      }
      console.info("✅ Form posted to Discord successfully.");
      res.status(200).json({ success: true, message: "Form submitted successfully" });
    } catch (error) {
      console.error("Error handling form submission:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Health check endpoint
  app.get("/health", (req, res) => {
    console.debug && console.debug("✅ Health check received");
    res.status(200).json({ status: "ok" });
  });

  // Root endpoint
  app.get("/", (req, res) => {
    res.status(200).json({ message: "Discord bot form server is running" });
  });

  // --- Exam web grading endpoints ---
  const examStore = require('./examStore');
  const { processGrade } = require('./handleExamGrade');

  // Auth middleware: accept either EXAM_REVIEW_SECRET or a Discord OAuth access token
  async function requireExamAuth(req, res, next) {
    const secret = config.EXAM_REVIEW_SECRET;
    const auth = (req.get('authorization') || '').trim();
    console.debug && console.debug(`requireExamAuth: incoming auth header present=${!!auth}, x-discord-token present=${!!req.get('x-discord-token')}`);
    if (secret && auth === `Bearer ${secret}`) {
      req.reviewer = { tag: 'web' };
      return next();
    }

    // Try Discord OAuth token in header 'x-discord-token'
    const discordToken = req.get('x-discord-token') || req.body?.discord_token;
    if (!discordToken) return res.status(401).json({ error: 'Unauthorized' });

    try {
      // Get user info from Discord
      const u = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${discordToken}` } });
      const user = u && u.data ? u.data : null;
      console.debug && console.debug('requireExamAuth: discord /users/@me returned', user ? { id: user.id, username: user.username } : 'no-user');
      if (!user) return res.status(401).json({ error: 'Invalid Discord token' });

      // Verify guild membership and role
      const guildId = config.EXAM_GUILD_ID;
      const requiredRole = config.EXAM_AUTH_ROLE_ID;
      if (!guildId || !requiredRole) {
        console.error('requireExamAuth: EXAM_GUILD_ID or EXAM_AUTH_ROLE_ID not configured', { EXAM_GUILD_ID: config.EXAM_GUILD_ID, EXAM_AUTH_ROLE_ID: config.EXAM_AUTH_ROLE_ID });
        return res.status(403).json({ error: 'Server not configured for role verification' });
      }
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      console.debug && console.debug('requireExamAuth: fetched guild', guild ? guild.id : null);
      if (!guild) return res.status(403).json({ error: 'Bot not in configured guild' });
      const member = await guild.members.fetch(user.id).catch(() => null);
      console.debug && console.debug('requireExamAuth: fetched member', member ? member.user.tag : null);
      if (!member) return res.status(403).json({ error: 'User not a guild member' });
      if (!member.roles.cache.has(requiredRole)) return res.status(403).json({ error: 'Insufficient role' });

      req.reviewer = { id: user.id, tag: `${user.username}#${user.discriminator}` };
      return next();
    } catch (e) {
      console.error('Exam auth failed:', e?.response?.data || e.message || e);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  app.get('/exams/pending', requireExamAuth, (req, res) => {
    try {
      console.info && console.info(`GET /exams/pending requested by reviewer=${req.reviewer ? req.reviewer.tag : 'unknown'}`);
      const list = examStore.listActiveSessions().map(s => ({ id: s.id, examId: s.examId, userId: s.userId, createdAt: s.createdAt, status: s.status }));
      res.json(list);
    } catch (e) {
      console.error('Failed to list pending exams:', e);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/exams/:id', requireExamAuth, (req, res) => {
    try {
      console.info && console.info(`GET /exams/${req.params.id} requested by reviewer=${req.reviewer ? req.reviewer.tag : 'unknown'}`);
      console.debug && console.debug('Incoming request headers:', { authorization: req.get('authorization') ? 'present' : 'missing', x_discord_token: !!req.get('x-discord-token') });
      const s = examStore.getSessionById(req.params.id);
      if (!s) return res.status(404).json({ error: 'Not found' });
      res.json(s);
    } catch (e) {
      console.error('Failed to fetch exam session:', e);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/exams/:id/grade', requireExamAuth, async (req, res) => {
    try {
      console.info && console.info(`POST /exams/${req.params.id}/grade requested by reviewer=${req.reviewer ? req.reviewer.tag : 'unknown'}`);
      console.debug && console.debug('Grade payload preview:', { scoresLength: Array.isArray(req.body?.scores) ? req.body.scores.length : 0, feedbackLen: (req.body?.feedback || '').length });
      const s = examStore.getSessionById(req.params.id);
      if (!s) return res.status(404).json({ error: 'Not found' });
      const { scores = [], feedback = '' } = req.body || {};
      const reviewerTag = req.reviewer ? req.reviewer.tag || (`web:${req.reviewer.id || 'unknown'}`) : 'web';
      await processGrade({ sessionId: s.id, scores, feedback, reviewerTag, client });
      res.json({ ok: true });
    } catch (e) {
      console.error('Failed to process grade via web:', e);
      res.status(500).json({ error: 'Internal error' });
    }
  });


  // OAuth callback for Roblox verification
  // Expects query params: code, state
  app.get('/oauth/roblox/callback', async (req, res) => {
    try {
      const { code, state } = req.query || {};
      if (!code || !state) return res.status(400).send('Missing code or state');

      // Find matching challenge by the stored state code
      const challenge = await verificationStore.getChallengeByCode(String(state));
      if (!challenge) return res.status(400).send('Invalid or expired verification state');

      // Exchange code for access token
      const tokenUrl = 'https://apis.roblox.com/oauth/v1/token';
      const clientId = config.ROBLOX_OAUTH_CLIENT_ID;
      const clientSecret = config.ROBLOX_OAUTH_CLIENT_SECRET;
      const redirectUri = config.ROBLOX_OAUTH_REDIRECT_URI;
      if (!clientId || !clientSecret || !redirectUri) return res.status(500).send('OAuth not configured');

      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('code', String(code));
      params.append('redirect_uri', redirectUri);
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);

      const tokenRes = await axios.post(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).catch(e => ({ error: e }));

      if (!tokenRes || tokenRes.error || !tokenRes.data || !tokenRes.data.access_token) {
        console.warn('Roblox token exchange failed', tokenRes && tokenRes.error ? tokenRes.error : tokenRes.data);
        return res.status(500).send('Failed to exchange OAuth code for token');
      }

      const accessToken = tokenRes.data.access_token;

      // Fetch userinfo from Roblox
      const userInfoUrl = 'https://apis.roblox.com/oauth/v1/userinfo';
      const userInfoRes = await axios.get(userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(e => ({ error: e }));
      if (!userInfoRes || userInfoRes.error || !userInfoRes.data) {
        console.warn('Roblox userinfo fetch failed', userInfoRes && userInfoRes.error ? userInfoRes.error : userInfoRes.data);
        return res.status(500).send('Failed to fetch Roblox user info');
      }

      // Attempt to extract a Roblox user id from the response
      const info = userInfoRes.data || {};
      const robloxId = info.user_id || info.sub || info.id || info.roblox_userid || info.robloxId || null;
      const robloxUsername = info.preferred_username || info.username || challenge.roblox_username;

      if (!robloxId) {
        console.warn('Roblox user id not found in userinfo response', info);
        return res.status(500).send('Could not determine Roblox user id');
      }

      // Verify that the OAuth-authenticated account matches the requested username/userid
      if (challenge.roblox_userid && String(challenge.roblox_userid) !== String(robloxId)) {
        console.warn('OAuth returned different Roblox id than requested', { expected: challenge.roblox_userid, got: robloxId });
        return res.status(400).send('Authenticated Roblox account does not match the requested username');
      }

      // Persist verification
      try {
        await verificationStore.addVerification(robloxUsername || challenge.roblox_username, robloxId, challenge.discord_id);
      } catch (err) {
        console.error('Failed to add verification record:', err);
        // clear the challenge regardless
        await verificationStore.clearChallengeByCode(String(state)).catch(() => null);
        return res.status(500).send('Failed to finalize verification (possibly already bound)');
      }

      // Clear the challenge
      await verificationStore.clearChallengeByCode(String(state)).catch(() => null);

      // Notify the user via DM if possible
      try {
        const user = await client.users.fetch(challenge.discord_id).catch(() => null);
        if (user) {
          await user.send({ content: `✅ Your Discord account has been verified and linked to Roblox account ${robloxUsername || ''} (ID ${robloxId}).` }).catch(() => null);
        }
      } catch (err) {
        console.warn('Failed to DM user after verification:', err);
      }

      // Render a simple success page
      return res.status(200).send('<html><body><h2>Verification complete</h2><p>You may close this window and return to Discord.</p></body></html>');
    } catch (err) {
      console.error('Unhandled error in OAuth callback:', err);
      return res.status(500).send('Internal server error');
    }
  });
  // Catch-all 404 handler (must be after all routes)
  app.use((req, res) => {
    console.warn(`⚠️ 404: ${req.method} ${req.path} - route not found`);
    res.status(404).json({ error: "Route not found" });
  });

  return app;
}

module.exports = { createFormServer };
