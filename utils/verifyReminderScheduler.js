const verifyReminderStore = require('./verifyReminderStore');
const verificationStore = require('./verificationStore');
const config = require('../config');

// Delay buffer to avoid tight loops
const MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let timers = new Map(); // id -> timeout
let isRunning = false;

function scheduleTimeoutForEntry(entry, client) {
  if (!entry || !entry.id) return;
  // clear existing
  if (timers.has(entry.id)) {
    clearTimeout(timers.get(entry.id));
    timers.delete(entry.id);
  }
  if (!entry.nextSendAt) return; // waiting for join event to set
  const when = new Date(entry.nextSendAt).getTime();
  const now = Date.now();
  const delay = Math.max(1000, when - now);
  const t = setTimeout(async () => {
    timers.delete(entry.id);
    await sendReminderIfDue(entry, client);
  }, delay);
  timers.set(entry.id, t);
}

async function sendReminderIfDue(entry, client) {
  try {
    // double-check current state: is user verified?
    const verified = await verificationStore.getByDiscord(entry.discordId);
    if (verified) {
      await verifyReminderStore.removeReminder(entry.discordId, entry.guildId);
      return;
    }
    // fetch member
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) {
      // guild not cached; remove reminder to avoid orphan
      await verifyReminderStore.removeReminder(entry.discordId, entry.guildId);
      return;
    }
    let member = null;
    try { member = await guild.members.fetch(entry.discordId); } catch (e) { member = null; }
    if (!member) {
      // user not in guild, remove reminder
      await verifyReminderStore.removeReminder(entry.discordId, entry.guildId);
      return;
    }
    // if verified now, remove
    const verified2 = await verificationStore.getByDiscord(entry.discordId);
    if (verified2) {
      await verifyReminderStore.removeReminder(entry.discordId, entry.guildId);
      return;
    }
    // send DM reminder
    try {
      const user = await client.users.fetch(entry.discordId);
      const dm = await user.createDM();
      const text = config.VERIFY_REMINDER_MESSAGE || 'You have not yet verified your account with AgentOS. To initiate verification, please run the `/agentos-verify start` command in the server.\n\nVerification is mandatory. Reminders will be sent every 24 hours until you verify.';
      await dm.send({ content: text });
    } catch (e) {
      console.warn('[verifyReminderScheduler] failed to DM user', entry.discordId, e && e.message);
    }
    // schedule next send in 24h
    const next = new Date(Date.now() + DAY_MS).toISOString();
    await verifyReminderStore.setNextSend(entry.id, next);
    // re-schedule
    const updated = await verifyReminderStore.getReminder(entry.discordId, entry.guildId);
    if (updated) scheduleTimeoutForEntry(updated, client);
  } catch (e) {
    console.error('[verifyReminderScheduler] sendReminderIfDue failed', e);
  }
}

async function initScheduler(client) {
  if (isRunning) return;
  isRunning = true;
  // load all reminders with nextSendAt and schedule
  try {
    const now = new Date();
    const due = await verifyReminderStore.listDue(new Date(Date.now() + 7 * DAY_MS));
    // schedule each
    for (const entry of due) {
      scheduleTimeoutForEntry(entry, client);
    }
  } catch (e) {
    console.error('[verifyReminderScheduler] init failed', e);
  }
}

async function onGuildMemberAdd(member) {
  // when member joins, find pending reminders for this discord and guild
  try {
    const list = await verifyReminderStore.listByDiscord(member.id);
    for (const entry of list) {
      if (entry.guildId !== member.guild.id) continue;
      // if no nextSendAt, set to join + 24h
      if (!entry.nextSendAt) {
        const joinTime = member.joinedTimestamp || Date.now();
        const next = new Date(Math.max(joinTime + DAY_MS, Date.now() + DAY_MS)).toISOString();
        await verifyReminderStore.setNextSend(entry.id, next);
        const updated = await verifyReminderStore.getReminder(member.id, member.guild.id);
        if (updated) scheduleTimeoutForEntry(updated, member.client);
      } else {
        scheduleTimeoutForEntry(entry, member.client);
      }
    }
  } catch (e) {
    console.error('[verifyReminderScheduler] onGuildMemberAdd failed', e);
  }
}

async function onGuildMemberRemove(member) {
  try {
    await verifyReminderStore.removeReminder(member.id, member.guild.id);
  } catch (e) {
    console.error('[verifyReminderScheduler] onGuildMemberRemove failed', e);
  }
}

module.exports = { initScheduler, onGuildMemberAdd, onGuildMemberRemove, scheduleTimeoutForEntry };
