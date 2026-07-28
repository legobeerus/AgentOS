const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const { google } = require("googleapis");

function normalizeCell(value) {
  return (value || "").toString().trim();
}

function isImmuneStatus(value) {
  const s = normalizeCell(value).toLowerCase();
  return s === (config.GAME_QUOTA_IMMUNE_TEXT || "IMMUNE").toLowerCase();
}

function isFailedStatus(value) {
  const s = normalizeCell(value).toLowerCase();
  // Google Sheets checkbox/IF outputs are typically TRUE/FALSE (string values via values API).
  return s === "false" || s === "unchecked" || s === "0" || s === "no" || s === "n";
}

async function getSheetRows(range) {
  // If an API key is provided, use the simple REST read (read-only)
  if (config.GOOGLE_SHEETS_API_KEY && config.GOOGLE_SHEET_ID) {
    const axios = require('axios');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?key=${config.GOOGLE_SHEETS_API_KEY}`;
    const res = await axios.get(url);
    return res.data.values || [];
  }

  // Otherwise attempt service account credentials via googleapis
  if (config.GOOGLE_SHEET_ID && (config.GOOGLE_SERVICE_ACCOUNT_JSON || config.GOOGLE_SERVICE_ACCOUNT_PATH)) {
    const auth = new google.auth.GoogleAuth({
      credentials: config.GOOGLE_SERVICE_ACCOUNT_JSON,
      keyFilename: config.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: config.GOOGLE_SHEET_ID, range });
    return (resp && resp.data && resp.data.values) || [];
  }

  throw new Error('Google Sheets not configured: provide GOOGLE_SHEETS_API_KEY or service account credentials');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("quota-check")
    .setDescription("Run a weekly quota check and post a report to the configured channel (ASK BEFORE USE)"),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    // Restrict to the same approver role used for case approvals
    try {
      const requiredRoles = Array.isArray(config.REQUIRED_ROLE_IDS_LIST)
        ? config.REQUIRED_ROLE_IDS_LIST
        : String(config.REQUIRED_ROLE_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const hasRequiredRole = requiredRoles.some(roleId => interaction.member.roles.cache.has(roleId));
      if (!hasRequiredRole) {
        await interaction.editReply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
        return;
      }
    } catch (err) {
      // If anything goes wrong resolving roles, deny by default
      try { await interaction.editReply({ content: '❌ You do not have permission to run this command.', ephemeral: true }); } catch (e) {}
      return;
    }

    try {
      if (!config.GOOGLE_SHEET_ID) return interaction.editReply("Google sheet not configured.");
      const range = config.TIME_LOG_SHEET_RANGE;
      const rows = await getSheetRows(range);

      const nameCol = config.TIME_LOG_NAME_COL || 0;
      const minutesCol = config.TIME_LOG_MINUTES_COL || 2;
      const rankCol = (config.TIME_LOG_RANK_COL !== undefined && config.TIME_LOG_RANK_COL !== null) ? Number(config.TIME_LOG_RANK_COL) : undefined;
      const passCol = (config.GAME_QUOTA_PASS_COL !== undefined && config.GAME_QUOTA_PASS_COL !== null) ? Number(config.GAME_QUOTA_PASS_COL) : undefined;
      const excludeRanks = (config.GAME_QUOTA_EXCLUDE_RANKS || "").split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      const failed = [];
      let topName = null;
      let topMinutes = -1;

      const strikeCol = (config.GAME_LOG_STRIKE_COL !== undefined && config.GAME_LOG_STRIKE_COL !== null) ? Number(config.GAME_LOG_STRIKE_COL) : undefined;

      for (const row of rows) {
        const name = normalizeCell(row[nameCol]);
        const raw = normalizeCell(row[minutesCol]);
        if (!name) continue;
        // If a rank column is configured and the rank matches an excluded rank, skip this row
        if (typeof rankCol === 'number' && excludeRanks.length) {
          const rank = (row[rankCol] || "").toString().trim().toLowerCase();
          if (rank && excludeRanks.includes(rank)) continue;
        }

        const passStatusRaw = typeof passCol === 'number' ? row[passCol] : undefined;
        if (isImmuneStatus(passStatusRaw)) {
          // IMMUNE users are excluded from both fail checks and Agent of the Week nomination.
          continue;
        }

        if (typeof passCol === 'number' && isFailedStatus(passStatusRaw)) {
          failed.push({ name, row });
        }

        // If the sheet cell contains exactly a single hyphen, treat it as ignored
        if (raw === "-") continue;
        if (raw !== "") {
          const val = Number(raw);
          if (!Number.isNaN(val)) {
            // Legacy fallback: if pass-status column is not configured, use time-based quota failure.
            if (typeof passCol !== 'number' && val < 60) failed.push({ name, row });
            if (val > topMinutes) { topMinutes = val; topName = name; }
          }
        }
      }

      // Exclude users currently on IN in DB
      try {
        const { getActiveRobloxUsernames } = require('../utils/inactivityStore');
        const active = await getActiveRobloxUsernames();
        const activeLower = new Set(active.map(a => String(a).toLowerCase()));
        // Filter failed list (preserve row data)
        const filtered = failed.filter(obj => !activeLower.has(String(obj.name).toLowerCase()));
        // Use filtered list for posting; include strike info if configured
        const failedList = filtered.length ? filtered.map(obj => {
          if (typeof strikeCol === 'number') {
            const rawStrike = (obj.row[strikeCol] || '').toString().trim();
            const cur = Number(rawStrike) || 0;
            const next = Math.min(cur + 1, 3);
            return `- ${obj.name} **|** Strike ${next}`;
          }
          return `- ${obj.name}`;
        }).join("\n") : "- None";
        const agent = topName ? `- ${topName}` : "- None";

        const channelId = String(config.GAME_QUOTA_CHANNEL_ID || '').trim();
        if (!channelId) return interaction.editReply("No target channel configured for quota reports.");

        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel) return interaction.editReply("Could not fetch the target channel.");

        const pingRoleId = config.GAME_QUOTA_PING_ROLE_ID || config.PING_ROLE_ID;
        const rolePing = pingRoleId ? `<@&${pingRoleId}>` : "";

        const content = `# <:osi:1448992108500357150> Quota Check <:osi:1448992108500357150> #\n${rolePing}\n\nThis week's quota has been reset! Here are the people who failed, and have recieved one strike:\n${failedList}\n\n**Agent of the week:**\n${agent}\n\n*The roster will be manually reset shortly.*`;

        await channel.send({ content });
        await interaction.editReply({ content: `Quota check posted to <#${channelId}>.`, ephemeral: true });
        return;
      } catch (err) {
        console.error('Failed to filter by IN DB:', err);
      }

      const channelId = String(config.GAME_QUOTA_CHANNEL_ID || '').trim();
      if (!channelId) return interaction.editReply("No target channel configured for quota reports.");

      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel) return interaction.editReply("Could not fetch the target channel.");

      const pingRoleId = config.GAME_QUOTA_PING_ROLE_ID || null;
      const rolePing = pingRoleId ? `<@&${pingRoleId}>` : "";

      const failedList = failed.length ? failed.map(obj => {
        if (typeof strikeCol === 'number') {
          const rawStrike = (obj.row[strikeCol] || '').toString().trim();
          const cur = Number(rawStrike) || 0;
          const next = Math.min(cur + 1, 3);
          return `- ${obj.name} **|** Strike ${next}`;
        }
        return `- ${obj.name}`;
      }).join("\n") : "- None";
      const agent = topName ? `- ${topName}` : "- None";

      const content = `# <:osi:1448992108500357150> Quota Check <:osi:1448992108500357150> #\n${rolePing}\n\nThis week's quota has been reset! Here are the people who failed, and have recieved one strike:\n${failedList}\n\n**Agent of the week:**\n${agent}\n\n*The roster will be manually reset shortly.*`;

      await channel.send({ content });
      await interaction.editReply({ content: `Quota check posted to <#${channelId}>.`, ephemeral: true });

    } catch (err) {
      console.error("quota-check error:", err);
      await interaction.editReply("An error occurred while running the quota check.");
    }
  }
};
