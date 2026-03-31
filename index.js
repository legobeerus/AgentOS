require("dotenv").config();
const { startKeepAlive } = require("./utils/dbKeepAlive");
const { Client, GatewayIntentBits } = require("discord.js");
const { loadCommands } = require("./utils/loadCommands");
const { handleInteraction } = require("./utils/handleInteraction");
const { handleTrelloIngest } = require("./utils/trelloMessageIngest");
const { handleMessageCommands } = require("./utils/messageCommands");
const { handleGameWebhookMessage } = require("./utils/gameWebhookHandler");
const { startSuspensionScheduler } = require("./utils/trelloSuspensionScheduler");
const { createFormServer } = require("./utils/createFormServer");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ]
});

const { startInactivityScheduler } = require("./utils/inactivityScheduler");
const { startFollowupScheduler } = require("./utils/followupScheduler");

// Start DB keep-alive (if configured)
startKeepAlive();

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
});

// Interaction handler
client.on("interactionCreate", async interaction => {
  await handleInteraction(interaction, client);
});

// Message handler for Trello ingestion
client.on("messageCreate", async message => {
  await handleMessageCommands(message, client);
  await handleTrelloIngest(message);
  await handleGameWebhookMessage(message);
});
// Login to Discord
client.login(process.env.DISCORD_TOKEN);
