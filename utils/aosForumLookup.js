const config = require('../config');

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function parseFieldValue(content, fieldName) {
  const text = String(content || '').replace(/\r/g, '');
  const escaped = String(fieldName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const sameLine = new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`, 'i').exec(text);
  if (sameLine && sameLine[1]) return sameLine[1].trim();

  const nextLine = new RegExp(`\\*\\*${escaped}:\\*\\*\\s*\\n+\\s*([^\\n]+)`, 'i').exec(text);
  if (nextLine && nextLine[1]) return nextLine[1].trim();

  return null;
}

function parseUsernameField(content) {
  return parseFieldValue(content, 'Username');
}

function parseChargesField(content) {
  return parseFieldValue(content, 'Charges');
}

function renderThreadUrl(guildId, threadId) {
  return `https://discord.com/channels/${guildId}/${threadId}`;
}

async function fetchCandidateThreads(forumChannel, maxThreads) {
  const bucket = [];

  try {
    const active = await forumChannel.threads.fetchActive();
    const activeThreads = Array.from((active && active.threads && active.threads.values()) || []);
    bucket.push(...activeThreads);
  } catch (err) {
    // ignore
  }

  try {
    const archived = await forumChannel.threads.fetchArchived({ type: 'public', fetchAll: false, limit: maxThreads });
    const archivedThreads = Array.from((archived && archived.threads && archived.threads.values()) || []);
    bucket.push(...archivedThreads);
  } catch (err) {
    // ignore
  }

  const dedup = new Map();
  for (const thread of bucket) {
    if (!thread || !thread.id) continue;
    dedup.set(thread.id, thread);
    if (dedup.size >= maxThreads) break;
  }

  return Array.from(dedup.values());
}

async function findActiveAosByUsername(client, username) {
  const target = normalizeUsername(username);
  if (!target) return [];

  const forumChannel = await client.channels.fetch(config.AOS_FORUM_CHANNEL_ID).catch(() => null);
  if (!forumChannel) return [];

  const maxThreads = Number.isFinite(Number(config.AOS_LOOKUP_MAX_THREADS))
    ? Number(config.AOS_LOOKUP_MAX_THREADS)
    : 100;

  const threads = await fetchCandidateThreads(forumChannel, Math.max(1, maxThreads));
  const activeTagId = String(config.AOS_TAG_ACTIVE_WARRANT_ID || '');

  const matches = [];

  for (const thread of threads) {
    const tags = Array.isArray(thread.appliedTags) ? thread.appliedTags.map(String) : [];
    if (!activeTagId || !tags.includes(activeTagId)) continue;

    let starter = null;
    try {
      starter = await thread.fetchStarterMessage();
    } catch (err) {
      starter = await thread.messages.fetch(thread.id).catch(() => null);
    }

    const parsedUsername = parseUsernameField(starter && starter.content ? starter.content : '');
    if (!parsedUsername) continue;

    if (normalizeUsername(parsedUsername) !== target) continue;

    matches.push({
      threadId: thread.id,
      threadName: thread.name || `AoS ${parsedUsername}`,
      url: renderThreadUrl(thread.guildId, thread.id)
    });
  }

  return matches;
}

async function listActiveAosEntries(client) {
  const forumChannel = await client.channels.fetch(config.AOS_FORUM_CHANNEL_ID).catch(() => null);
  if (!forumChannel) return [];

  const maxThreads = Number.isFinite(Number(config.AOS_LOOKUP_MAX_THREADS))
    ? Number(config.AOS_LOOKUP_MAX_THREADS)
    : 100;

  const threads = await fetchCandidateThreads(forumChannel, Math.max(1, maxThreads));
  const activeTagId = String(config.AOS_TAG_ACTIVE_WARRANT_ID || '');
  const entries = [];

  for (const thread of threads) {
    const tags = Array.isArray(thread.appliedTags) ? thread.appliedTags.map(String) : [];
    if (!activeTagId || !tags.includes(activeTagId)) continue;

    let starter = null;
    try {
      starter = await thread.fetchStarterMessage();
    } catch (err) {
      starter = await thread.messages.fetch(thread.id).catch(() => null);
    }

    const content = starter && starter.content ? starter.content : '';
    const username = parseUsernameField(content) || 'Unknown';
    const charges = parseChargesField(content) || 'Unknown';

    entries.push({
      threadId: thread.id,
      threadName: thread.name || `AoS ${username}`,
      username,
      charges,
      url: renderThreadUrl(thread.guildId, thread.id)
    });
  }

  return entries;
}

module.exports = {
  parseFieldValue,
  parseUsernameField,
  parseChargesField,
  findActiveAosByUsername,
  listActiveAosEntries
};
