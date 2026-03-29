const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const { google } = require("googleapis");

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: config.GOOGLE_SERVICE_ACCOUNT_JSON,
    keyFilename: config.GOOGLE_SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("quota-check")
    .setDescription("Run a weekly quota check and post a report to the configured channel"),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      if (!config.GOOGLE_SHEET_ID) return interaction.editReply("Google sheet not configured.");
      const range = config.GAME_LOG_SHEET_RANGE;
      const sheets = await getSheetsClient();
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: config.GOOGLE_SHEET_ID, range });
      const rows = resp.data.values || [];

      const nameCol = config.GAME_LOG_NAME_COL || 0;
      const minutesCol = config.GAME_LOG_MINUTES_COL || 2;

      const failed = [];
      let topName = null;
      let topMinutes = -1;

      for (const row of rows) {
        const name = (row[nameCol] || "").toString().trim();
        const raw = (row[minutesCol] || "").toString().trim();
        if (!name) continue;
        if (raw !== "") {
          const val = Number(raw);
          if (!Number.isNaN(val)) {
            if (val < 60) failed.push(name);
            if (val > topMinutes) { topMinutes = val; topName = name; }
          }
        }
      }

      // Exclude users currently on IN in DB
      try {
        const { getActiveRobloxUsernames } = require('../utils/inactivityStore');
        const active = await getActiveRobloxUsernames();
        const activeLower = new Set(active.map(a => String(a).toLowerCase()));
        // Filter failed list
        const filtered = failed.filter(n => !activeLower.has(String(n).toLowerCase()));
        // Use filtered list for posting
        const failedList = filtered.length ? filtered.map(n => `- ${n}`).join("\n") : "- None";
        const agent = topName ? `- ${topName}` : "- None";

        const channelId = config.GAME_QUOTA_CHANNEL_ID || config.TARGET_CHANNEL_ID;
        if (!channelId) return interaction.editReply("No target channel configured for quota reports.");

        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel) return interaction.editReply("Could not fetch the target channel.");

        const pingRoleId = config.GAME_QUOTA_PING_ROLE_ID || config.PING_ROLE_ID;
        const rolePing = pingRoleId ? `<@&${pingRoleId}>` : "";

        const content = `# :OSI: Quota Check :OSI: #\n${rolePing}\n\nThis week's quota has been reset! Here are the people who failed, and have recieved one strike:\n${failedList}\n\n**Agent of the week:**\n${agent}\n\n*The roster will be manually reset shortly.*`;

        await channel.send({ content });
        await interaction.editReply({ content: `Quota check posted to <#${channelId}>.`, ephemeral: true });
        return;
      } catch (err) {
        console.error('Failed to filter by IN DB:', err);
      }

      const channelId = config.GAME_QUOTA_CHANNEL_ID || config.TARGET_CHANNEL_ID;
      if (!channelId) return interaction.editReply("No target channel configured for quota reports.");

      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel) return interaction.editReply("Could not fetch the target channel.");

      const pingRoleId = config.GAME_QUOTA_PING_ROLE_ID || config.PING_ROLE_ID;
      const rolePing = pingRoleId ? `<@&${pingRoleId}>` : "";

      const failedList = failed.length ? failed.map(n => `- ${n}`).join("\n") : "- None";
      const agent = topName ? `- ${topName}` : "- None";

      const content = `# :OSI: Quota Check :OSI: #\n${rolePing}\n\nThis week's quota has been reset! Here are the people who failed, and have recieved one strike:\n${failedList}\n\n**Agent of the week:**\n${agent}\n\n*The roster will be manually reset shortly.*`;

      await channel.send({ content });
      await interaction.editReply({ content: `Quota check posted to <#${channelId}>.`, ephemeral: true });

    } catch (err) {
      console.error("quota-check error:", err);
      await interaction.editReply("An error occurred while running the quota check.");
    }
  }
};
