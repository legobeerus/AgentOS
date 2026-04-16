const { SlashCommandBuilder } = require('discord.js');
const verificationStore = require('../utils/verificationStore');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Discord account to a Roblox username')
    .addStringOption(opt => opt.setName('roblox').setDescription('Roblox username').setRequired(true)),
  async execute(interaction) {
    const roblox = interaction.options.getString('roblox').trim();
    const discordId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    // resolve roblox id via Roblox API
    let robloxId = null;
    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [roblox], excludeBannedUsers: true });
      if (res.data && res.data.data && res.data.data[0]) robloxId = res.data.data[0].id;
    } catch (err) {
      console.warn('Failed to fetch Roblox user id:', err?.response?.data || err.message || err);
    }
    if (!robloxId) return interaction.editReply({ content: 'Failed to resolve Roblox username. Please check the name.' });

    try {
      const row = await verificationStore.addVerification(roblox, robloxId, discordId);
      return interaction.editReply({ content: `Verified: ${row.roblox_username} ↔ <@${row.discord_id}>` });
    } catch (err) {
      if (err && err.message === 'roblox_already_bound') {
        return interaction.editReply({ content: 'That Roblox username is already bound to another Discord account.' });
      }
      if (err && err.message === 'discord_already_bound') {
        return interaction.editReply({ content: 'Your Discord account is already bound to a different Roblox username.' });
      }
      console.error('verify command failed:', err);
      return interaction.editReply({ content: 'Failed to create verification. Try again later.' });
    }
  },
};
