const config = require('../config');
const examStore = require('./examStore');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleExamDM(message, client) {
  // Only handle DMs
  if (message.author.bot) return;
  if (message.guild) return; // skip guild messages

  const sess = examStore.getSessionByUser(message.author.id);
  if (!sess) return; // not in an active session
  if (sess.status !== 'active') return;

  // record answer and send next question or finalize
  examStore.recordAnswer(sess.id, message.content || '');
  const updated = examStore.getSessionById(sess.id);
  const nextIndex = updated.currentIndex;

  if (nextIndex < (updated.questions || []).length) {
    const q = updated.questions[nextIndex];
    try {
      await message.channel.send({ content: `Question ${nextIndex + 1}:
${q}` });
    } catch (e) {
      console.error('Failed to send next question DM:', e);
    }
    return;
  }

  // finished: compile embed and post to review channel
  const fields = [];
  const qs = updated.questions || [];
  const as = updated.answers || [];
  for (let i = 0; i < qs.length; i++) {
    fields.push({ name: `Q${i + 1}`, value: qs[i].slice(0, 1000) || '(empty)', inline: false });
    const a = as[i] ? as[i].answer : '(no answer)';
    fields.push({ name: `A${i + 1}`, value: (a && String(a).slice(0, 1000)) || '(no answer)', inline: false });
  }

  const reviewEmbed = new EmbedBuilder()
    .setTitle(`Exam Submission — ${updated.examId}`)
    .setColor(config.EMBED_COLOR)
    .addFields(...fields)
    .addFields({ name: 'Candidate', value: `<@${message.author.id}>`, inline: true }, { name: 'Session', value: updated.id, inline: true })
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
    examStore.setReviewMessage(updated.id, reviewChan.id, sent.id);
    try { await message.channel.send({ content: '✅ Your exam has been submitted for review. You will receive feedback when grading completes.' }); } catch (e) {}
    try { console.info && console.info(`Exam posted for review: session=${updated.id} channel=${reviewChan.id} message=${sent.id}`); } catch (e) {}
  } else {
    try { await message.channel.send({ content: '⚠️ Failed to submit exam for review. Please contact staff.' }); } catch (e) {}
  }
}

module.exports = { handleExamDM };
