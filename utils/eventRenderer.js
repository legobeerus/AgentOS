const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

const PRESET_TYPES = [
  { key: 'deployments', label: 'Deployment', defaultDescription: 'Deployment operation is now active. Review objectives and begin mission execution.' },
  { key: 'combat_trainings', label: 'Combat Training', defaultDescription: 'Combat training is now active. Report in and prepare for instruction.' },
  { key: 'mock_investigations', label: 'Mock Investigation', defaultDescription: 'Mock investigation is now active. Follow the case brief and assigned tasks.' },
  { key: 'court_martials', label: 'Court Martial', defaultDescription: 'Court martial is now active. Maintain courtroom protocol and attendance.' },
  { key: 'sting_operations', label: 'Sting Operation', defaultDescription: 'Sting operation is now active. Follow opsec and chain-of-command direction.' }
];

function toUnix(input) {
  const ms = new Date(input).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function safe(value, fallback) {
  const v = String(value || '').trim();
  return v || fallback;
}

function eventLine(event) {
  const ts = toUnix(event.nextRunAt || event.startAt);
  const when = ts ? `<t:${ts}:F> (<t:${ts}:R>)` : 'Unknown time';
  const recurrence = event.isRecurring ? ` | weekly ${String(event.recurringTimeUtc || '??:??')} UTC` : '';
  return [
    `- ${safe(event.title, 'Untitled Event')}`,
    `  Time: ${when}${recurrence}`,
    `  Host(s): ${safe(event.hostsText, 'Not provided')}`,
    `  Description: ${safe(event.description, 'No description provided')}`
  ].join('\n');
}

function buildScheduleEmbed(events) {
  const body = events.length
    ? events.map(eventLine).join('\n\n')
    : 'No scheduled events right now.';

  return new EmbedBuilder()
    .setTitle('Event Schedule')
    .setColor(config.EMBED_COLOR || 0x00aff1)
    .setDescription(body.slice(0, 4096))
    .setFooter({ text: `Capacity ${events.length}/${Number(config.EVENT_SCHEDULE_MAX_ENTRIES || 20)}` })
    .setTimestamp(new Date());
}

function buildScheduleComponents() {
  const url = String(config.EVENT_PANEL_URL || '').trim();
  if (!url) return [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Events Panel').setURL(url)
  );
  return [row];
}

function buildOperationsPanelEmbed(weeklyCount, weeklyByType) {
  const intro = [
    'This channel is intended to announce operations events.',
    'Authorized hosts may start preset operations below.',
    'End events when complete so weekly tracking stays accurate.'
  ].join('\n');

  const counts = weeklyByType && typeof weeklyByType === 'object' ? weeklyByType : {};
  const lines = PRESET_TYPES.map((preset) => {
    return `${preset.label}: ${Number(counts[preset.key] || 0)}`;
  }).join('\n');

  return new EmbedBuilder()
    .setTitle('Welcome to Operations')
    .setColor(config.EMBED_COLOR || 0x00aff1)
    .setDescription(`\`\`\`text\n${intro}\n\`\`\``)
    .addFields(
      { name: 'Weekly Events Completed', value: String(Number(weeklyCount || 0)), inline: true },
      { name: 'By Event Type', value: lines || 'No completed events yet.', inline: false }
    )
    .setFooter({ text: 'Counter resets Monday 00:00 UTC' })
    .setTimestamp(new Date());
}

function buildOperationsPanelComponents() {
  const row = new ActionRowBuilder();
  for (const preset of PRESET_TYPES) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`event_preset:${preset.key}`)
        .setLabel(preset.label)
        .setStyle(ButtonStyle.Primary)
    );
  }
  return [row];
}

function buildLiveEventEmbed(payload) {
  const embed = new EmbedBuilder()
    .setTitle(safe(payload.eventTitle, 'Operations Event'))
    .setColor(config.EMBED_COLOR || 0x00aff1)
    .addFields(
      { name: 'Host', value: safe(payload.hostsText, payload.hostUserId ? `<@${payload.hostUserId}>` : 'Not provided'), inline: false },
      { name: 'Description', value: safe(payload.description, 'No description provided'), inline: false },
      { name: 'Game Link', value: safe(payload.gameLink, 'Not provided'), inline: false },
      { name: 'Voice Channel Link', value: safe(payload.vcLink, 'Not provided'), inline: false }
    )
    .setTimestamp(new Date());

  if (payload.scheduledFor) {
    const ts = toUnix(payload.scheduledFor);
    if (ts) {
      embed.addFields({ name: 'Scheduled For', value: `<t:${ts}:F> (<t:${ts}:R>)`, inline: false });
    }
  }

  return embed;
}

function buildLiveEventComponents(liveEventId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`event_live_end:${liveEventId}`).setLabel('End Event').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`event_live_edit:${liveEventId}`).setLabel('Edit Info').setStyle(ButtonStyle.Secondary)
  );
  return [row];
}

function getPresetByKey(key) {
  return PRESET_TYPES.find((x) => x.key === key) || null;
}

module.exports = {
  PRESET_TYPES,
  getPresetByKey,
  buildScheduleEmbed,
  buildScheduleComponents,
  buildOperationsPanelEmbed,
  buildOperationsPanelComponents,
  buildLiveEventEmbed,
  buildLiveEventComponents
};
