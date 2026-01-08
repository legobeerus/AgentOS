require("dotenv").config();
const { Client, Collection, GatewayIntentBits, ActionRowBuilder, ButtonBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config");

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

  // ─── SLASH COMMANDS ─────────────────────────
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    if (command.guildOnly && interaction.guildId !== command.guildOnly) {
      return interaction.reply({
      content: "❌ This command is not available in this server.",
      ephemeral: true
      });
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Error executing command.", ephemeral: true });
      }
    }
  }

  // ─── BUTTONS ─────────────────────────────────
  if (interaction.isButton()) {
    if (interaction.customId !== "approve_request") return;

    await interaction.deferUpdate();

    if (interaction.message.components[0].components[0].disabled) {
      return interaction.followUp({
      content: "⚠️ This case has already been approved.",
      ephemeral: true
  });
}

    // ROLE CHECK (from config)
    if (!interaction.member.roles.cache.has(config.REQUIRED_ROLE_ID)) {
      return interaction.followUp({
        content: "❌ You do not have permission to approve this.",
        ephemeral: true
      });
    }

    const channel = await interaction.guild.channels.fetch(config.TARGET_CHANNEL_ID);

    const messageLink = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${interaction.message.id}`;

    const embed = interaction.message.embeds[0];
    const caseField = embed.fields.find(f => f.name === "Case Number");
    const casenumber = caseField?.value ?? "Unknown";

    const msg = await channel.send({
      content: `<@&${config.PING_ROLE_ID}> | [${casenumber}] | ${messageLink}`
    });

    await msg.startThread({
      name: "Punishment Discussion"
    });

    // Disable the button
    const disabledRow = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.component).setDisabled(true)
    );

    await interaction.message.edit({
      components: [disabledRow]
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
