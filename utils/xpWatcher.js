const config = require('../config');
const { EmbedBuilder } = require('discord.js');
const { listActiveAosEntries } = require('./aosForumLookup');

const recentAlerts = new Map();

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
  const match = text.match(/Changed\s+(.+?)'s\s+XP\s+from\s+/i);
  if (match && match[1]) return match[1].trim();

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
  if (!message || !message.channel || String(message.channel.id) !== String(config.XP_LOG_CHANNEL_ID)) return;

  const username = extractUsernameFromAuditMessage(message);
  if (!username) return;

  const key = getAlertKey(username);
  const dedupMinutes = Number.isFinite(Number(config.XP_ALERT_DEDUP_MINUTES)) ? Number(config.XP_ALERT_DEDUP_MINUTES) : 10;
  const lastSeen = recentAlerts.get(key);
  const now = Date.now();
  if (lastSeen && (now - lastSeen) < dedupMinutes * 60 * 1000) return;

  const aosEntries = await listActiveAosEntries(client).catch(() => []);
  const matches = aosEntries.filter(entry => normalizeUsername(entry.username) === key);
  if (!matches.length) return;

  recentAlerts.set(key, now);

  const alertChannel = await client.channels.fetch(config.XP_ALERT_CHANNEL_ID).catch(() => null);
  if (!alertChannel) return;

  const count = matches.length;
  const currentTime = formatTimeHM(new Date());

  const embed = new EmbedBuilder()
    .setTitle('AOS Alert')
    .setColor(0xed4245)
    .setDescription(`User ${username} with ${count} outstanding warrant${count === 1 ? '' : 's'} has been detected online at ${currentTime}. Please respond.`)
    .setFooter({ text: 'XP monitor' });

  await alertChannel.send({ embeds: [embed] }).catch(() => null);
}

module.exports = {
  handleXpAuditLogMessage,
  extractUsernameFromAuditMessage
};
