require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { loadCommands } = require("./utils/loadCommands");
const { handleInteraction } = require("./utils/handleInteraction");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Load all commands
loadCommands(client);

// Ready event
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Interaction handler
client.on("interactionCreate", async interaction => {
  await handleInteraction(interaction, client);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
