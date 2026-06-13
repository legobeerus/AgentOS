const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const examStore = require('./examStore');

async function handleExamAuthorize(interaction) {
  // customId format: exam_authorize:<userId>:<examId>
  try {
    await interaction.deferUpdate();
    const parts = String(interaction.customId).split(':');
    const userId = parts[1];
    const examId = parts[2];

    if (!interaction.member.roles.cache.has(config.EXAM_AUTH_ROLE_ID)) {
      return interaction.followUp({ content: '❌ You are not authorized to approve exams.', ephemeral: true });
    }

    const examDef = examStore.getExamDefinition(examId);
    if (!examDef) {
      return interaction.followUp({ content: `⚠️ Could not find exam definition ${examId}.`, ephemeral: true });
    }

    // create session
    const timeLimit = examDef.timeLimitSeconds || config.EXAM_TIME_LIMIT_SECONDS || 0;
    const sess = await examStore.createSession({ userId, examId, questions: examDef.questions || [], timeLimitSeconds: timeLimit });

    // DM the user with initial question
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) {
      return interaction.followUp({ content: `❌ Could not resolve user <@${userId}>.`, ephemeral: true });
    }

    const firstQ = (sess.questions && sess.questions[0]) ? sess.questions[0] : null;
    const embed = new EmbedBuilder()
      .setTitle(`${examDef.title || examId} — Exam Started`)
      .setColor(config.EMBED_COLOR)
      .addFields(
        { name: 'Time Limit', value: `${timeLimit} seconds`, inline: true },
        { name: 'Instructions', value: examDef.instructions || 'Answer each question in this DM. Your next question will be posted after each answer.', inline: false }
      )
      .setTimestamp(new Date());

    if (firstQ) embed.addFields({ name: `Question 1`, value: firstQ, inline: false });

    const dm = await user.send({ embeds: [embed] }).catch(() => null);
    if (!dm) {
      return interaction.followUp({ content: `⚠️ Could not DM the candidate. They may have DMs disabled.`, ephemeral: true });
    }

    // store dm message reference for potential countdown updates
    await examStore.setDMMessage(sess.id, dm);

    // Acknowledge to authorizer
    await interaction.followUp({ content: `✅ Authorized and started exam for <@${userId}> (session ${sess.id}).`, ephemeral: true });
  } catch (e) {
    console.error('handleExamAuthorize error:', e);
    try { await interaction.followUp({ content: '⚠️ Failed to authorize exam.', ephemeral: true }); } catch (_) {}
  }
}

module.exports = { handleExamAuthorize };
