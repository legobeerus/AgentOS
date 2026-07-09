const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const examStore = require('./examStore');
const config = require('../config');

async function handleGradeButton(interaction) {
  // customId: exam_grade:<sessionId>
  try {
    await interaction.deferReply({ ephemeral: true });
    const parts = String(interaction.customId).split(':');
    const sessionId = parts[1];
    const sess = await examStore.getSessionById(sessionId);
    if (!sess) return interaction.editReply({ content: 'Session not found.' });

    // Show modal to collect comma-separated scores and feedback
    const modal = new ModalBuilder().setCustomId(`exam_grade_modal:${sessionId}`).setTitle('Grade Exam — Enter scores');
    const scoresInput = new TextInputBuilder().setCustomId('scores').setLabel('Scores (comma-separated)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 1,0,1,1');
    const feedbackInput = new TextInputBuilder().setCustomId('feedback').setLabel('Feedback for candidate').setStyle(TextInputStyle.Paragraph).setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(scoresInput), new ActionRowBuilder().addComponents(feedbackInput));
    await interaction.showModal(modal);
  } catch (e) {
    console.error('handleGradeButton error:', e);
    try { await interaction.followUp({ content: 'Failed to open grading modal.', ephemeral: true }); } catch (_) {}
  }
}

async function handleGradeModalSubmit(interaction) {
  // customId: exam_grade_modal:<sessionId>
  try {
    const parts = String(interaction.customId).split(':');
    const sessionId = parts[1];
    const scoresRaw = interaction.fields.getTextInputValue('scores') || '';
    const feedback = interaction.fields.getTextInputValue('feedback') || '';
    const scoreParts = scoresRaw.split(',').map(s => parseFloat(s.trim())).filter(s => !Number.isNaN(s));
    await processGrade({ sessionId, scores: scoreParts, feedback, reviewerTag: interaction.user.tag, client: interaction.client });
    await interaction.reply({ content: 'Saved scores. Candidate notified.', ephemeral: true });
  } catch (e) {
    console.error('handleGradeModalSubmit error:', e);
    try { await interaction.reply({ content: 'Failed to record scores.', ephemeral: true }); } catch (_) {}
  }
}

async function processGrade({ sessionId, scores = [], feedback = '', reviewerTag = 'web', client }) {
  const sess = await examStore.getSessionById(sessionId);
  if (!sess) throw new Error('Session not found');

  // Calculate total possible based on question maxScore fields (default to 1)
  const qs = sess.questions || [];
  const totalPossible = qs.reduce((sum, q) => sum + ((typeof q === 'object' && q.maxScore) ? q.maxScore : 1), 0);
  
  // Auto-grade MC questions and merge with manual scores
  const finalScores = [];
  const as = sess.answers || [];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const maxScore = (typeof q === 'object' && q.maxScore) ? q.maxScore : 1;
    // If MC question, auto-grade it
    if (typeof q === 'object' && q.type === 'multiplechoice' && q.correctAnswer) {
      const userAnswer = as[i] ? String(as[i].answer).toUpperCase() : '';
      const correctAnswer = String(q.correctAnswer).toUpperCase();
      finalScores[i] = userAnswer === correctAnswer ? maxScore : 0;
    } else {
      // Use manual score if provided, else 0
      finalScores[i] = scores && scores[i] !== undefined ? Number(scores[i]) || 0 : 0;
    }
  }
  
  const totalScored = finalScores.reduce((a,b)=>a+(Number(b)||0),0);
  const percent = totalPossible ? Math.round((totalScored/totalPossible)*100) : 0;
  const passed = percent >= (sess.passThreshold || config.EXAM_PASS_THRESHOLD || 70);
  const review = { scoredAt: Date.now(), scores: finalScores, totalScored, percent, passed, feedback, reviewer: reviewerTag };
  await examStore.setReview(sessionId, review);

  // Fetch updated session and call finalizeReview to edit message and send DM
  const updatedSess = await examStore.getSessionById(sessionId);
  await finalizeReview({ session: updatedSess, client });
}

module.exports = { handleGradeButton, handleGradeModalSubmit, processGrade };

async function finalizeReview({ session, client }) {
  if (!session || !session.review) throw new Error('No review to finalize');
  const review = session.review;
  
  // Calculate total possible based on question maxScore fields (default to 1)
  const qs = session.questions || [];
  const totalPossible = qs.reduce((sum, q) => sum + ((typeof q === 'object' && q.maxScore) ? q.maxScore : 1), 0);
  
  const totalScored = (review.totalScored !== undefined) ? review.totalScored : (Array.isArray(review.scores) ? review.scores.slice(0, session.questions.length).reduce((a,b)=>a+(Number(b)||0),0) : 0);
  const percent = review.percent !== undefined ? review.percent : (totalPossible ? Math.round((totalScored/totalPossible)*100) : 0);
  const passed = percent >= (session.passThreshold || config.EXAM_PASS_THRESHOLD || 70);

  // Edit the review message if present
  try {
    const channel = session.reviewChannelId ? await client.channels.fetch(session.reviewChannelId).catch(()=>null) : null;
    if (channel && session.reviewMessageId) {
      const embed = new EmbedBuilder()
        .setTitle(`Graded — ${session.examId}`)
        .setColor(passed ? 0x57F287 : 0xED4245)
        .addFields(
          { name: 'Candidate', value: `<@${session.userId}>`, inline: true },
          { name: 'Score', value: `${totalScored}/${totalPossible} (${percent}%)`, inline: true },
          { name: 'Result', value: passed ? '✅ Passed' : '❌ Failed', inline: true }
        )
        .setFooter({ text: `Graded by ${review.reviewer || 'web'}` })
        .setTimestamp(new Date());
      await channel.messages.fetch(session.reviewMessageId).then(m => m.edit({ embeds: [embed], components: [] })).catch(()=>null);
    }
  } catch (e) { console.error('Failed to edit review message (finalize):', e); }

  // DM candidate with detailed feedback
  try {
    const user = await client.users.fetch(session.userId).catch(()=>null);
    if (user) {
      const fbEmbed = new EmbedBuilder()
        .setTitle(`Exam Results — ${session.examId}`)
        .setColor(passed ? 0x57F287 : 0xED4245)
        .addFields({ name: 'Score', value: `${totalScored}/${totalPossible} (${percent}%)`, inline: true }, { name: 'Passed', value: passed ? 'Yes' : 'No', inline: true }, { name: 'Feedback', value: review.feedback || '(none)', inline: false })
        .setTimestamp(new Date());
      const qs = session.questions || [];
      const sc = review.scores || [];
      for (let i=0;i<qs.length;i++) {
        const q = qs[i];
        const s = sc[i] !== undefined ? sc[i] : '(unscored)';
        fbEmbed.addFields({ name: `Q${i+1}`, value: `Score: ${s}\n${q.slice(0,800)}`, inline: false });
      }
      await user.send({ embeds: [fbEmbed] }).catch(()=>null);
    }
  } catch (e) { console.error('Failed to DM candidate results (finalize):', e); }

  // Mark review as processed so we don't handle it again
  try {
    review.processed = true;
    await require('./examStore').setReview(session.id, review);
  } catch (e) { console.error('Failed to mark review processed:', e); }
}

module.exports.finalizeReview = finalizeReview;
