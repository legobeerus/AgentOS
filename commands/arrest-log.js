const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const arrestStore = require('../utils/arrestStore');

function logArrestDebug(level, interaction, message, extra) {
  const prefix = `[arrest-log][${interaction && interaction.id ? interaction.id : 'no-interaction-id'}]`;
  const base = `${prefix} ${message}`;
  const payload = extra || {};

  if (level === 'error') {
    console.error(base, payload);
    return;
  }
  if (level === 'warn') {
    console.warn(base, payload);
    return;
  }
  console.info(base, payload);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arrest-log')
    .setDescription('Log an arrest record')
    .addStringOption(opt => opt.setName('suspect').setDescription('Roblox username of suspect').setRequired(true))
    .addStringOption(opt => opt.setName('summary').setDescription('Brief description of the incident').setRequired(true))
    .addStringOption(opt => opt.setName('charges').setDescription('List of charges, listed as [X.X] Law Name').setRequired(true))
    .addStringOption(opt => opt.setName('sentence').setDescription('Time jailed').setRequired(true))
    .addStringOption(opt => opt.setName('proof').setDescription('Link to media evidence').setRequired(true)),

  async execute(interaction) {
    logArrestDebug('info', interaction, 'Command received', {
      userId: interaction.user && interaction.user.id,
      userTag: interaction.user && interaction.user.tag,
      guildId: interaction.guildId || null,
      channelId: interaction.channelId || null,
      commandName: interaction.commandName,
      options: interaction.options && interaction.options.data
        ? interaction.options.data.map(o => ({ name: o.name, value: o.value }))
        : []
    });

    await interaction.deferReply({ ephemeral: true });
    logArrestDebug('info', interaction, 'Deferred reply', { ephemeral: true });

    // Validate membership/role strictly in the configured arrest guild.
    try {
      const reqRole = config.ARREST_REQUIRED_ROLE_ID;
      logArrestDebug('info', interaction, 'Starting permission validation', {
        requiredRoleId: reqRole || null,
        configuredArrestGuildId: config.ARREST_GUILD_ID || null
      });

      if (reqRole) {
        const permissionGuildId = String(config.ARREST_GUILD_ID || '').trim();
        if (!permissionGuildId) {
          logArrestDebug('warn', interaction, 'Permission denied: ARREST_GUILD_ID missing', {
            requiredRoleId: reqRole
          });
          await interaction.editReply({ content: '❌ Arrest permission guild is not configured.', ephemeral: true });
          return;
        }

        const permissionGuild = interaction.client.guilds.cache.get(permissionGuildId)
          || await interaction.client.guilds.fetch(permissionGuildId).catch(() => null);
        if (!permissionGuild) {
          logArrestDebug('warn', interaction, 'Permission denied: configured guild could not be resolved', {
            permissionGuildId
          });
          await interaction.editReply({ content: '❌ Could not resolve the arrest permission guild.', ephemeral: true });
          return;
        }

        logArrestDebug('info', interaction, 'Configured guild resolved', {
          permissionGuildId,
          permissionGuildName: permissionGuild.name || null,
          botInGuild: true
        });

        const fetchedMember = await permissionGuild.members.fetch(interaction.user.id).catch(() => null);
        if (!fetchedMember) {
          logArrestDebug('warn', interaction, 'Permission denied: user is not a member of configured guild or fetch failed', {
            permissionGuildId,
            userId: interaction.user && interaction.user.id
          });
        }

        const fetchedRoleIds = fetchedMember && fetchedMember.roles && fetchedMember.roles.cache
          ? Array.from(fetchedMember.roles.cache.keys())
          : [];
        const hasRequiredRole = !!(fetchedMember && fetchedMember.roles && fetchedMember.roles.cache && fetchedMember.roles.cache.has(reqRole));

        logArrestDebug('info', interaction, 'Permission role evaluation complete', {
          permissionGuildId,
          requiredRoleId: reqRole,
          hasRequiredRole,
          fetchedRoleCount: fetchedRoleIds.length,
          fetchedRoleIds
        });

        if (!hasRequiredRole) {
          logArrestDebug('warn', interaction, 'Permission denied: missing required role in configured guild', {
            permissionGuildId,
            requiredRoleId: reqRole,
            userId: interaction.user && interaction.user.id
          });
          await interaction.editReply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
          return;
        }
      }
    } catch (e) {
      logArrestDebug('error', interaction, 'Permission check failed with exception', {
        message: e && e.message,
        stack: e && e.stack
      });
      try { await interaction.editReply({ content: '❌ Permission check failed.', ephemeral: true }); } catch (_) {}
      return;
    }

    const suspect = interaction.options.getString('suspect');
    const summary = interaction.options.getString('summary');
    const charges = interaction.options.getString('charges');
    const sentence = interaction.options.getString('sentence');
    const proof = interaction.options.getString('proof') || '';

    logArrestDebug('info', interaction, 'Input parsed and permission granted', {
      suspect,
      sentence,
      proofLength: proof.length,
      summaryLength: String(summary || '').length,
      chargesLength: String(charges || '').length
    });

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

      logArrestDebug('info', interaction, 'Arrest record created', {
        recordId: record && record.id,
        createdAt: record && record.created_at,
        submittedBy: record && record.submitted_by
      });

      let createdDisplay = 'Unknown';
      if (record.created_at) {
        const created = new Date(record.created_at);
        const ts = Math.floor(created.getTime() / 1000);
        createdDisplay = `<t:${ts}:f> (<t:${ts}:R>)`;
      }

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
        .setFooter({ text: `Record ID: ${record.id} • ${createdDisplay}` });

      // Post to configured arrest channel
      const channelId = config.ARREST_LOG_CHANNEL_ID;
      const channel = await interaction.client.channels.fetch(channelId).catch((fetchErr) => {
        logArrestDebug('error', interaction, 'Failed to fetch arrest log channel', {
          channelId,
          message: fetchErr && fetchErr.message,
          stack: fetchErr && fetchErr.stack
        });
        return null;
      });

      if (!channel) {
        logArrestDebug('warn', interaction, 'Arrest log channel unavailable; continuing without channel post', {
          channelId
        });
      } else {
        await channel.send({ embeds: [embed] }).then((sent) => {
          logArrestDebug('info', interaction, 'Arrest embed posted', {
            channelId: channel.id,
            messageId: sent && sent.id
          });
        }).catch((sendErr) => {
          logArrestDebug('error', interaction, 'Failed to post arrest embed', {
            channelId: channel.id,
            message: sendErr && sendErr.message,
            stack: sendErr && sendErr.stack
          });
        });
      }

      await interaction.editReply({ content: `Arrest logged (ID ${record.id}).`, ephemeral: true });
      logArrestDebug('info', interaction, 'User success reply sent', {
        recordId: record.id
      });
    } catch (e) {
      logArrestDebug('error', interaction, 'arrest-log failed during create/post flow', {
        message: e && e.message,
        stack: e && e.stack
      });
      await interaction.editReply({ content: 'Failed to log arrest.', ephemeral: true });
    }
  }
};
