const config = require('../config');
const { EmbedBuilder } = require('discord.js');
const { listActiveAosEntries } = require('./aosForumLookup');

const recentAlerts = new Map();
let lastPruneAt = 0;
let aosEntriesCache = null;
let aosEntriesCacheExpiresAt = 0;
let aosEntriesInFlight = null;

function isVerbose() {
  return !!config.XP_ALERT_VERBOSE;
}

function debugLog(message, data) {
  if (!isVerbose()) return;
  try {
    if (data !== undefined) {
      console.info(`[xpWatcher] ${message}`, data);
    } else {
      console.info(`[xpWatcher] ${message}`);
    }
  } catch (e) {
    // ignore logging issues
  }
}

function getAosCacheTtlMs() {
  const raw = Number(config.XP_AOS_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 60 * 1000;
}

async function getCachedAosEntries(client) {
  const now = Date.now();
  if (Array.isArray(aosEntriesCache) && now < aosEntriesCacheExpiresAt) {
    return aosEntriesCache;
  }

  if (aosEntriesInFlight) return aosEntriesInFlight;

  aosEntriesInFlight = listActiveAosEntries(client)
    .then((entries) => {
      const safeEntries = Array.isArray(entries) ? entries : [];
      aosEntriesCache = safeEntries;
      aosEntriesCacheExpiresAt = Date.now() + getAosCacheTtlMs();
      debugLog('AoS cache refreshed', { count: safeEntries.length, ttlMs: getAosCacheTtlMs() });
      return safeEntries;
    })
    .catch((err) => {
      // On fetch errors, keep behavior non-breaking by returning empty list.
      debugLog('AoS lookup failed', { error: err && (err.message || err) });
      return [];
    })
    .finally(() => {
      aosEntriesInFlight = null;
    });

  return aosEntriesInFlight;
}

function pruneRecentAlerts(now, dedupMinutes) {
  const dedupMs = Math.max(1, Number(dedupMinutes) || 10) * 60 * 1000;
  // Avoid pruning too frequently under heavy message throughput.
  if (now - lastPruneAt < 60 * 1000) return;
  lastPruneAt = now;

  for (const [k, ts] of recentAlerts.entries()) {
    if (!Number.isFinite(Number(ts)) || (now - Number(ts)) >= dedupMs) {
      recentAlerts.delete(k);
    }
  }

  // Hard cap to protect memory in unusually high-cardinality username streams.
  const maxEntries = 5000;
  while (recentAlerts.size > maxEntries) {
    const firstKey = recentAlerts.keys().next().value;
    if (!firstKey) break;
    recentAlerts.delete(firstKey);
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function getAlertKey(username) {
  return normalizeUsername(username);
}

function extractUsernameFromAuditMessage(message) {
  const textParts = [];

  if (message && typeof message.content === 'string') textParts.push(message.content);
  if (message && Array.isArray(message.embeds)) {
    for (const embed of message.embeds) {
      if (!embed) continue;
      if (embed.title) textParts.push(embed.title);
      if (embed.description) textParts.push(embed.description);
      if (Array.isArray(embed.fields)) {
        for (const field of embed.fields) {
          if (field && field.name) textParts.push(`${field.name}: ${field.value || ''}`);
        }
      }
    }
  }

  const text = textParts.join('\n');
  const patterns = [
    /Changed\s+(.+?)'s\s+XP\s+from\s+/i,
    /Changed\s+XP\s+for\s+(.+?)\s+from\s+/i,
    /Updated\s+(.+?)'s\s+XP\s+(?:from|to)\s+/i,
    /\bUser(?:name)?\s*[:|-]\s*([^\n]+)/i,
    /\bTarget\s*[:|-]\s*([^\n]+)/i,
    /\bPlayer\s*[:|-]\s*([^\n]+)/i
  ];
  for (const rx of patterns) {
    const match = text.match(rx);
    if (match && match[1]) return match[1].trim();
  }

  if (message && Array.isArray(message.embeds)) {
    for (const embed of message.embeds) {
      if (!embed || !Array.isArray(embed.fields)) continue;
      for (const field of embed.fields) {
        const name = String((field && field.name) || '').toLowerCase().trim();
        const value = String((field && field.value) || '').trim();
        if (!value) continue;
        if (/^(username|user|user name|target|player|roblox username)$/.test(name)) {
          return value;
        }
      }
    }
  }

  return null;
}

function formatTimeHM(date) {
  const time = date || new Date();
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(time);
}

async function handleXpAuditLogMessage(message, client) {
  if (!message || !message.channel) return;
  if (String(message.channel.id) !== String(config.XP_LOG_CHANNEL_ID)) return;
  debugLog('Processing message in XP log channel', { messageId: message.id, channelId: message.channel.id });

  const username = extractUsernameFromAuditMessage(message);
  if (!username) {
    debugLog('No username parsed from XP log message', { messageId: message.id });
    return;
  }

  const key = getAlertKey(username);
  const dedupMinutes = Number.isFinite(Number(config.XP_ALERT_DEDUP_MINUTES)) ? Number(config.XP_ALERT_DEDUP_MINUTES) : 10;
  const now = Date.now();
  pruneRecentAlerts(now, dedupMinutes);
  const lastSeen = recentAlerts.get(key);
  if (lastSeen && (now - lastSeen) < dedupMinutes * 60 * 1000) {
    debugLog('Alert suppressed by dedupe window', { username, dedupMinutes });
    return;
  }

  const aosEntries = await getCachedAosEntries(client);
  const matches = aosEntries.filter(entry => normalizeUsername(entry.username) === key);
  if (!matches.length) {
    debugLog('No active AoS match for parsed username', { username, cachedEntries: aosEntries.length });
    return;
  }

  recentAlerts.set(key, now);

  const alertChannel = await client.channels.fetch(config.XP_ALERT_CHANNEL_ID).catch(() => null);
  if (!alertChannel) {
    debugLog('Alert channel not found', { channelId: config.XP_ALERT_CHANNEL_ID });
    return;
  }

  const count = matches.length;
  const currentTime = formatTimeHM(new Date());

  const embed = new EmbedBuilder()
    .setTitle('AOS Alert')
    .setColor(0xed4245)
    .setDescription(`User ${username} with ${count} outstanding warrant${count === 1 ? '' : 's'} has been detected online at ${currentTime}. Please respond.`)
    .setFooter({ text: 'XP monitor' });

  await alertChannel.send({ embeds: [embed] }).catch((err) => {
    debugLog('Failed to send AoS alert', { error: err && (err.message || err) });
    return null;
  });
  debugLog('AoS alert sent', { username, warrants: count, channelId: alertChannel.id });
}

module.exports = {
  handleXpAuditLogMessage,
  extractUsernameFromAuditMessage
};
