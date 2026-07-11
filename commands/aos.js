const { SlashCommandBuilder, ChannelType } = require('discord.js');
const config = require('../config');
const { computeJailTimeFromCharges } = require('../utils/aosSentencing');
const { listActiveAosEntries } = require('../utils/aosForumLookup');

function hasAnyAllowedRole(member, roleIds) {
  if (!member || !member.roles || !member.roles.cache) return false;
  if (!Array.isArray(roleIds) || roleIds.length === 0) return true;
  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

function hasBannedRole(member) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return !!config.AOS_BANNED_ROLE_ID && member.roles.cache.has(config.AOS_BANNED_ROLE_ID);
}

function getAosForumThread(interaction) {
  const channel = interaction.channel;
  if (!channel || typeof channel.isThread !== 'function' || !channel.isThread()) {
    return { error: '❌ This subcommand must be used inside an AoS forum post thread.' };
  }
  if (String(channel.parentId) !== String(config.AOS_FORUM_CHANNEL_ID)) {
    return { error: '❌ This thread is not inside the configured AoS forum channel.' };
  }
  return { thread: channel };
}

function buildAosBody({ username, profile, victims, charges, summary, proof, jailMinutes }) {
  return [
    '# :OSI: **AOS Order** :OSI:',
    `<@&${config.AOS_PING_ROLE_ID}>`,
    '',
    '**Username:**',
    username,
    '',
    '**Profile:**',
    profile,
    '',
    '**Victim(s):**',
    victims,
    '',
    '**Charges:**',
    charges,
    '',
    '**Summary:**',
    summary,
    '',
    '**Proof:**',
    proof,
    '',
    `**Jail time has been set to ${jailMinutes} minutes.**`
  ].join('\n');
}

function uniqueTags(tags) {
  return Array.from(new Set(tags.filter(Boolean).map(String)));
}

function applyTagMutations(current, { add = [], remove = [] }) {
  const next = new Set((current || []).map(String));
  for (const tagId of add) next.add(String(tagId));
  for (const tagId of remove) next.delete(String(tagId));
  return Array.from(next);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aos')
    .setDescription('Manage Arrest-On-Sight forum warrants')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Create a new AoS forum post')
        .addStringOption(opt => opt.setName('username').setDescription('Target Roblox username').setRequired(true))
        .addStringOption(opt => opt.setName('profile').setDescription('Profile link').setRequired(true))
        .addStringOption(opt => opt.setName('victims').setDescription('Victim username(s)').setRequired(true))
        .addStringOption(opt => opt.setName('charges').setDescription('Use format like: 1x [1.1] Charge').setRequired(true))
        .addStringOption(opt => opt.setName('summary').setDescription('Summary of offense').setRequired(true))
        .addStringOption(opt => opt.setName('proof').setDescription('Proof link(s)').setRequired(true))
        .addStringOption(opt =>
          opt
            .setName('infraction')
            .setDescription('Optional infraction level tag')
            .setRequired(false)
            .addChoices(
              { name: 'Light', value: 'light' },
              { name: 'Medium', value: 'medium' },
              { name: 'Heavy', value: 'heavy' }
            )
        )
        .addStringOption(opt =>
          opt
            .setName('reward')
            .setDescription('Optional reward tag')
            .setRequired(false)
            .addChoices(
              { name: 'Medal', value: 'medal' },
              { name: 'Requisition', value: 'requisition' }
            )
        )
        .addBooleanOption(opt =>
          opt
            .setName('expires_30_days')
            .setDescription('Apply the 30-day time limit tag')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('approve')
        .setDescription('Approve an AoS and ensure it is active')
    )
    .addSubcommand(sub =>
      sub
        .setName('complete')
        .setDescription('Mark an active AoS as completed')
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List all currently active AoS entries')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.inGuild()) {
      await interaction.editReply('❌ This command can only be used in a server.');
      return;
    }

    const sub = interaction.options.getSubcommand();
    const bannedRole = hasBannedRole(interaction.member);

    if (sub !== 'list' && bannedRole) {
      await interaction.editReply('❌ You are not allowed to use this AoS subcommand.');
      return;
    }

    if (sub === 'add') {
      if (!hasAnyAllowedRole(interaction.member, config.AOS_ADD_ROLE_IDS_LIST)) {
        await interaction.editReply('❌ You do not have permission to run /aos add.');
        return;
      }

      const username = interaction.options.getString('username', true).trim();
      const profile = interaction.options.getString('profile', true).trim();
      const victims = interaction.options.getString('victims', true).trim();
      const charges = interaction.options.getString('charges', true).trim();
      const summary = interaction.options.getString('summary', true).trim();
      const proof = interaction.options.getString('proof', true).trim();
      const infraction = interaction.options.getString('infraction');
      const reward = interaction.options.getString('reward');
      const expires30Days = !!interaction.options.getBoolean('expires_30_days');

      const sentencing = computeJailTimeFromCharges(charges);
      const jailMinutes = sentencing.totalMinutes;

      const content = buildAosBody({
        username,
        profile,
        victims,
        charges,
        summary,
        proof,
        jailMinutes
      });

      const forumChannel = await interaction.guild.channels.fetch(config.AOS_FORUM_CHANNEL_ID).catch(() => null);
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        await interaction.editReply('❌ AoS forum channel is missing or not a forum channel.');
        return;
      }

      const optionalTags = [];
      if (infraction === 'light') optionalTags.push(config.AOS_TAG_INFRACTION_LIGHT_ID);
      if (infraction === 'medium') optionalTags.push(config.AOS_TAG_INFRACTION_MEDIUM_ID);
      if (infraction === 'heavy') optionalTags.push(config.AOS_TAG_INFRACTION_HEAVY_ID);
      if (reward === 'medal') optionalTags.push(config.AOS_TAG_MEDAL_REWARD_ID);
      if (reward === 'requisition') optionalTags.push(config.AOS_TAG_REQUISITION_REWARD_ID);
      if (expires30Days) optionalTags.push(config.AOS_TAG_30_DAY_ID);

      const threadName = `AOS - ${username}`.slice(0, 100);

      try {
        const created = await forumChannel.threads.create({
          name: threadName,
          message: { content },
          appliedTags: uniqueTags(optionalTags)
        });

        let response = `✅ AoS created: ${created.url || `https://discord.com/channels/${interaction.guildId}/${created.id}`}\nComputed jail time: ${jailMinutes} minute(s).`;
        if (sentencing.unknownCodes.length) {
          response += `\n⚠️ Unknown law codes (counted as 0): ${sentencing.unknownCodes.join(', ')}`;
        }

        await interaction.editReply(response);
      } catch (err) {
        console.error('aos add failed:', err);
        await interaction.editReply('⚠️ Failed to create AoS forum post.');
      }
      return;
    }

    if (sub === 'approve') {
      if (!hasAnyAllowedRole(interaction.member, config.AOS_APPROVE_ROLE_IDS_LIST)) {
        await interaction.editReply('❌ You do not have permission to run /aos approve.');
        return;
      }

      const ctx = getAosForumThread(interaction);
      if (ctx.error) {
        await interaction.editReply(ctx.error);
        return;
      }

      const thread = ctx.thread;
      const tags = (thread.appliedTags || []).map(String);
      const hasApproved = tags.includes(String(config.AOS_TAG_APPROVED_ID));
      const hasActive = tags.includes(String(config.AOS_TAG_ACTIVE_WARRANT_ID));
      const hasInactive = tags.includes(String(config.AOS_TAG_INACTIVE_WARRANT_ID));
      const hasCompleted = tags.includes(String(config.AOS_TAG_COMPLETED_ID));

      if (hasApproved && hasActive && !hasInactive && !hasCompleted) {
        await interaction.editReply('⚠️ This AoS is already approved and active.');
        return;
      }

      const nextTags = applyTagMutations(tags, {
        add: [config.AOS_TAG_APPROVED_ID, config.AOS_TAG_ACTIVE_WARRANT_ID],
        remove: [config.AOS_TAG_INACTIVE_WARRANT_ID, config.AOS_TAG_COMPLETED_ID]
      });

      try {
        await thread.setAppliedTags(nextTags);
        const reopened = !hasActive || hasInactive || hasCompleted;
        await interaction.editReply(reopened
          ? '✅ AoS approved and set to active (re-opened).'
          : '✅ AoS approved and marked active.');
      } catch (err) {
        console.error('aos approve failed:', err);
        await interaction.editReply('⚠️ Failed to update AoS tags.');
      }
      return;
    }

    if (sub === 'complete') {
      if (!hasAnyAllowedRole(interaction.member, config.AOS_COMPLETE_ROLE_IDS_LIST)) {
        await interaction.editReply('❌ You do not have permission to run /aos complete.');
        return;
      }

      const ctx = getAosForumThread(interaction);
      if (ctx.error) {
        await interaction.editReply(ctx.error);
        return;
      }

      const thread = ctx.thread;
      const tags = (thread.appliedTags || []).map(String);
      const hasActive = tags.includes(String(config.AOS_TAG_ACTIVE_WARRANT_ID));

      if (!hasActive) {
        await interaction.editReply('❌ This AoS is not active, so it cannot be marked complete.');
        return;
      }

      const nextTags = applyTagMutations(tags, {
        add: [config.AOS_TAG_INACTIVE_WARRANT_ID, config.AOS_TAG_COMPLETED_ID],
        remove: [config.AOS_TAG_ACTIVE_WARRANT_ID]
      });

      try {
        await thread.setAppliedTags(nextTags);
        await thread.send(`✅ AoS marked complete by <@${interaction.user.id}>.`).catch(() => null);
        await thread.send(`<@&${config.AOS_COMPLETE_PING_ROLE_ID}>`).catch(() => null);
        await interaction.editReply('✅ AoS marked complete.');
      } catch (err) {
        console.error('aos complete failed:', err);
        await interaction.editReply('⚠️ Failed to update AoS tags.');
      }
      return;
    }

    if (sub === 'list') {
      if (!bannedRole && !hasAnyAllowedRole(interaction.member, config.AOS_ADD_ROLE_IDS_LIST)) {
        await interaction.editReply('❌ You do not have permission to run /aos list.');
        return;
      }

      try {
        const entries = await listActiveAosEntries(interaction.client);
        if (!entries.length) {
          await interaction.editReply('No active AoS entries found.');
          return;
        }

        const maxLines = 25;
        const lines = entries.slice(0, maxLines).map((entry, idx) => {
          const username = String(entry.username || 'Unknown').replace(/\n/g, ' ').trim();
          const charges = String(entry.charges || 'Unknown').replace(/\n/g, ' ').trim();
          return `${idx + 1}. Username: ${username} | Charges: ${charges}`;
        });

        const more = entries.length > maxLines ? `\n+${entries.length - maxLines} more active AoS not shown.` : '';
        const message = `**Active AoS (${entries.length})**\n${lines.join('\n')}${more}`;
        await interaction.editReply(message.slice(0, 1990));
      } catch (err) {
        console.error('aos list failed:', err);
        await interaction.editReply('⚠️ Failed to fetch active AoS entries.');
      }
      return;
    }

    await interaction.editReply('⚠️ Unknown subcommand.');
  }
};
