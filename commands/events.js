const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const eventStore = require('../utils/eventStore');
const eventSystem = require('../utils/eventSystem');
const eventScheduler = require('../utils/eventScheduler');

const WEEKDAY_CHOICES = [
  { name: 'Sunday', value: '0' },
  { name: 'Monday', value: '1' },
  { name: 'Tuesday', value: '2' },
  { name: 'Wednesday', value: '3' },
  { name: 'Thursday', value: '4' },
  { name: 'Friday', value: '5' },
  { name: 'Saturday', value: '6' }
];

function parseDateInput(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  // Discord timestamp mention format: <t:unix[:style]>
  const discordTs = value.match(/^<t:(\d{1,13})(?::[tTdDfFR])?>$/);
  if (discordTs) {
    const unix = Number(discordTs[1]);
    const dt = new Date(unix > 9999999999 ? unix : unix * 1000);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  // Simple format: DD/MM/YYYY, HH:mm (interpreted as UTC)
  const simple = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*([01]?\d|2[0-3]):([0-5]\d)$/);
  if (simple) {
    const day = Number(simple[1]);
    const month = Number(simple[2]);
    const year = Number(simple[3]);
    const hour = Number(simple[4]);
    const minute = Number(simple[5]);

    const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    // Reject invalid rollover dates such as 31/02/2026.
    if (
      dt.getUTCFullYear() !== year ||
      (dt.getUTCMonth() + 1) !== month ||
      dt.getUTCDate() !== day
    ) {
      return null;
    }
    return dt;
  }

  return null;
}

function requireCorrectGuild(interaction) {
  const targetGuild = String(config.EVENT_GUILD_ID || '').trim();
  if (!targetGuild) return true;
  return String(interaction.guildId || '') === targetGuild;
}

function dbNotConfiguredReply(interaction) {
  return interaction.editReply({ content: 'Events database is not configured. Set DATABASE_URL before using /events.' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('events')
    .setDescription('Manage scheduled events and operations setup')
    .addSubcommand((sub) => sub
      .setName('setup')
      .setDescription('Create or refresh managed schedule and operations messages'))
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Add a scheduled event')
      .addStringOption((opt) => opt.setName('title').setDescription('Event title').setRequired(true))
      .addStringOption((opt) => opt.setName('hosts').setDescription('Host mentions or labels').setRequired(true))
      .addStringOption((opt) => opt.setName('description').setDescription('Event description').setRequired(true))
      .addStringOption((opt) => opt.setName('start').setDescription('One-off start: <t:unix> or DD/MM/YYYY, HH:mm').setRequired(false))
      .addBooleanOption((opt) => opt.setName('recurring').setDescription('Make this event recurring weekly').setRequired(false))
      .addStringOption((opt) => {
        opt.setName('weekday').setDescription('Recurring weekday (required when recurring=true)').setRequired(false);
        for (const c of WEEKDAY_CHOICES) opt.addChoices(c);
        return opt;
      })
      .addStringOption((opt) => opt.setName('time_utc').setDescription('Recurring UTC time HH:mm').setRequired(false))
      .addRoleOption((opt) => opt.setName('custom_ping_role').setDescription('Optional ping role override').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('edit')
      .setDescription('Edit an existing scheduled event')
      .addStringOption((opt) => opt.setName('id').setDescription('Event ID').setRequired(true))
      .addStringOption((opt) => opt.setName('title').setDescription('New title').setRequired(false))
      .addStringOption((opt) => opt.setName('hosts').setDescription('New host mentions or labels').setRequired(false))
      .addStringOption((opt) => opt.setName('description').setDescription('New description').setRequired(false))
      .addStringOption((opt) => opt.setName('start').setDescription('New one-off start: <t:unix> or DD/MM/YYYY, HH:mm').setRequired(false))
      .addBooleanOption((opt) => opt.setName('recurring').setDescription('Set recurring mode').setRequired(false))
      .addStringOption((opt) => {
        opt.setName('weekday').setDescription('Recurring weekday').setRequired(false);
        for (const c of WEEKDAY_CHOICES) opt.addChoices(c);
        return opt;
      })
      .addStringOption((opt) => opt.setName('time_utc').setDescription('Recurring UTC time HH:mm').setRequired(false))
      .addRoleOption((opt) => opt.setName('custom_ping_role').setDescription('Optional ping role override').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Remove a scheduled event')
      .addStringOption((opt) => opt.setName('id').setDescription('Event ID').setRequired(true))),

  guildOnly: String(config.EVENT_GUILD_ID || '').trim() || undefined,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!requireCorrectGuild(interaction)) {
      await interaction.editReply({ content: 'This command is only available in the configured event guild.' });
      return;
    }

    if (!eventSystem.canManageEvents(interaction.member, interaction.user.id)) {
      await interaction.editReply({ content: 'You do not have permission to manage events.' });
      return;
    }

    const sub = interaction.options.getSubcommand();

    try {
      await eventStore.ensureTables();
    } catch (err) {
      if (err && err.code === 'events_db_not_configured') {
        await dbNotConfiguredReply(interaction);
        return;
      }
      throw err;
    }

    if (sub === 'setup') {
      await eventSystem.setupEventMessages(interaction.client, interaction.guildId);
      await interaction.editReply({ content: 'Event schedule and operations panel messages are set up.' });
      return;
    }

    if (sub === 'add') {
      const count = await eventStore.countScheduledEvents(interaction.guildId);
      const cap = Number(config.EVENT_SCHEDULE_MAX_ENTRIES || 20);
      if (count >= cap) {
        await interaction.editReply({ content: `Schedule is full (${count}/${cap}). Remove an event before adding another.` });
        return;
      }

      const title = interaction.options.getString('title', true);
      const hosts = interaction.options.getString('hosts', true);
      const description = interaction.options.getString('description', true);
      const recurring = interaction.options.getBoolean('recurring') || false;
      const weekdayRaw = interaction.options.getString('weekday');
      const timeUtcRaw = interaction.options.getString('time_utc');
      const startRaw = interaction.options.getString('start');
      const customPingRole = interaction.options.getRole('custom_ping_role');

      let startAt = null;
      let nextRunAt = null;
      let recurringWeekday = null;
      let recurringTimeUtc = null;

      if (recurring) {
        if (weekdayRaw === null || !timeUtcRaw) {
          await interaction.editReply({ content: 'Recurring events require both weekday and time_utc.' });
          return;
        }
        recurringWeekday = Number(weekdayRaw);
        recurringTimeUtc = eventSystem.parseTimeUtc(timeUtcRaw);
        if (!recurringTimeUtc) {
          await interaction.editReply({ content: 'time_utc must be in HH:mm format (UTC).' });
          return;
        }
        const next = eventSystem.computeNextWeeklyRunAt(recurringWeekday, recurringTimeUtc, new Date());
        if (!next) {
          await interaction.editReply({ content: 'Failed to compute next recurring run time.' });
          return;
        }
        nextRunAt = next.toISOString();
      } else {
        if (!startRaw) {
          await interaction.editReply({ content: 'One-off events require the start option.' });
          return;
        }
        const parsed = parseDateInput(startRaw);
        if (!parsed) {
          await interaction.editReply({ content: 'Invalid start time. Use <t:unix> or DD/MM/YYYY, HH:mm.' });
          return;
        }
        if (parsed.getTime() <= Date.now()) {
          await interaction.editReply({ content: 'Start time must be in the future.' });
          return;
        }
        startAt = parsed.toISOString();
        nextRunAt = parsed.toISOString();
      }

      const created = await eventStore.createEvent({
        guildId: interaction.guildId,
        title,
        description,
        hostsText: hosts,
        startAt,
        isRecurring: recurring,
        recurringWeekday,
        recurringTimeUtc,
        nextRunAt,
        pingRoleId: customPingRole ? customPingRole.id : null,
        createdBy: interaction.user.id,
        status: 'scheduled'
      });

      await eventSystem.refreshScheduleMessage(interaction.client, interaction.guildId);
      await eventScheduler.resyncAll();
      await interaction.editReply({ content: `Scheduled event created: ${created.id}` });
      return;
    }

    if (sub === 'edit') {
      const id = interaction.options.getString('id', true).trim();
      const event = await eventStore.getEventById(id);
      if (!event || event.guildId !== interaction.guildId || event.status !== 'scheduled') {
        await interaction.editReply({ content: 'Scheduled event not found.' });
        return;
      }

      const title = interaction.options.getString('title');
      const hosts = interaction.options.getString('hosts');
      const description = interaction.options.getString('description');
      const recurringOpt = interaction.options.getBoolean('recurring');
      const weekdayRaw = interaction.options.getString('weekday');
      const timeUtcRaw = interaction.options.getString('time_utc');
      const startRaw = interaction.options.getString('start');
      const customPingRole = interaction.options.getRole('custom_ping_role');

      const updates = {};
      if (title !== null) updates.title = title;
      if (hosts !== null) updates.hostsText = hosts;
      if (description !== null) updates.description = description;
      if (customPingRole) updates.pingRoleId = customPingRole.id;

      const willRecurring = recurringOpt === null ? event.isRecurring : recurringOpt;
      updates.isRecurring = willRecurring;

      if (willRecurring) {
        const weekday = weekdayRaw !== null ? Number(weekdayRaw) : event.recurringWeekday;
        const timeUtc = timeUtcRaw !== null ? eventSystem.parseTimeUtc(timeUtcRaw) : event.recurringTimeUtc;
        if (weekday === null || weekday === undefined || !timeUtc) {
          await interaction.editReply({ content: 'Recurring event requires weekday and time_utc (existing or new).' });
          return;
        }
        const next = eventSystem.computeNextWeeklyRunAt(weekday, timeUtc, new Date());
        if (!next) {
          await interaction.editReply({ content: 'Failed to compute next recurring run time.' });
          return;
        }
        updates.recurringWeekday = weekday;
        updates.recurringTimeUtc = timeUtc;
        updates.startAt = null;
        updates.nextRunAt = next.toISOString();
      } else {
        const startInput = startRaw || event.nextRunAt || event.startAt;
        const parsed = parseDateInput(startInput);
        if (!parsed) {
          await interaction.editReply({ content: 'A valid one-off start time is required. Use <t:unix> or DD/MM/YYYY, HH:mm.' });
          return;
        }
        if (parsed.getTime() <= Date.now()) {
          await interaction.editReply({ content: 'One-off start time must be in the future.' });
          return;
        }
        updates.recurringWeekday = null;
        updates.recurringTimeUtc = null;
        updates.startAt = parsed.toISOString();
        updates.nextRunAt = parsed.toISOString();
      }

      const updated = await eventStore.updateEvent(id, updates);
      if (!updated) {
        await interaction.editReply({ content: 'Failed to update event.' });
        return;
      }

      await eventSystem.refreshScheduleMessage(interaction.client, interaction.guildId);
      await eventScheduler.resyncAll();
      await interaction.editReply({ content: `Scheduled event updated: ${updated.id}` });
      return;
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('id', true).trim();
      const removed = await eventStore.removeEvent(id, interaction.guildId);
      if (!removed) {
        await interaction.editReply({ content: 'Scheduled event not found.' });
        return;
      }

      await eventSystem.refreshScheduleMessage(interaction.client, interaction.guildId);
      await eventScheduler.resyncAll();
      await interaction.editReply({ content: `Scheduled event removed: ${id}` });
      return;
    }

    await interaction.editReply({ content: 'Unknown subcommand.' });
  }
};
