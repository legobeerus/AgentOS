require("dotenv").config();
const { startKeepAlive } = require("./utils/dbKeepAlive");
const verificationStore = require('./utils/verificationStore');
const arrestStore = require('./utils/arrestStore');
const { Client, GatewayIntentBits } = require("discord.js");
const { loadCommands } = require("./utils/loadCommands");
const { handleInteraction } = require("./utils/handleInteraction");
const { handleTrelloIngest } = require("./utils/trelloMessageIngest");
const { handleMessageCommands } = require("./utils/messageCommands");
const { handleTimeWebhookMessage } = require("./utils/timeWebhookHandler");
const { startSuspensionScheduler } = require("./utils/trelloSuspensionScheduler");
const { createFormServer } = require("./utils/createFormServer");

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
} else {
  console.info('DATABASE_URL not set — skipping verificationStore init.');
}

// Load all commands
loadCommands(client);

// Ready event
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
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
  await handleMessageCommands(message, client);
  await handleTrelloIngest(message);
  await handleTimeWebhookMessage(message);
});
// Login to Discord
client.login(process.env.DISCORD_TOKEN);
