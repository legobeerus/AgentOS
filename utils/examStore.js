const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SESSIONS_PATH = path.join(__dirname, '..', 'data', 'exam_sessions.json');
const EXAMS_DIR = path.join(__dirname, '..', 'data', 'exams');

let _sessions = {};

function load() {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return;
    const raw = fs.readFileSync(SESSIONS_PATH, 'utf8');
    _sessions = JSON.parse(raw || '{}') || {};
  } catch (e) {
    console.error('Failed to load exam sessions:', e);
    _sessions = {};
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(SESSIONS_PATH), { recursive: true });
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(_sessions, null, 2));
  } catch (e) {
    console.error('Failed to save exam sessions:', e);
  }
}

function getSessionByUser(userId) {
  return Object.values(_sessions).find(s => s.userId === userId && (s.status === 'active' || s.status === 'awaiting_review')) || null;
}

function getSessionById(id) {
  return _sessions[id] || null;
}

function createSession({ userId, examId, questions, timeLimitSeconds }) {
  const id = uuidv4();
  const now = Date.now();
  const sess = {
    id,
    userId,
    examId,
    questions: questions || [],
    answers: [],
    currentIndex: 0,
    createdAt: now,
    expiresAt: now + (timeLimitSeconds || 0) * 1000,
    timeLimitSeconds: timeLimitSeconds || 0,
    status: 'active',
    review: null,
    dmMessage: null,
    reviewMessageId: null,
    reviewChannelId: null
  };
  _sessions[id] = sess;
  save();
  return sess;
}

function recordAnswer(sessionId, text) {
  const s = _sessions[sessionId];
  if (!s) return null;
  s.answers.push({ index: s.currentIndex, answer: String(text || ''), ts: Date.now() });
  s.currentIndex += 1;
  // If finished
  if (s.currentIndex >= (s.questions || []).length) {
    s.status = 'awaiting_review';
  }
  save();
  return s;
}

function finishSession(sessionId) {
  const s = _sessions[sessionId];
  if (!s) return null;
  s.status = 'awaiting_review';
  save();
  return s;
}

function setDMMessage(sessionId, dmMessage) {
  const s = _sessions[sessionId];
  if (!s) return;
  s.dmMessage = { channelId: dmMessage.channel.id, messageId: dmMessage.id };
  save();
}

function setReviewMessage(sessionId, channelId, messageId) {
  const s = _sessions[sessionId];
  if (!s) return;
  s.reviewMessageId = messageId;
  s.reviewChannelId = channelId;
  save();
}

function setReview(sessionId, review) {
  const s = _sessions[sessionId];
  if (!s) return;
  s.review = review;
  s.status = 'graded';
  save();
}

function listActiveSessions() {
  return Object.values(_sessions).filter(s => s.status === 'active' || s.status === 'awaiting_review');
}

function getExamDefinition(examId) {
  try {
    const p = path.join(EXAMS_DIR, `${examId}.json`);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw || 'null');
  } catch (e) {
    console.error('Failed to load exam definition', examId, e);
    return null;
  }
}

load();

module.exports = {
  getSessionByUser,
  getSessionById,
  createSession,
  recordAnswer,
  finishSession,
  setDMMessage,
  setReviewMessage,
  setReview,
  listActiveSessions,
  getExamDefinition
};
