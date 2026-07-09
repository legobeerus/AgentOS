const config = require('../config');
const examStore = require('./examStore');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleExamDM(message, client) {
  // Only handle DMs
  if (message.author.bot) return;
  if (message.guild) return; // skip guild messages

  const sess = await examStore.getSessionByUser(message.author.id);
  if (!sess) return; // not in an active session
  if (sess.status !== 'active') return;

  // Get current question to validate answer format (esp. for MC)
  const currentQ = sess.questions && sess.questions[sess.currentIndex] ? sess.questions[sess.currentIndex] : null;
  const userAnswer = (message.content || '').trim();
  
  // Validate MC answer: must be exactly A/B/C/D and present
  if (currentQ && typeof currentQ === 'object' && currentQ.type === 'multiplechoice') {
    const answerUpper = userAnswer.toUpperCase();
    const validChoices = (currentQ.choices || []).map(c => c.charAt(0).toUpperCase());
    if (!validChoices.includes(answerUpper)) {
      try {
        await message.channel.send({ content: `❌ Invalid answer. Please respond with one of: ${validChoices.join(', ')}` });
      } catch (e) {}
      return; // don't record yet
    }
  }

  // record answer and send next question or finalize
  await examStore.recordAnswer(sess.id, userAnswer);
  const updated = await examStore.getSessionById(sess.id);
  const nextIndex = updated.currentIndex;

  if (nextIndex < (updated.questions || []).length) {
    const q = updated.questions[nextIndex];
    const qText = typeof q === 'string' ? q : (q && q.text ? q.text : String(q));
    
    const qEmbed = new EmbedBuilder()
      .setTitle(`Question ${nextIndex + 1}`)
      .setDescription(qText)
      .setColor(config.EMBED_COLOR);
    
    // If MC question, add choices field
    if (typeof q === 'object' && q.type === 'multiplechoice' && Array.isArray(q.choices)) {
      qEmbed.addFields({ name: 'Options', value: q.choices.join('\n'), inline: false });
      qEmbed.addFields({ name: 'Answer', value: 'Reply with just the letter: A, B, C, or D', inline: false });
    }
    
    try {
      await message.channel.send({ embeds: [qEmbed] });
    } catch (e) {
      console.error('Failed to send next question DM:', e);
    }
    return;
  }

  // finished: post to review channel with link to grade in browser
  const reviewEmbed = new EmbedBuilder()
    .setTitle(`Exam Submission — ${updated.examId}`)
    .setColor(config.EMBED_COLOR)
    .setDescription('New submission received. Open in browser below to view and grade responses.')
    .addFields(
      { name: 'Candidate', value: `<@${message.author.id}>`, inline: true },
      { name: 'Session', value: updated.id, inline: true },
      { name: 'Questions', value: `${(updated.questions || []).length}`, inline: true }
    )
    .setTimestamp(new Date());

  const rows = [];
  // If a web grading UI is configured, expose a single Link button to open it.
  if (config.EXAM_WEB_BASE_URL) {
    const base = String(config.EXAM_WEB_BASE_URL).replace(/\/$/, '');
    // Use grade.html path to match the web UI expected URL
    const url = `${base}/grade.html?session=${encodeURIComponent(updated.id)}`;
    const linkBtn = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Exam (Web)')
      .setURL(url);
    rows.push(new ActionRowBuilder().addComponents(linkBtn));
  } else {
    // Fallback: provide the in-Discord Grade button
    const gradeBtn = new ButtonBuilder().setCustomId(`exam_grade:${updated.id}`).setLabel('Grade').setStyle(ButtonStyle.Primary);
    rows.push(new ActionRowBuilder().addComponents(gradeBtn));
  }

  const reviewChan = await client.channels.fetch(config.EXAM_REVIEW_CHANNEL_ID).catch(() => null);
  if (!reviewChan) {
    try { await message.channel.send({ content: '⚠️ Could not submit exam for review (review channel not found).' }); } catch (_) {}
    return;
  }

  const sent = await reviewChan.send({ embeds: [reviewEmbed], components: rows }).catch(err => null);
  if (sent) {
    await examStore.setReviewMessage(updated.id, reviewChan.id, sent.id);
    try { await message.channel.send({ content: '✅ Your exam has been submitted for review. You will receive feedback when grading completes.' }); } catch (e) {}
    try { console.info && console.info(`Exam posted for review: session=${updated.id} channel=${reviewChan.id} message=${sent.id}`); } catch (e) {}
  } else {
    try { await message.channel.send({ content: '⚠️ Failed to submit exam for review. Please contact staff.' }); } catch (e) {}
  }
}

module.exports = { handleExamDM };
