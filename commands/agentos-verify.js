const { SlashCommandBuilder } = require('discord.js');
const verificationStore = require('../utils/verificationStore');
const axios = require('axios');
const crypto = require('crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('agentos-verify')
    .setDescription('Link your Discord account to a Roblox username (two-step)')
    .addSubcommand(sub => sub.setName('start').setDescription('Begin verification for a Roblox username').addStringOption(opt => opt.setName('roblox').setDescription('Roblox username').setRequired(true)))
    .addSubcommand(sub => sub.setName('confirm').setDescription('Confirm verification after placing the code in your Roblox profile').addStringOption(opt => opt.setName('roblox').setDescription('Roblox username').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const roblox = String(interaction.options.getString('roblox') || '').trim();
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
    if (!robloxId) return interaction.editReply({ content: 'Failed to resolve Roblox username. Please check the name.' });

    if (sub === 'start') {
      // generate one-time code
      const code = crypto.randomBytes(4).toString('hex');
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      try {
        await verificationStore.createChallenge(roblox, robloxId, discordId, code, expires);
        const instructions = `To verify ownership of Roblox account **${roblox}**, add the following one-time code to your Roblox profile "About" or "Status" field (or bio):\n\n**${code}**\n\nAfter adding it, run /agentos-verify confirm roblox:${roblox} within 10 minutes.`;
        return interaction.editReply({ content: instructions, ephemeral: true });
      } catch (err) {
        console.error('Failed to create verification challenge:', err);
        return interaction.editReply({ content: 'Failed to initiate verification. Try again later.' });
      }
    }

    if (sub === 'confirm') {
      try {
        const chal = await verificationStore.getChallenge(roblox, discordId);
        if (!chal) return interaction.editReply({ content: 'No active verification challenge found. Run the `start` subcommand first.' });
        if (new Date(chal.expires_at) < new Date()) {
          await verificationStore.clearChallenge(roblox, discordId);
          return interaction.editReply({ content: 'Your verification challenge has expired. Run `start` again.' });
        }

        // Attempt to fetch profile/about/status from Roblox API in several ways
        let profileText = '';
        try {
          const p1 = await axios.get(`https://users.roblox.com/v1/users/${robloxId}/profile`).catch(() => null);
          if (p1 && p1.data) profileText += ' ' + JSON.stringify(p1.data);
        } catch (e) {}
        try {
          const p2 = await axios.get(`https://users.roblox.com/v1/users/${robloxId}/status`).catch(() => null);
          if (p2 && p2.data) profileText += ' ' + JSON.stringify(p2.data);
        } catch (e) {}
        try {
          const p3 = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`).catch(() => null);
          if (p3 && p3.data) profileText += ' ' + JSON.stringify(p3.data);
        } catch (e) {}
        // Fallback: fetch public profile HTML and search
        try {
          const html = await axios.get(`https://www.roblox.com/users/${robloxId}/profile`).then(r => r.data).catch(() => null);
          if (html) profileText += ' ' + String(html);
        } catch (e) {}

        if (!profileText || !profileText.includes(chal.code)) {
          return interaction.editReply({ content: 'Could not find the verification code in the Roblox profile. Ensure you added the exact code to your About/Status and try again.' });
        }

        // Create permanent verification
        try {
          const v = await verificationStore.addVerification(roblox, robloxId, discordId);
          await verificationStore.clearChallenge(roblox, discordId);
          return interaction.editReply({ content: `Verified: ${v.roblox_username} ↔ <@${v.discord_id}>` });
        } catch (err) {
          if (err && err.message === 'roblox_already_bound') return interaction.editReply({ content: 'That Roblox username is already bound to another Discord account.' });
          if (err && err.message === 'discord_already_bound') return interaction.editReply({ content: 'Your Discord account is already bound to a different Roblox username.' });
          console.error('Failed to finalize verification:', err);
          return interaction.editReply({ content: 'Failed to complete verification. Try again later.' });
        }
      } catch (err) {
        console.error('verification confirm error:', err);
        return interaction.editReply({ content: 'An error occurred while confirming verification.' });
      }
    }
  }
};
