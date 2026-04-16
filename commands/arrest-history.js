const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const arrestStore = require('../utils/arrestStore');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arrest-history')
    .setDescription('Lookup arrest history for a Roblox username')
    .addStringOption(opt => opt.setName('username').setDescription('Roblox username to lookup').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const username = interaction.options.getString('username');
    try {
      const arrests = await arrestStore.getArrestsByRoblox(username);
      if (!arrests || arrests.length === 0) {
        await interaction.editReply({ content: `No arrests found for ${username}.`, ephemeral: true });
        return;
      }

      // Build paginated embeds (5 per page)
      const pageSize = 5;
      const pages = [];
      for (let i = 0; i < arrests.length; i += pageSize) {
        const slice = arrests.slice(i, i + pageSize);
        const embed = new EmbedBuilder()
          .setTitle(`Arrests for ${username}`)
          .setColor(config.EMBED_COLOR)
          .setFooter({ text: `Page ${Math.floor(i / pageSize) + 1} of ${Math.ceil(arrests.length / pageSize)}` });
        for (const a of slice) {
          embed.addFields({ name: `ID ${a.id} • ${new Date(a.created_at).toISOString()}`, value: `Charges: ${a.charges || 'None'}\nSentence: ${a.sentence || 'None'}\nBy: ${a.submitted_by_tag || a.submitted_by}`, inline: false });
        }
        pages.push(embed);
      }

      const rows = [];
      const modifyBtn = new ButtonBuilder().setCustomId(`arrest_modify:${username}`).setLabel('Modify Arrests').setStyle(ButtonStyle.Primary);
      rows.push(new ActionRowBuilder().addComponents(modifyBtn));

      await interaction.editReply({ embeds: [pages[0]], components: rows, ephemeral: true });
    } catch (e) {
      console.error('arrest-history failed:', e);
      await interaction.editReply({ content: 'Failed to fetch arrest history.', ephemeral: true });
    }
  }
};
