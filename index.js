require("dotenv").config();
const { startKeepAlive } = require("./utils/dbKeepAlive");
const { Client, GatewayIntentBits } = require("discord.js");
const { loadCommands } = require("./utils/loadCommands");
const { handleInteraction } = require("./utils/handleInteraction");
const { handleTrelloIngest } = require("./utils/trelloMessageIngest");
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

// Start DB keep-alive (if configured)
startKeepAlive();

// Load all commands
loadCommands(client);

// Ready event
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  startSuspensionScheduler();
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
  await handleTrelloIngest(message);
});
// Login to Discord
client.login(process.env.DISCORD_TOKEN);
