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

    // Check if user already has an active session for this exam
    const existingSession = await examStore.getSessionByUser(userId);
    if (existingSession && existingSession.examId === examId && (existingSession.status === 'active' || existingSession.status === 'awaiting_review')) {
      return interaction.followUp({ content: '⚠️ This candidate already has an active exam session.', ephemeral: true });
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
    
    // Intro embed
    const introEmbed = new EmbedBuilder()
      .setTitle(`${examDef.title || examId} — Exam Started`)
      .setColor(config.EMBED_COLOR)
      .addFields(
        { name: 'Time Limit', value: `${timeLimit} seconds`, inline: true },
        { name: 'Instructions', value: examDef.instructions || 'Answer each question in this DM. Your next question will be posted after each answer.', inline: false }
      )
      .setTimestamp(new Date());

    const embeds = [introEmbed];

    // First question embed
    if (firstQ) {
      const qText = typeof firstQ === 'string' ? firstQ : (firstQ && firstQ.text ? firstQ.text : String(firstQ));
      const qEmbed = new EmbedBuilder()
        .setTitle('Question 1')
        .setDescription(qText)
        .setColor(config.EMBED_COLOR);
      
      // If MC, add choices field
      if (typeof firstQ === 'object' && firstQ.type === 'multiplechoice' && Array.isArray(firstQ.choices)) {
        qEmbed.addFields({ name: 'Options', value: firstQ.choices.join('\n'), inline: false });
        qEmbed.addFields({ name: 'Answer', value: 'Reply with just the letter: A, B, C, or D', inline: false });
      }
      
      embeds.push(qEmbed);
    }

    const dm = await user.send({ embeds }).catch(() => null);
    if (!dm) {
      return interaction.followUp({ content: `⚠️ Could not DM the candidate. They may have DMs disabled.`, ephemeral: true });
    }

    // store dm message reference for potential countdown updates
    await examStore.setDMMessage(sess.id, dm);

    // Disable all buttons on the original message
    try {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`exam_authorize:${userId}:${examId}`)
          .setLabel('Authorize & Start')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );
      await interaction.message.edit({ components: [row] });
    } catch (e) { console.error('Failed to disable authorize button:', e); }

    // Acknowledge to authorizer
    await interaction.followUp({ content: `✅ Authorized and started exam for <@${userId}> (session ${sess.id}).`, ephemeral: true });
  } catch (e) {
    console.error('handleExamAuthorize error:', e);
    try { await interaction.followUp({ content: '⚠️ Failed to authorize exam.', ephemeral: true }); } catch (_) {}
  }
}

module.exports = { handleExamAuthorize };
