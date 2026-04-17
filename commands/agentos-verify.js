const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const verificationStore = require('../utils/verificationStore');
const axios = require('axios');
const crypto = require('crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('agentos-verify')
    .setDescription('Link your Discord account to a Roblox username (two-step)')
    .addSubcommand(sub => sub.setName('start').setDescription('Begin Roblox user verification').addStringOption(opt => opt.setName('username').setDescription('Roblox username').setRequired(true)))
    .addSubcommand(sub => sub.setName('confirm').setDescription('Confirm verification after placing the code in your Roblox profile').addStringOption(opt => opt.setName('username').setDescription('Roblox username').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
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

    if (sub === 'start') {
      // generate one-time code
      const code = crypto.randomBytes(4).toString('hex');
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      try {
        await verificationStore.createChallenge(roblox, robloxId, discordId, code, expires);
        const startEmbed = new EmbedBuilder()
          .setTitle('AgentOS Verification — Start')
          .setColor(0x00aff1)
          .setDescription(`To verify ownership of Roblox account **${roblox}**, add the following one-time code to your Roblox profile "About" or "Status" field (or bio):\n\n**${code}**\n\nAfter adding it, run /agentos-verify confirm username:${roblox} within 10 minutes.`)
          .setTimestamp(new Date());
        return interaction.editReply({ embeds: [startEmbed], ephemeral: true });
      } catch (err) {
        console.error('Failed to create verification challenge:', err);
        const e = new EmbedBuilder().setTitle('Verification Error').setColor(0xed4245).setDescription('Failed to initiate verification. Try again later.');
        return interaction.editReply({ embeds: [e], ephemeral: true });
      }
    }

    if (sub === 'confirm') {
      try {
        const chal = await verificationStore.getChallenge(roblox, discordId);
        if (!chal) {
          const noEmbed = new EmbedBuilder().setTitle('Verification — No Active Challenge').setColor(0xed4245).setDescription('No active verification challenge found. Run the `start` subcommand first.');
          return interaction.editReply({ embeds: [noEmbed], ephemeral: true });
        }
        if (new Date(chal.expires_at) < new Date()) {
          await verificationStore.clearChallenge(roblox, discordId);
          const expEmbed = new EmbedBuilder().setTitle('Verification — Expired').setColor(0xed4245).setDescription('Your verification challenge has expired. Run `start` again.');
          return interaction.editReply({ embeds: [expEmbed], ephemeral: true });
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
          const notFound = new EmbedBuilder().setTitle('Verification — Code Not Found').setColor(0xed4245).setDescription('Could not find the verification code in the Roblox profile. Ensure you added the exact code to your About/Status and try again.');
          return interaction.editReply({ embeds: [notFound], ephemeral: true });
        }

        // Create permanent verification
        try {
          const v = await verificationStore.addVerification(roblox, robloxId, discordId);
          await verificationStore.clearChallenge(roblox, discordId);
          // Edit the ephemeral reply to a small confirmation, then post a public embed announcing verification
          const okEmbedEphemeral = new EmbedBuilder().setTitle('Verification Complete').setColor(0x57F287).setDescription('Verification succeeded — announcing publicly.');
          await interaction.editReply({ embeds: [okEmbedEphemeral], ephemeral: true });
          const publicEmbed = new EmbedBuilder()
            .setTitle('AgentOS Verification — Successful')
            .setColor(0x57F287)
            .setDescription(`Verified: **${v.roblox_username}** ↔ <@${v.discord_id}>`)
            .setTimestamp(new Date());
          // followUp without ephemeral will be public
          await interaction.followUp({ embeds: [publicEmbed] });
          return;
        } catch (err) {
          if (err && err.message === 'roblox_already_bound') {
            const e = new EmbedBuilder().setTitle('Verification Failed').setColor(0xed4245).setDescription('That Roblox username is already bound to another Discord account.');
            return interaction.editReply({ embeds: [e], ephemeral: true });
          }
          if (err && err.message === 'discord_already_bound') {
            const e = new EmbedBuilder().setTitle('Verification Failed').setColor(0xed4245).setDescription('Your Discord account is already bound to a different Roblox username.');
            return interaction.editReply({ embeds: [e], ephemeral: true });
          }
          console.error('Failed to finalize verification:', err);
          const e = new EmbedBuilder().setTitle('Verification Error').setColor(0xed4245).setDescription('Failed to complete verification. Try again later.');
          return interaction.editReply({ embeds: [e], ephemeral: true });
        }
      } catch (err) {
        console.error('verification confirm error:', err);
        const e = new EmbedBuilder().setTitle('Verification Error').setColor(0xed4245).setDescription('An error occurred while confirming verification.');
        return interaction.editReply({ embeds: [e], ephemeral: true });
      }
    }
  }
};
