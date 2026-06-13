const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const SESSIONS_PATH = path.join(__dirname, '..', 'data', 'exam_sessions.json');
const EXAMS_DIR = path.join(__dirname, '..', 'data', 'exams');

let useDb = false;
let db = null;
if (process.env.DATABASE_URL || config.DATABASE_URL) {
  try {
    db = require('./db');
    useDb = true;
  } catch (e) {
    console.warn('Database config present but failed to load DB module, falling back to file storage', e.message || e);
    useDb = false;
  }
}

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

async function getSessionByUser(userId) {
  if (useDb) {
    try {
      const q = await db.pool.query(
        `SELECT payload FROM exams_sessions WHERE user_id=$1 AND status IN ('active','awaiting_review') ORDER BY created_at DESC LIMIT 1`,
        [String(userId)]
      );
      const row = q.rows[0];
      const s = row ? row.payload : null;
      console.debug && console.debug(`examStore.getSessionByUser(DB): lookup userId=${userId} -> ${s ? s.id : 'not found'}`);
      return s;
    } catch (e) {
      console.error('DB getSessionByUser failed:', e);
      return null;
    }
  }
  const s = Object.values(_sessions).find(s => s.userId === userId && (s.status === 'active' || s.status === 'awaiting_review')) || null;
  try { console.debug && console.debug(`examStore.getSessionByUser(file): lookup userId=${userId} -> ${s ? s.id : 'not found'}`); } catch (e) {}
  return s;
}

async function getSessionById(id) {
  if (useDb) {
    try {
      const q = await db.pool.query('SELECT payload FROM exams_sessions WHERE id=$1', [String(id)]);
      const row = q.rows[0];
      const s = row ? row.payload : null;
      console.debug && console.debug(`examStore.getSessionById(DB): lookup id=${id} -> ${s ? 'found' : 'not found'}`);
      return s;
    } catch (e) {
      console.error('DB getSessionById failed:', e);
      return null;
    }
  }
  const s = _sessions[id] || null;
  try { console.debug && console.debug(`examStore.getSessionById(file): lookup id=${id} -> ${s ? 'found' : 'not found'}`); } catch (e) {}
  return s;
}

async function createSession({ userId, examId, questions, timeLimitSeconds }) {
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
  if (useDb) {
    try {
      await db.pool.query(
        `INSERT INTO exams_sessions(id, exam_id, user_id, status, payload, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,NOW(),NOW())`,
        [id, examId, String(userId), sess.status, sess]
      );
      return sess;
    } catch (e) {
      console.error('DB createSession failed:', e);
      // fallback to file
    }
  }
  _sessions[id] = sess;
  save();
  return sess;
}

async function recordAnswer(sessionId, text) {
  if (useDb) {
    try {
      const cur = await getSessionById(sessionId);
      if (!cur) return null;
      cur.answers = cur.answers || [];
      cur.answers.push({ index: cur.currentIndex, answer: String(text || ''), ts: Date.now() });
      cur.currentIndex = (cur.currentIndex || 0) + 1;
      if (cur.currentIndex >= (cur.questions || []).length) cur.status = 'awaiting_review';
      const q = await db.pool.query(
        `UPDATE exams_sessions SET payload=$1, updated_at=NOW(), version=version+1 WHERE id=$2 RETURNING payload`,
        [cur, sessionId]
      );
      return q.rows[0] ? q.rows[0].payload : null;
    } catch (e) {
      console.error('DB recordAnswer failed:', e);
      return null;
    }
  }
  const s = _sessions[sessionId];
  if (!s) return null;
  s.answers.push({ index: s.currentIndex, answer: String(text || ''), ts: Date.now() });
  s.currentIndex += 1;
  if (s.currentIndex >= (s.questions || []).length) {
    s.status = 'awaiting_review';
  }
  save();
  return s;
}

async function finishSession(sessionId) {
  if (useDb) {
    try {
      const cur = await getSessionById(sessionId);
      if (!cur) return null;
      cur.status = 'awaiting_review';
      const q = await db.pool.query(`UPDATE exams_sessions SET payload=$1, updated_at=NOW(), version=version+1 WHERE id=$2 RETURNING payload`, [cur, sessionId]);
      return q.rows[0] ? q.rows[0].payload : null;
    } catch (e) {
      console.error('DB finishSession failed:', e);
      return null;
    }
  }
  const s = _sessions[sessionId];
  if (!s) return null;
  s.status = 'awaiting_review';
  save();
  return s;
}

async function setDMMessage(sessionId, dmMessage) {
  if (useDb) {
    try {
      const cur = await getSessionById(sessionId);
      if (!cur) return;
      cur.dmMessage = { channelId: dmMessage.channel.id, messageId: dmMessage.id };
      const q = await db.pool.query(`UPDATE exams_sessions SET payload=$1, dm_channel_id=$2, dm_message_id=$3, updated_at=NOW(), version=version+1 WHERE id=$4 RETURNING payload`, [cur, dmMessage.channel.id, dmMessage.id, sessionId]);
      return q.rows[0] ? q.rows[0].payload : null;
    } catch (e) {
      console.error('DB setDMMessage failed:', e);
      return;
    }
  }
  const s = _sessions[sessionId];
  if (!s) return;
  s.dmMessage = { channelId: dmMessage.channel.id, messageId: dmMessage.id };
  save();
}

async function setReviewMessage(sessionId, channelId, messageId) {
  if (useDb) {
    try {
      const cur = await getSessionById(sessionId);
      if (!cur) return;
      cur.reviewMessageId = messageId;
      cur.reviewChannelId = channelId;
      const q = await db.pool.query(`UPDATE exams_sessions SET payload=$1, review_channel_id=$2, review_message_id=$3, updated_at=NOW(), version=version+1 WHERE id=$4 RETURNING payload`, [cur, channelId, messageId, sessionId]);
      return q.rows[0] ? q.rows[0].payload : null;
    } catch (e) {
      console.error('DB setReviewMessage failed:', e);
      return;
    }
  }
  const s = _sessions[sessionId];
  if (!s) return;
  s.reviewMessageId = messageId;
  s.reviewChannelId = channelId;
  save();
}

async function setReview(sessionId, review) {
  if (useDb) {
    try {
      const cur = await getSessionById(sessionId);
      if (!cur) return;
      cur.review = review;
      cur.status = 'graded';
      const q = await db.pool.query(`UPDATE exams_sessions SET payload=$1, status='graded', updated_at=NOW(), version=version+1 WHERE id=$2 RETURNING payload`, [cur, sessionId]);
      return q.rows[0] ? q.rows[0].payload : null;
    } catch (e) {
      console.error('DB setReview failed:', e);
      return;
    }
  }
  const s = _sessions[sessionId];
  if (!s) return;
  s.review = review;
  s.status = 'graded';
  save();
}

async function listActiveSessions() {
  if (useDb) {
    try {
      const q = await db.pool.query("SELECT payload FROM exams_sessions WHERE status IN ('active','awaiting_review') ORDER BY created_at DESC");
      return q.rows.map(r => r.payload || null).filter(Boolean);
    } catch (e) {
      console.error('DB listActiveSessions failed:', e);
      return [];
    }
  }
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

// load file fallback store
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
