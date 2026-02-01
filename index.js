require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { loadCommands } = require("./utils/loadCommands");
const { handleInteraction } = require("./utils/handleInteraction");
const { createFormServer } = require("./utils/createFormServer");

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

// Start Express server for form submissions
const app = createFormServer(client);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Form submission server listening on port ${PORT}`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
