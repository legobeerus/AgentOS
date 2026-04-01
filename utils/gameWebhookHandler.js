const config = require("../config");
const { google } = require("googleapis");

function colLetterToIndex(letter) {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 65 + 1);
  }
  return index - 1;
}

function indexToColLetter(index) {
  let s = "";
  while (index >= 0) {
    s = String.fromCharCode(65 + (index % 26)) + s;
    index = Math.floor(index / 26) - 1;
  }
  return s;
}

function parseRange(range) {
  // Expect formats like 'Sheet1!A2:C1000' or 'Sheet Name' variations
  const m = range.match(/^([^!]+)!([A-Z]+)(\d+)(?::[A-Z]+\d+)?$/);
  if (!m) return null;
  return { sheetName: m[1], startCol: m[2], startRow: Number(m[3]) };
}

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: config.GOOGLE_SERVICE_ACCOUNT_JSON,
    keyFilename: config.GOOGLE_SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function updateMinutesForUser(username, minutesToAdd) {
  if (!config.GOOGLE_SHEET_ID) throw new Error("GOOGLE_SHEET_ID not configured");
  const range = config.GAME_LOG_SHEET_RANGE;
  const parsed = parseRange(range);
  if (!parsed) throw new Error("GAME_LOG_SHEET_RANGE has unsupported format: " + range);

  const sheets = await getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: config.GOOGLE_SHEET_ID,
    range
  });
  const rows = resp.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cellName = (row[config.GAME_LOG_NAME_COL] || "").toString().trim();
    if (cellName.toLowerCase() === username.toLowerCase()) {
      const currentWeekly = parseInt(row[config.GAME_LOG_MINUTES_COL]) || 0;
      const updatedWeekly = currentWeekly + minutesToAdd;

      // Determine total column index (config override, otherwise minutes col + 1)
      const totalColIdx = (typeof config.GAME_LOG_TOTAL_COL === 'number') ? config.GAME_LOG_TOTAL_COL : (config.GAME_LOG_MINUTES_COL + 1);
      const currentTotal = parseInt(row[totalColIdx]) || 0;
      const updatedTotal = currentTotal + minutesToAdd;

      const startColIndex = colLetterToIndex(parsed.startCol);
      const weeklyColIndex = startColIndex + config.GAME_LOG_MINUTES_COL;
      const totalColIndex = startColIndex + totalColIdx;
      const weeklyColLetter = indexToColLetter(weeklyColIndex);
      const totalColLetter = indexToColLetter(totalColIndex);
      const targetRowNumber = parsed.startRow + i;
      const weeklyA1 = `${parsed.sheetName}!${weeklyColLetter}${targetRowNumber}`;
      const totalA1 = `${parsed.sheetName}!${totalColLetter}${targetRowNumber}`;

      // Debug: log current/updated values and target A1 ranges
      console.log(`Updating sheet for ${username}: weekly ${currentWeekly} -> ${updatedWeekly} (${weeklyA1}), total ${currentTotal} -> ${updatedTotal} (${totalA1})`);
      try {
        const resp = await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: config.GOOGLE_SHEET_ID,
          resource: {
            valueInputOption: 'RAW',
            data: [
              { range: weeklyA1, values: [[String(updatedWeekly)]] },
              { range: totalA1, values: [[String(updatedTotal)]] }
            ]
          }
        });
        console.log('Sheets batchUpdate response status:', resp.status || (resp && resp.statusText) || 'unknown');
      } catch (err) {
        console.error('Error writing to sheet for', username, err);
      }

      return { updatedWeekly, updatedTotal, row: targetRowNumber, weeklyCol: weeklyColLetter, totalCol: totalColLetter };
    }
  }
  return null;
}

function parseGameMessage(content) {
  if (!content) return null;
  const usernameMatch = content.match(/Username:\s*(.+)/i);
  const timeMatch = content.match(/Time:\s*(\d+)\s*(?:mins?|minutes?)?/i);
  const rankMatch = content.match(/Rank:\s*(.+)/i);
  if (!usernameMatch || !timeMatch) return null;
  return { username: usernameMatch[1].trim(), minutes: Number(timeMatch[1]), rank: rankMatch ? rankMatch[1].trim() : null };
}

async function handleGameWebhookMessage(message) {
  try {
    if (!message || !message.content) return;
    if (message.author && message.author.bot && !(message.webhookId)) return; // ignore normal bots unless webhook
    if (config.GAME_LOG_CHANNEL_ID && message.channel.id !== config.GAME_LOG_CHANNEL_ID) return;

    const parsed = parseGameMessage(message.content);
    if (!parsed) return; // not in expected format

    const res = await updateMinutesForUser(parsed.username, parsed.minutes);
    if (res) {
      console.log(`Updated ${parsed.username}: +${parsed.minutes} weekly=${res.updatedWeekly} total=${res.updatedTotal} (weekly ${res.weeklyCol}${res.row}, total ${res.totalCol}${res.row})`);
    } else {
      console.log(`Username not found in sheet: ${parsed.username}`);
    }

      // Probationary detection and role check
      // Only alert on JOIN events to avoid duplicate alerts on join/leave
      if (!/\bJOIN\b/i.test(message.content)) return;
      try {
        const probNames = String(config.PROBATION_RANK_NAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const rank = parsed.rank ? String(parsed.rank).toLowerCase() : '';
        if (rank && probNames.some(pn => rank.includes(pn))) {
          // Attempt to resolve a guild member for role checking
          let member = null;
          // First, look for a direct mention in the message
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch && message.guild) {
            const id = mentionMatch[1];
            member = await message.guild.members.fetch(id).catch(() => null);
          }
          // Fallback: try to find by username in guild cache
          if (!member && message.guild) {
            const uname = parsed.username;
            member = message.guild.members.cache.find(m => (m.user.username && m.user.username.toLowerCase() === String(uname).toLowerCase()) || (m.user.tag && m.user.tag.toLowerCase().startsWith(String(uname).toLowerCase())) ) || null;
          }

          if (member) {
            const suspicious = String(config.PROBATION_SUSPICIOUS_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
            for (const rid of suspicious) {
              if (member.roles.cache.has(rid)) {
                // send alert
                const alertChanId = config.PROBATION_ALERT_CHANNEL_ID || config.LOG_CHANNEL_ID;
                const chan = await message.client.channels.fetch(alertChanId).catch(() => null);
                const roleName = message.guild.roles.cache.get(rid)?.name || rid;
                const alertTxt = `Unauthorized probationary agent on-site: ${member.user.tag} (<@${member.user.id}>) — triggering role: ${roleName} (<@&${rid}>) — Rank: ${parsed.rank}`;
                if (chan) await chan.send({ content: alertTxt }).catch(() => null);
                console.log('Probation alert sent:', alertTxt);
                break;
              }
            }
          } else {
            console.log('Probationary user detected but could not resolve guild member to check roles:', parsed.username);
          }
        }
      } catch (err) {
        console.error('Probation detection error:', err);
      }
  } catch (err) {
    console.error("Error handling game webhook message:", err);
  }
}

module.exports = { handleGameWebhookMessage };
