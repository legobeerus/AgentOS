require("dotenv").config();
const { Client, Collection, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: "Error executing command.", ephemeral: true });
  
  if (!interaction.isButton()) return;

    if (interaction.customId !== "approve_request") return;

    await interaction.deferUpdate();

    // ROLE CHECK
    const REQUIRED_ROLE_ID = "1449861438012133566";
    if (!interaction.member.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.reply({
        content: "❌ You do not have permission to approve this.",
        ephemeral: true
    });
  }

    // Send message
    const TARGET_CHANNEL_ID = "1449832209316839455";
    const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
    const messageLink = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${interaction.message.id}`;

    const msg = await channel.send({
      content: `@1041577710067138561 [${casenumber}] ${messageLink}`
    });

    // Start a thread
    await msg.startThread({
      name: `${casenumber}`,
    });

    // Disable the button
    const disabledRow = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.component).setDisabled(true)
    );

    await interaction.update({
      components: [disabledRow]
    });
  
  }
});

client.login(process.env.DISCORD_TOKEN);
