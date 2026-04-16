const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const arrestStore = require('../utils/arrestStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arrest-log')
    .setDescription('Log an arrest record')
    .addStringOption(opt => opt.setName('suspect').setDescription('Roblox username of suspect').setRequired(true))
    .addStringOption(opt => opt.setName('summary').setDescription('Incident summary').setRequired(true))
    .addStringOption(opt => opt.setName('charges').setDescription('Charge(s)').setRequired(true))
    .addStringOption(opt => opt.setName('sentence').setDescription('Sentence').setRequired(true))
    .addStringOption(opt => opt.setName('proof').setDescription('Proof (link or notes)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const suspect = interaction.options.getString('suspect');
    const summary = interaction.options.getString('summary');
    const charges = interaction.options.getString('charges');
    const sentence = interaction.options.getString('sentence');
    const proof = interaction.options.getString('proof') || '';

    try {
      const record = await arrestStore.createArrest({
        roblox_username: suspect,
        incident_summary: summary,
        charges,
        sentence,
        proof,
        submitted_by: interaction.user.id,
        submitted_by_tag: interaction.user.tag
      });

      const embed = new EmbedBuilder()
        .setTitle(`Arrest Log: ${record.roblox_username}`)
        .setColor(config.EMBED_COLOR)
        .addFields(
          { name: 'Suspect', value: record.roblox_username, inline: true },
          { name: 'Submitted By', value: `${record.submitted_by_tag} (${record.submitted_by})`, inline: true },
          { name: 'Charges', value: record.charges || 'None', inline: false },
          { name: 'Sentence', value: record.sentence || 'None', inline: false },
          { name: 'Incident Summary', value: record.incident_summary || 'None', inline: false },
          { name: 'Proof', value: record.proof || 'None', inline: false }
        )
        .setFooter({ text: `Record ID: ${record.id} • ${new Date(record.created_at).toISOString()}` });

      // Post to configured arrest channel
      const channel = await interaction.client.channels.fetch(config.ARREST_LOG_CHANNEL_ID).catch(() => null);
      if (channel) {
        await channel.send({ embeds: [embed] }).catch(() => {});
      }

      await interaction.editReply({ content: `Arrest logged (ID ${record.id}).`, ephemeral: true });
    } catch (e) {
      console.error('arrest-log failed:', e);
      await interaction.editReply({ content: 'Failed to log arrest.', ephemeral: true });
    }
  }
};
