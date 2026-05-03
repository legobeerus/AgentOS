const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const config = require('../config');

function colIndexToLetter(index) {
  let s = '';
  index++; // 1-based
  while (index > 0) {
    const rem = (index - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    index = Math.floor((index - 1) / 26);
  }
  return s;
}

function parseRange(range) {
  const m = String(range || '').match(/^([^!]+)!\s*([A-Z]+)(\d+):([A-Z]+)(\d+)?$/i);
  if (!m) return null;
  return {
    sheetName: m[1],
    startCol: m[2].toUpperCase(),
    startRow: Number(m[3]),
    endCol: m[4].toUpperCase(),
    endRow: m[5] ? Number(m[5]) : undefined
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('points')
    .setDescription("Modify a user's points on the configured Google Sheet")
    .addStringOption(o =>
      o.setName('operation')
       .setDescription('Operation to perform')
       .setRequired(true)
       .addChoices(
         { name: 'Add', value: 'add' },
         { name: 'Subtract', value: 'subtract' },
         { name: 'Set', value: 'set' }
       )
    )
    .addStringOption(o => o.setName('username').setDescription('Username to find').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount/value').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Restrict to the same approver role used for case approvals
    try {
      if (!interaction.member.roles.cache.has(require('../config').REQUIRED_ROLE_ID)) {
        await interaction.editReply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
        return;
      }
    } catch (err) {
      try { await interaction.editReply({ content: '❌ You do not have permission to run this command.', ephemeral: true }); } catch (e) {}
      return;
    }

    const operation = interaction.options.getString('operation');
    const username = interaction.options.getString('username');
    const amount = interaction.options.getInteger('amount');

    const RANGE = config.TIME_LOG_SHEET_RANGE;
    const NAME_COL = Number.isFinite(Number(config.TIME_LOG_NAME_COL)) ? Number(config.TIME_LOG_NAME_COL) : 0;
    const POINTS_COL = Number.isFinite(Number(config.POINTS_POINTS_COL)) ? Number(config.POINTS_POINTS_COL) : Number(config.TIME_LOG_MINUTES_COL || 1);

    if (!RANGE) return interaction.editReply('Google sheet range not configured (set POINTS_SHEET_RANGE or TIME_LOG_SHEET_RANGE).');
    if (!config.GOOGLE_SHEET_ID) return interaction.editReply('GOOGLE_SHEET_ID not configured.');

    const keyObj = config.GOOGLE_SERVICE_ACCOUNT_JSON;
    const keyPath = config.GOOGLE_SERVICE_ACCOUNT_PATH;
    if (!keyObj && !keyPath) return interaction.editReply('Service account credentials not configured (set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH).');

    let creds = keyObj;
    if (!creds && keyPath) {
      try { creds = require('fs').readFileSync(keyPath, 'utf8'); creds = JSON.parse(creds); } catch (e) { return interaction.editReply('Failed to read service account JSON from path: ' + e.message); }
    }

    const jwt = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    try {
      await jwt.authorize();
      const sheets = google.sheets({ version: 'v4', auth: jwt });

      const fetchRes = await sheets.spreadsheets.values.get({ spreadsheetId: config.GOOGLE_SHEET_ID, range: RANGE });
      const rows = (fetchRes.data && fetchRes.data.values) || [];
      if (!rows.length) return interaction.editReply('No rows found in configured range.');

      let foundIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        const cell = String(row[NAME_COL] || '').trim();
        const rowStr = (row || []).join(' | ');
        if (!cell && !rowStr) continue;
        if (cell && cell.toLowerCase() === username.toLowerCase()) { foundIdx = i; break; }
        if (String(rowStr).toLowerCase().includes(username.toLowerCase())) { foundIdx = i; break; }
      }

      if (foundIdx === -1) return interaction.editReply(`Username '${username}' not found in sheet range.`);

      const targetRow = foundIdx; // 0-based within fetched range
      const currentValRaw = String((rows[targetRow] || [])[POINTS_COL] || '').trim();
      const currentVal = currentValRaw === '' ? 0 : Number(currentValRaw) || 0;

      let newVal;
      if (operation === 'add') newVal = currentVal + amount;
      else if (operation === 'subtract') newVal = currentVal - amount;
      else newVal = amount;

      const parsed = parseRange(RANGE);
      if (!parsed) return interaction.editReply('Configured range is not in an expected A1 format like Sheet1!A4:K1000.');

      function letterToIndex(lett) { let n = 0; for (let ch of lett) { n = n*26 + (ch.charCodeAt(0)-64); } return n-1; }
      const startColIndex = letterToIndex(parsed.startCol);
      const targetColIndex = startColIndex + POINTS_COL;
      const targetColLetter = colIndexToLetter(targetColIndex);
      const targetRowNumber = parsed.startRow + targetRow; // 1-based

      const targetA1 = `${parsed.sheetName}!${targetColLetter}${targetRowNumber}`;

      await sheets.spreadsheets.values.update({ spreadsheetId: config.GOOGLE_SHEET_ID, range: targetA1, valueInputOption: 'RAW', requestBody: { values: [[String(newVal)]] } });

      return interaction.editReply(`Updated points for '${username}': ${currentVal} -> ${newVal} (operation: ${operation}).`);
    } catch (err) {
      console.error('points command failed:', err);
      return interaction.editReply('Failed to update sheet: ' + (err.message || String(err)));
    }
  }
};
