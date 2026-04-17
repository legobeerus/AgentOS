const config = require("../config");
const { google } = require("googleapis");
const { EmbedBuilder } = require('discord.js');
const { getState } = require('./adminState');
const verificationStore = require('./verificationStore');

function resolveRoleToken(token, guild) {
  if (!token || !guild) return null;
  const t = String(token).trim();
  // Extract numeric ID if token looks like a mention or contains digits
  const idMatch = t.match(/(\d{5,})/);
  if (idMatch) {
    const id = idMatch[1];
    const byId = guild.roles.cache.get(id);
    if (byId) return byId;
  }
  // Try exact ID match
  if (guild.roles.cache.get(t)) return guild.roles.cache.get(t);
  // Try by name (case-insensitive)
  const byName = guild.roles.cache.find(r => r.name.toLowerCase() === t.toLowerCase());
  if (byName) return byName;
  return null;
}

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

// In-memory cooldowns to avoid duplicate alerts for the same member/username
const probationCooldowns = new Map(); // key -> timestamp ms
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

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
        if (!message.guild) {
          console.log('Probationary user but message not in a guild, skipping role checks.');
          return;
        }

        const attempts = Number(config.PROBATION_RECHECK_ATTEMPTS || 3);
        const delayMs = Number(config.PROBATION_RECHECK_DELAY_MS || 1500);
        const cooldownMs = Number(config.PROBATION_ALERT_COOLDOWN_MS || 5 * 60 * 1000);

        // Resolve initial candidate discord id via verification or mention/cache
        async function resolveCandidate() {
          let member = null;
          try {
            const v = await verificationStore.getByRoblox(parsed.username).catch(() => null);
            if (v && v.discord_id) {
              member = await message.guild.members.fetch(v.discord_id, { force: true }).catch(() => null);
              if (member) return member;
            }
          } catch (e) { /* ignore */ }

          // Mention fallback
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            const m = await message.guild.members.fetch(mentionMatch[1]).catch(() => null);
            if (m) return m;
          }

          // Try cached find
          const uname = parsed.username;
          const cached = message.guild.members.cache.find(m => (m.user.username && m.user.username.toLowerCase() === String(uname).toLowerCase()) || (m.user.tag && m.user.tag.toLowerCase().startsWith(String(uname).toLowerCase())) ) || null;
          if (cached) return cached;

          // Last resort: try a search fetch by query
          try {
            const found = await message.guild.members.fetch({ query: parsed.username, limit: 1 }).catch(() => null);
            if (found && found.size > 0) return found.first();
          } catch (e) { /* ignore */ }
          return null;
        }

        const alertChanId = config.PROBATION_ALERT_CHANNEL_ID || config.LOG_CHANNEL_ID;
        const chan = await message.client.channels.fetch(alertChanId).catch(() => null);

        let member = await resolveCandidate();
        // If we have an id or tag to key cooldowns, use that; otherwise fall back to username
        const cooldownKey = member ? `id:${member.user.id}` : `name:${parsed.username.toLowerCase()}`;
        const lastAlert = probationCooldowns.get(cooldownKey) || 0;
        if (Date.now() - lastAlert < cooldownMs) {
          console.log('Probation alert suppressed by cooldown for', cooldownKey);
          return;
        }

        let finalAlertSent = false;
        for (let attempt = 0; attempt < attempts; attempt++) {
          try {
            if (member && member.user && member.user.id) {
              // refresh member to get latest roles
              member = await message.guild.members.fetch(member.user.id, { force: true }).catch(() => member);
            } else {
              // try to resolve if we didn't have a member earlier
              member = await resolveCandidate();
            }

            // Determine suspicious roles
            const suspiciousTokens = String(config.PROBATION_SUSPICIOUS_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
            const requiredTokens = String(config.PROBATION_REQUIRED_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

            const matchedSuspicious = [];
            const requiredInfo = [];

            if (member) {
              for (const tok of suspiciousTokens) {
                const role = resolveRoleToken(tok, message.guild);
                const id = role ? role.id : String(tok).trim();
                const name = role ? role.name : String(tok).trim();
                if (member.roles.cache.has(id)) matchedSuspicious.push({ id, name });
              }

              for (const tok of requiredTokens) {
                const role = resolveRoleToken(tok, message.guild);
                const id = role ? role.id : String(tok).trim();
                const name = role ? role.name : String(tok).trim();
                const has = !!member.roles.cache.has(id);
                requiredInfo.push({ id, name, has });
              }
            }

            if (matchedSuspicious.length > 0) {
              // Send suspicious-role alert immediately
              const names = matchedSuspicious.map(x => x.name).join(', ');
              if (chan) {
                const embed = new EmbedBuilder()
                  .setTitle('Probation Alert')
                  .setColor(config.EMBED_COLOR || 0xffa500)
                  .setDescription(`Probationary agent with prohibited roles has joined OSI. Has the following roles: ${names}`)
                  .addFields(
                    { name: 'Member', value: member ? `${member.user.tag} (<@${member.user.id}>)` : parsed.username, inline: true },
                    { name: 'Rank', value: parsed.rank || 'Unknown', inline: true }
                  )
                  .setTimestamp();
                await chan.send({ embeds: [embed] }).catch(e => console.error('Failed to send probation suspicious-role alert:', e));
                console.log('Probation suspicious-role alert sent (embed):', names, member ? member.user.id : parsed.username);
              }
              probationCooldowns.set(cooldownKey, Date.now());
              finalAlertSent = true;
              break;
            }

            const hasAnyRequired = requiredInfo.some(r => r.has);
            if (hasAnyRequired) {
              console.log('Member has at least one required role, no alert needed for', member ? member.user.id : parsed.username);
              // Don't alert; update cooldown to avoid rechecking for a short period
              probationCooldowns.set(cooldownKey, Date.now());
              finalAlertSent = false;
              break;
            }

            // If this was the last attempt, send missing-roles alert
            if (attempt === attempts - 1) {
              const requiredNames = requiredInfo.map(x => x.name).filter(Boolean).join(', ') || requiredTokens.join(', ');
              if (chan) {
                const embed = new EmbedBuilder()
                  .setTitle('Probation Alert')
                  .setColor(config.EMBED_COLOR || 0xffa500)
                  .setDescription(`Probationary agent missing required roles has joined OSI. Missing roles: ${requiredNames}`)
                  .addFields(
                    { name: 'Member', value: member ? `${member.user.tag} (<@${member.user.id}>)` : parsed.username, inline: true },
                    { name: 'Rank', value: parsed.rank || 'Unknown', inline: true }
                  )
                  .setTimestamp();
                await chan.send({ embeds: [embed] }).catch(e => console.error('Failed to send probation missing-roles alert:', e));
                console.log('Probation missing-roles alert sent (embed):', requiredNames, member ? member.user.id : parsed.username);
              } else {
                console.warn('Probation alert channel not found:', alertChanId);
              }
              probationCooldowns.set(cooldownKey, Date.now());
              finalAlertSent = true;
              break;
            }

            // otherwise wait and retry
            await sleep(delayMs);
          } catch (e) {
            console.warn('Probation recheck attempt failed:', e);
            if (attempt === attempts - 1) {
              // on final failure, set cooldown to avoid spamming errors
              probationCooldowns.set(cooldownKey, Date.now());
            }
          }
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
