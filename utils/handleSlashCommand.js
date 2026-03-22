/**
 * Handles slash command interactions
 * @param {CommandInteraction} interaction - The interaction that triggered the handler
 * @param {Client} client - Discord client instance
 */
async function handleSlashCommand(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Check if command is paused
  try {
    const { isPaused } = require('./pausedCommands');
    const paused = await isPaused(interaction.commandName);
    if (paused) {
      return interaction.reply({ content: '❗ This command is temporarily paused by an administrator.', ephemeral: true });
    }
  } catch (e) {
    // ignore DB errors and allow command to run
    console.error('Failed to check paused state for command:', e);
  }

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

module.exports = { handleSlashCommand };
