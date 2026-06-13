const { Pool } = require('pg');
const config = require('../config');

const connectionString = process.env.DATABASE_URL || config.DATABASE_URL;
const pool = new Pool({ connectionString });

async function init() {
  // Create tables if they don't exist and ensure single-row seeds
  await pool.query(
    `CREATE TABLE IF NOT EXISTS bot_changelog (
      id INTEGER PRIMARY KEY,
      version TEXT,
      additions TEXT,
      notes TEXT,
      updated_at TIMESTAMPTZ
    )`
  );

  await pool.query(
    `INSERT INTO bot_changelog (id, version, additions, notes, updated_at)
     VALUES (1, '', '', '', NOW()) ON CONFLICT (id) DO NOTHING`);

  await pool.query(
    `CREATE TABLE IF NOT EXISTS bot_admin_state (
      id INTEGER PRIMARY KEY,
      paused_applications BOOLEAN DEFAULT false,
      debug_mode BOOLEAN DEFAULT false
    )`
  );

  await pool.query(
    `INSERT INTO bot_admin_state (id, paused_applications, debug_mode)
     VALUES (1, false, false) ON CONFLICT (id) DO NOTHING`);

  await pool.query(
    `CREATE TABLE IF NOT EXISTS bot_paused_commands (
      command_name TEXT PRIMARY KEY,
      paused BOOLEAN DEFAULT true,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  console.info('Ensured bot_paused_commands table exists');

  // Ensure exam session and review tables for exam workflow
  await pool.query(
    `CREATE TABLE IF NOT EXISTS exams_sessions (
      id UUID PRIMARY KEY,
      exam_id TEXT,
      user_id TEXT,
      status TEXT,
      payload JSONB,
      version INTEGER DEFAULT 1,
      dm_channel_id TEXT,
      dm_message_id TEXT,
      review_channel_id TEXT,
      review_message_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS exam_reviews (
      id UUID PRIMARY KEY,
      session_id UUID REFERENCES exams_sessions(id) ON DELETE CASCADE,
      reviewer_id TEXT,
      scores JSONB,
      feedback TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  console.info('Ensured exams_sessions and exam_reviews tables exist');
}

// Initialize at require-time only when an explicit DATABASE_URL is provided.
// This prevents deploy scripts (which load command modules) from attempting
// to connect to a database when none is configured locally.
if (process.env.DATABASE_URL) {
  init().catch(err => {
    console.error('Failed to initialize DB schema:', err);
  });
} else {
  console.info('DATABASE_URL not set — skipping DB schema initialization.');
}

module.exports = { pool };

/**
 * Listen for exam update notifications and optionally poll for unprocessed graded sessions.
 * handler(payload, source) will be invoked with payload string and source ('notification'|'poll').
 */
async function listenForExamUpdates(handler, opts = {}) {
  if (!process.env.DATABASE_URL) {
    console.info('DATABASE_URL not set — skipping listenForExamUpdates');
    return () => {};
  }
  const client = await pool.connect();
  client.on('error', (err) => console.error('Postgres listener client error:', err));
  client.on('notification', async (msg) => {
    try {
      await handler(msg.payload, 'notification');
    } catch (e) {
      console.error('Error handling notification payload:', e);
    }
  });
  await client.query('LISTEN exam_updates');
  console.info('Listening for Postgres NOTIFY on channel: exam_updates');

  // Poll fallback: periodically query for graded sessions that are not marked processed
  const pollMs = opts.pollMs || 30000;
  const poller = setInterval(async () => {
    try {
      const q = await pool.query("SELECT payload FROM exams_sessions WHERE status='graded'");
      for (const row of q.rows) {
        try {
          const payload = JSON.stringify({ sessionId: row.payload && row.payload.id ? row.payload.id : null });
          await handler(payload, 'poll');
        } catch (e) {
          console.error('Error handling polled graded session:', e);
        }
      }
    } catch (e) {
      console.error('Error polling for graded sessions:', e.message || e);
    }
  }, pollMs);

  return () => {
    clearInterval(poller);
    client.query('UNLISTEN exam_updates').catch(() => null);
    client.release();
  };
}

module.exports.listenForExamUpdates = listenForExamUpdates;
