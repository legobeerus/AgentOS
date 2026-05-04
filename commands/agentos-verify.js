const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const verificationStore = require('../utils/verificationStore');
const axios = require('axios');
const crypto = require('crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('agentos-verify')
    .setDescription('Link your Discord account to a Roblox username (one-click confirm)')
    .addStringOption(opt => opt.setName('username').setDescription('Roblox username').setRequired(true)),

  async execute(interaction) {
    const roblox = String(interaction.options.getString('username') || '').trim();
    const discordId = interaction.user.id;
    await interaction.deferReply({ ephemeral: true });

    // resolve roblox id
    let robloxId = null;
    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [roblox], excludeBannedUsers: true });
      if (res.data && res.data.data && res.data.data[0]) robloxId = res.data.data[0].id;
    } catch (err) {
      console.warn('Failed to fetch Roblox user id:', err?.response?.data || err.message || err);
    }
    if (!robloxId) {
      const e = new EmbedBuilder().setTitle('Verification Error').setColor(0xed4245).setDescription('Failed to resolve Roblox username. Please check the name.');
      return interaction.editReply({ embeds: [e], ephemeral: true });
    }

    // generate one-time code and present a Confirm button so user doesn't have to run a second command
    const code = crypto.randomBytes(4).toString('hex');
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    try {
      await verificationStore.createChallenge(roblox, robloxId, discordId, code, expires);
      const startEmbed = new EmbedBuilder()
        .setTitle('AgentOS Verification')
        .setColor(0x00aff1)
        .setDescription(`To verify ownership of Roblox account **${roblox}**, add the following one-time code to your Roblox profile "About" section.):\n\n**${code}**\n\nAfter adding it, click the **Confirm** button below within 10 minutes.`)
        .setTimestamp(new Date());

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`agentos_verify_confirm:${roblox}`).setLabel('Confirm').setStyle(ButtonStyle.Primary)
      );

      return interaction.editReply({ embeds: [startEmbed], components: [row], ephemeral: true });
    } catch (err) {
      console.error('Failed to create verification challenge:', err);
      const e = new EmbedBuilder().setTitle('Verification Error').setColor(0xed4245).setDescription('Failed to initiate verification. Try again later.');
      return interaction.editReply({ embeds: [e], ephemeral: true });
    }
  }
};
