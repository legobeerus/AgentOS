const { ActionRowBuilder, ButtonBuilder } = require("discord.js");
const config = require("../config");

/**
 * Handles the approve_request button interaction
 * @param {ButtonInteraction} interaction - The button interaction
 */
async function handleApproveButton(interaction) {
  await interaction.deferUpdate();

  // Check if button is already disabled
  if (interaction.message.components[0].components[0].disabled) {
    return interaction.followUp({
      content: "⚠️ This case has already been approved.",
      ephemeral: true
    });
  }

  // Role check from config
  if (!interaction.member.roles.cache.has(config.REQUIRED_ROLE_ID)) {
    return interaction.followUp({
      content: "❌ You do not have permission to approve this.",
      ephemeral: true
    });
  }

  // Fetch target channel and send message with thread
  const channel = await interaction.guild.channels.fetch(config.TARGET_CHANNEL_ID);

  const messageLink = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${interaction.message.id}`;

  // Extract case number from embed
  const embed = interaction.message.embeds[0];
  const caseField = embed.fields.find(f => f.name === "Case Number");
  const casenumber = caseField?.value ?? "Unknown";

  // Send message to target channel with thread
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

module.exports = { handleApproveButton };
