const { listFollowups, removeFollowup } = require('./followupStore');

let clientRef = null;
const timers = new Map();

function clearTimer(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

async function sendAndCleanup(entry) {
  try {
    const ch = await clientRef.channels.fetch(entry.threadId).catch(() => null);
    if (ch && ch.isTextBased && ch.isTextBased()) {
      const allowed = Array.isArray(entry.allowedMentions) ? entry.allowedMentions : [];
      await ch.send({ content: entry.content, allowedMentions: { roles: allowed } }).catch(() => null);
    }
  } catch (e) {
    console.error('followupScheduler send failed:', e);
  }
  try { await removeFollowup(entry.id); } catch (e) {}
  clearTimer(entry.id);
}

function scheduleEntry(entry) {
  clearTimer(entry.id);
  const when = new Date(entry.sendAt).getTime();
  const delay = Math.max(0, when - Date.now());
  const t = setTimeout(() => sendAndCleanup(entry), delay);
  timers.set(entry.id, t);
}

async function startFollowupScheduler(client) {
  clientRef = client;
  try {
    const list = await listFollowups();
    for (const entry of list) {
      scheduleEntry(entry);
    }
  } catch (e) {
    console.error('Failed to start followup scheduler:', e);
  }
}

// Expose a function to schedule newly-added followups at runtime
function scheduleFollowup(entry) {
  // If scheduler not started, ignore scheduling - it will be scheduled on startup
  if (!clientRef) return;
  scheduleEntry(entry);
}

module.exports = { startFollowupScheduler, scheduleFollowup };
