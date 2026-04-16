const config = require("../config");
const { google } = require("googleapis");
const { getState } = require('./adminState');
const verificationStore = require('./verificationStore');

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

function stripLeadingApostrophe(s) {
  if (s === undefined || s === null) return s;
  return String(s).replace(/^[\u0027\u2018\u2019]+/, '');
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
  const range = config.TIME_LOG_SHEET_RANGE;
  const parsed = parseRange(range);
  if (!parsed) throw new Error("TIME_LOG_SHEET_RANGE has unsupported format: " + range);

  const sheets = await getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: config.GOOGLE_SHEET_ID,
    range
  });
  const rows = resp.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cellName = (row[config.TIME_LOG_NAME_COL] || "").toString().trim();
    if (cellName.toLowerCase() === username.toLowerCase()) {
      const currentWeekly = parseInt(row[config.TIME_LOG_MINUTES_COL]) || 0;
      const updatedWeekly = currentWeekly + minutesToAdd;

      // Determine total column index (config override, otherwise minutes col + 1)
      const totalColIdx = (typeof config.TIME_LOG_TOTAL_COL === 'number') ? config.TIME_LOG_TOTAL_COL : (config.TIME_LOG_MINUTES_COL + 1);
      const currentTotal = parseInt(row[totalColIdx]) || 0;
      const updatedTotal = currentTotal + minutesToAdd;

      const startColIndex = colLetterToIndex(parsed.startCol);
      const weeklyColIndex = startColIndex + config.TIME_LOG_MINUTES_COL;
      const totalColIndex = startColIndex + totalColIdx;
      const weeklyColLetter = indexToColLetter(weeklyColIndex);
      const totalColLetter = indexToColLetter(totalColIndex);
      const targetRowNumber = parsed.startRow + i;
      const weeklyA1 = `${parsed.sheetName}!${weeklyColLetter}${targetRowNumber}`;
      const totalA1 = `${parsed.sheetName}!${totalColLetter}${targetRowNumber}`;

      // Debug: log current/updated values and target A1 ranges
      console.log(`Updating sheet for ${username}: weekly ${currentWeekly} -> ${updatedWeekly} (${weeklyA1}), total ${currentTotal} -> ${updatedTotal} (${totalA1})`);
      try { console.log('Writing values:', weeklyA1, JSON.stringify(String(updatedWeekly)), totalA1, JSON.stringify(String(updatedTotal))); } catch (e) {}
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
  const usernameMatch = content.match(/Username:\s*([^|\r\n]+)/i);
  const timeMatch = content.match(/Time:\s*(\d+)\s*(?:mins?|minutes?)?/i);
  const rankMatch = content.match(/Rank:\s*([^|\r\n]+)/i);
  // Time is optional for join/leave messages; default minutes to 0 when absent

  let username = usernameMatch ? usernameMatch[1].trim() : null;
  if (!username) {
    // Fallback: extract first segment before a pipe or newline and strip any leading label
    const firstSeg = String(content).split(/[|\r\n]/)[0] || '';
    username = firstSeg.replace(/Username:\s*/i, '').trim();
  }
  if (!username) return null;

  const minutes = timeMatch ? Number(timeMatch[1]) : 0;
  return { username, minutes, rank: rankMatch ? rankMatch[1].trim() : null };
}

async function handleTimeWebhookMessage(message) {
  try {
    // Early debug: show incoming message routing info
    try {
      // Support legacy single ID or comma-separated list
      const configuredList = String(config.TIME_LOG_CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      console.log('timeWebhookHandler invoked', {
        channelId: message?.channel?.id,
        configuredTimeLogChannelIds: configuredList,
        guildId: message?.guild?.id,
        authorBot: !!(message && message.author && message.author.bot),
        webhookId: message && message.webhookId,
        hasContent: !!(message && message.content),
        preview: (message && message.content) ? String(message.content).slice(0,160) : null
      });
    } catch (e) { /* ignore logging failures */ }

    if (!message || !message.content) return;
    // Allow overriding the bot-author guard when admin debug mode is enabled
    let state = { debugMode: false };
    try { state = await getState(); } catch (e) { /* ignore */ }
    if (message.author && message.author.bot && !(message.webhookId) && !state.debugMode) return; // ignore normal bots unless webhook
    // Allow comma-separated list of channel IDs in config.TIME_LOG_CHANNEL_ID (legacy single ID supported)
    const allowedChannels = String(config.TIME_LOG_CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
    const isTimeLogChannel = (allowedChannels.length === 0) || (message.channel && allowedChannels.includes(message.channel.id));
    if (!isTimeLogChannel) console.log('timeWebhookHandler: message is not in configured TIME_LOG_CHANNEL_ID(s); skipping sheet update but continuing probation checks', { messageChannelId: message.channel?.id, allowedChannels });

    const parsed = parseGameMessage(message.content);
    if (!parsed) return; // not in expected format

    if (isTimeLogChannel) {
      const res = await updateMinutesForUser(parsed.username, parsed.minutes);
      if (res) {
        console.log(`Updated ${parsed.username}: +${parsed.minutes} weekly=${res.updatedWeekly} total=${res.updatedTotal} (weekly ${res.weeklyCol}${res.row}, total ${res.totalCol}${res.row})`);
      } else {
        console.log(`Username not found in sheet: ${parsed.username}`);
      }
    } else {
      console.log('Skipping sheet update because message is not in TIME_LOG_CHANNEL_ID; continuing to probation checks.');
    }

    // Probationary detection and role check
    // Only alert on JOIN events to avoid duplicate alerts on join/leave
    if (!/\bJOIN\b/i.test(message.content)) return;
    try {
      const probNames = String(config.PROBATION_RANK_NAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const rank = parsed.rank ? String(parsed.rank).toLowerCase() : '';
      console.log('Probation check:', { username: parsed.username, rank: parsed.rank, probNames });
      if (rank && probNames.some(pn => rank.includes(pn))) {
        // Attempt to resolve a guild member for role checking. Prefer verified binding (Roblox->Discord).
        let member = null;
        try {
          if (message.guild) {
            // Try verification store first
            let v = null;
            try { v = await verificationStore.getByRoblox(parsed.username); } catch (e) { console.warn('verificationStore.getByRoblox failed:', e); }
            console.log('verification lookup result for', parsed.username, v ? { discord_id: v.discord_id, roblox_userid: v.roblox_userid } : null);
            if (v && v.discord_id) {
              member = await message.guild.members.fetch(v.discord_id).catch(() => null);
            }
            // Fallback: direct mention in message
            if (!member) {
              const mentionMatch = message.content.match(/<@!?(\d+)>/);
              if (mentionMatch) member = await message.guild.members.fetch(mentionMatch[1]).catch(() => null);
            }
            // Final fallback: find by username/tag in cache
            if (!member) {
              const uname = parsed.username;
              member = message.guild.members.cache.find(m => (m.user.username && m.user.username.toLowerCase() === String(uname).toLowerCase()) || (m.user.tag && m.user.tag.toLowerCase().startsWith(String(uname).toLowerCase())) ) || null;
            }

            if (member) {
              console.log('Resolved guild member for probation check:', { id: member.user.id, tag: member.user.tag });
                // First, check suspicious roles (highest priority). If any found, alert with those.
                const suspicious = String(config.PROBATION_SUSPICIOUS_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
                console.log('Suspicious role ids:', suspicious);
                const matchedSuspicious = suspicious.map(rid => ({ id: rid, name: message.guild.roles.cache.get(rid)?.name || rid, has: !!member.roles.cache.has(rid) })).filter(x => x.has);
                if (matchedSuspicious.length > 0) {
                  const alertChanId = config.PROBATION_ALERT_CHANNEL_ID || config.LOG_CHANNEL_ID;
                  const chan = await message.client.channels.fetch(alertChanId).catch(() => null);
                  const names = matchedSuspicious.map(x => x.name).join(', ');
                  const alertTxt = `Has the following role: ${names} — ${member.user.tag} (<@${member.user.id}>) — Rank: ${parsed.rank}`;
                  if (chan) {
                    await chan.send({ content: alertTxt }).catch(e => console.error('Failed to send probation suspicious-role alert:', e));
                    console.log('Probation suspicious-role alert sent:', alertTxt);
                  } else {
                    console.warn('Probation alert channel not found:', alertChanId);
                  }
                } else {
                  // No suspicious roles — check required roles (pass if member has ANY of them). If none present, alert with missing list.
                  const required = String(config.PROBATION_REQUIRED_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
                  console.log('Required role ids:', required);
                  const requiredInfo = required.map(rid => ({ id: rid, name: message.guild.roles.cache.get(rid)?.name || rid, has: !!member.roles.cache.has(rid) }));
                  console.log('Required role details for member:', requiredInfo);
                  const hasAnyRequired = requiredInfo.some(r => r.has);
                  console.log('Has any required role:', hasAnyRequired);
                  if (!hasAnyRequired) {
                    const alertChanId = config.PROBATION_ALERT_CHANNEL_ID || config.LOG_CHANNEL_ID;
                    const chan = await message.client.channels.fetch(alertChanId).catch(() => null);
                    const requiredNames = requiredInfo.map(x => x.name).join(', ');
                    const alertTxt = `Missing roles: ${requiredNames} — ${member.user.tag} (<@${member.user.id}>) — Rank: ${parsed.rank}`;
                    if (chan) {
                      await chan.send({ content: alertTxt }).catch(e => console.error('Failed to send probation missing-roles alert:', e));
                      console.log('Probation missing-roles alert sent:', alertTxt);
                    } else {
                      console.warn('Probation alert channel not found:', alertChanId);
                    }
                  }
                }
            } else {
              console.log('Probationary user detected but could not resolve guild member to check roles:', parsed.username);
            }
          }
        } catch (err) {
          console.error('Probation detection error:', err);
        }
      }
    } catch (err) {
      console.error('Probation detection error:', err);
    }
  } catch (err) {
    console.error("Error handling time webhook message:", err);
  }
}

module.exports = { handleTimeWebhookMessage };
