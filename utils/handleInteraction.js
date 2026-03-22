const { handleSlashCommand } = require("./handleSlashCommand");
const { handleApproveButton } = require("./handleApproveButton");
const { handleFormReview } = require("./handleFormReview");
const { handleReviewModal } = require("./handleReviewModal");
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { getChangelog, setChangelog } = require('./changelogStore');
const { getState, setState } = require('./adminState');
const pausedCommands = require('./pausedCommands');

/**
 * Main interaction handler that routes to appropriate handlers
 * @param {Interaction} interaction - The interaction that was triggered
 * @param {Client} client - Discord client instance
 */
async function handleInteraction(interaction, client) {
  try {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, client);
      return;
    }

    // Handle button interactions
    if (interaction.isButton()) {
      if (interaction.customId === "approve_request") {
        await handleApproveButton(interaction);
        return;
      }

      if (interaction.customId === "approve" || interaction.customId === "deny") {
        await handleFormReview(interaction);
        return;
      }

      // Admin buttons
      if (interaction.customId === 'admin_toggle_pause') {
        await interaction.deferUpdate();
        const s = await getState();
        const updated = await setState({ pausedApplications: !s.pausedApplications });
        try {
          await interaction.followUp({ content: `Paused Applications: ${updated.pausedApplications}`, ephemeral: true });
        } catch (e) {}
        return;
      }

      if (interaction.customId === 'admin_toggle_debug') {
        await interaction.deferUpdate();
        const s = await getState();
        const updated = await setState({ debugMode: !s.debugMode });
        try {
          await interaction.followUp({ content: `Debug Mode: ${updated.debugMode}`, ephemeral: true });
        } catch (e) {}
        return;
      }

      if (interaction.customId === 'admin_show_changelog') {
        await interaction.deferReply({ ephemeral: true });
        const cl = await getChangelog();
        const embed = new EmbedBuilder()
          .setTitle(`Changelog ${cl.version || ''}`)
          .setColor(config.EMBED_COLOR)
          .addFields(
            { name: 'Additions', value: cl.additions || 'None', inline: false },
            { name: 'Notes', value: cl.notes || 'None', inline: false }
          )
          .setFooter({ text: `Updated: ${cl.updatedAt || 'never'}` });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (interaction.customId === 'admin_edit_changelog') {
        // show modal to collect version, additions, notes
        const modal = new ModalBuilder().setCustomId('admin_changelog_modal').setTitle('Edit Changelog');
        const versionInput = new TextInputBuilder().setCustomId('version').setLabel('Version').setStyle(TextInputStyle.Short).setRequired(true);
        const additionsInput = new TextInputBuilder().setCustomId('additions').setLabel('Additions (comma-separated or text)').setStyle(TextInputStyle.Paragraph).setRequired(false);
        const notesInput = new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(versionInput), new ActionRowBuilder().addComponents(additionsInput), new ActionRowBuilder().addComponents(notesInput));
        try {
          await interaction.showModal(modal);
        } catch (e) {
          console.error('Failed to show admin changelog modal:', e);
        }
        return;
      }

      if (interaction.customId === 'admin_manage_commands') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const commands = Array.from(client.commands.keys());
          if (!commands.length) {
            await interaction.editReply({ content: 'No registered commands found.' });
            return;
          }

          const embed = new EmbedBuilder().setTitle('Manage Slash Commands').setDescription('Toggle pause/unpause for individual slash commands.');
          const rows = [];
          // Build buttons (max 5 per row, up to 25 total)
          let currentRow = new ActionRowBuilder();
          let count = 0;
          for (const name of commands.slice(0, 25)) {
            const isP = await pausedCommands.isPaused(name).catch(() => false);
            const label = `${isP ? '⛔' : '✅'} ${name}`;
            const btn = new ButtonBuilder().setCustomId(`admin_cmd_toggle:${name}`).setLabel(label).setStyle(ButtonStyle.Secondary);
            currentRow.addComponents(btn);
            count += 1;
            if (count % 5 === 0) {
              rows.push(currentRow);
              currentRow = new ActionRowBuilder();
            }
          }
          if (currentRow.components && currentRow.components.length) rows.push(currentRow);

          await interaction.editReply({ embeds: [embed], components: rows });
        } catch (e) {
          console.error('Failed to build manage commands UI:', e);
          try { await interaction.editReply({ content: 'Failed to load commands.' }); } catch (_) {}
        }
        return;
      }

      if (typeof interaction.customId === 'string' && interaction.customId.startsWith('admin_cmd_toggle:')) {
        await interaction.deferUpdate();
        try {
          const name = interaction.customId.split(':')[1];
          const cur = await pausedCommands.isPaused(name);
          const updated = await pausedCommands.setPaused(name, !cur);
            await interaction.followUp({ content: `Command '${name}' is now ${updated.paused ? 'paused' : 'unpaused'}.`, ephemeral: true });
        } catch (e) {
          console.error('Failed to toggle command pause:', e);
          try { await interaction.followUp({ content: 'Failed to toggle pause state.', ephemeral: true }); } catch (_) {}
        }
        return;
      }
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("feedback_")) {
        await handleReviewModal(interaction);
        return;
      }

      if (interaction.customId === 'admin_changelog_modal') {
        try {
          const version = interaction.fields.getTextInputValue('version');
          const additions = interaction.fields.getTextInputValue('additions') || '';
          const notes = interaction.fields.getTextInputValue('notes') || '';
          const payload = await setChangelog({ version, additions, notes });
          await interaction.reply({ content: `Changelog updated (version ${payload.version}).`, ephemeral: true });
        } catch (e) {
          console.error('Failed to process changelog modal:', e);
          try { await interaction.reply({ content: 'Failed to update changelog.', ephemeral: true }); } catch (_) {}
        }
        return;
      }
    }
  } catch (error) {
    console.error("Unhandled error in interaction handler:", error);
  }
}

module.exports = { handleInteraction };
