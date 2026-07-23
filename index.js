require("dotenv").config();
const { startKeepAlive } = require("./utils/dbKeepAlive");
const verificationStore = require('./utils/verificationStore');
const arrestStore = require('./utils/arrestStore');
const aosActiveStore = require('./utils/aosActiveStore');
const { Client, GatewayIntentBits } = require("discord.js");
const { loadCommands } = require("./utils/loadCommands");
const { handleInteraction } = require("./utils/handleInteraction");
const { handleTrelloIngest } = require("./utils/trelloMessageIngest");
const { handleMessageCommands } = require("./utils/messageCommands");
const { handleExamDM } = require("./utils/examMessageHandler");
const { handleTimeWebhookMessage } = require("./utils/timeWebhookHandler");
const { startSuspensionScheduler } = require("./utils/trelloSuspensionScheduler");
const { createFormServer } = require("./utils/createFormServer");
const { initXpWatcherDiagnostics, handleXpAuditLogMessage } = require("./utils/xpWatcher");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ]
});

const { startInactivityScheduler } = require("./utils/inactivityScheduler");
const { startFollowupScheduler } = require("./utils/followupScheduler");
const probationWatcher = require('./utils/probationWatcher');
const verifyReminderScheduler = require('./utils/verifyReminderScheduler');

// Start DB keep-alive (if configured)
startKeepAlive();

// Initialize verification tables when a database is configured
if (process.env.DATABASE_URL) {
  verificationStore.init().catch(err => console.error('verificationStore.init failed:', err));
  arrestStore.init().catch(err => console.error('arrestStore.init failed:', err));
  aosActiveStore.init().catch(err => console.error('aosActiveStore.init failed:', err));
} else {
  console.info('DATABASE_URL not set — skipping DB-backed store init.');
}

// Load all commands
loadCommands(client);

// Ready event
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  try { initXpWatcherDiagnostics(client).catch(() => null); } catch (e) {}
  startSuspensionScheduler();
  // Start inactivity scheduler to DM expired INs and clean DB
  try { startInactivityScheduler(client); } catch (e) { console.error('Failed to start inactivity scheduler:', e); }
  // Start follow-up scheduler to send persisted follow-up messages
  try { startFollowupScheduler(client); } catch (e) { console.error('Failed to start followup scheduler:', e); }
  // Start the form server now that the bot is ready
  const app = createFormServer(client);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Form submission server listening on port ${PORT}`);
  });
  // Schedule existing exam sessions for expiration handling
  try {
    const examStore = require('./utils/examStore');
    examStore.initExpirationScheduler(client).catch(err => console.error('Failed to initialize exam expiration scheduler:', err));
  } catch (e) {
    console.error('Failed to start exam expiration scheduler:', e);
  }
  // Start DB listener for exam updates (NOTIFY / poll)
  try {
    const db = require('./utils/db');
    const examStore = require('./utils/examStore');
    const config = require('./config');
    const { finalizeReview } = require('./utils/handleExamGrade');
    db.listenForExamUpdates(async (payload, source) => {
      try {
        // payload expected to be JSON like { sessionId: '...' } or plain session id
        let sessionId = null;
        try { const p = JSON.parse(payload || 'null'); sessionId = p && p.sessionId ? p.sessionId : (typeof payload === 'string' ? payload : null); } catch (e) { sessionId = payload; }
        if (!sessionId) return;
        console.info(`DB exam update received (source=${source}) session=${sessionId}`);
        const sess = await examStore.getSessionById(sessionId);
        if (!sess) return console.warn('DB listener: session not found', sessionId);
        if (sess.status === 'graded' && sess.review && !sess.review.processed) {
          console.info('DB listener: finalizing review for session', sessionId);
          await finalizeReview({ session: sess, client });
        }
      } catch (e) { console.error('Error handling DB exam update:', e); }
    }, {
      pollEnabled: config.EXAM_DB_POLL_ENABLED,
      pollMs: config.EXAM_DB_POLL_MS
    }).catch(err => console.error('Failed to start DB exam update listener:', err));
  } catch (e) { console.debug && console.debug('DB listener not started (no DB configured?)', e.message || e); }
  // Start probation watcher to handle role-change based alerts
  try { probationWatcher.init(client); } catch (e) { console.error('Failed to init probationWatcher:', e); }
  // Start verification reminder scheduler
  try { verifyReminderScheduler.initScheduler(client); } catch (e) { console.error('Failed to init verifyReminderScheduler:', e); }
});

// Guild member join/leave hooks for verification reminders
client.on('guildMemberAdd', async (member) => {
  try { await verifyReminderScheduler.onGuildMemberAdd(member); } catch (e) { console.error('verifyReminderScheduler onGuildMemberAdd failed', e); }
});
client.on('guildMemberRemove', async (member) => {
  try { await verifyReminderScheduler.onGuildMemberRemove(member); } catch (e) { console.error('verifyReminderScheduler onGuildMemberRemove failed', e); }
});

// Interaction handler
client.on("interactionCreate", async interaction => {
  await handleInteraction(interaction, client);
});

// Message handler for Trello ingestion
client.on("messageCreate", async message => {
  // Handle exam DM answers first
  try { await handleExamDM(message, client); } catch (e) { /* continue to other handlers */ }
  try { await handleXpAuditLogMessage(message, client); } catch (e) { console.error('XP watcher failed:', e); }
  await handleMessageCommands(message, client);
  await handleTrelloIngest(message);
  await handleTimeWebhookMessage(message);
});
// Login to Discord
client.login(process.env.DISCORD_TOKEN);
