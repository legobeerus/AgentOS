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
      debug_mode BOOLEAN DEFAULT false,
      pause_time_logging BOOLEAN DEFAULT false
    )`
  );

  // Backward-compatible migration for existing databases
  await pool.query(
    `ALTER TABLE bot_admin_state
     ADD COLUMN IF NOT EXISTS pause_time_logging BOOLEAN DEFAULT false`
  );

  await pool.query(
    `INSERT INTO bot_admin_state (id, paused_applications, debug_mode, pause_time_logging)
     VALUES (1, false, false, false) ON CONFLICT (id) DO NOTHING`);

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

  // Poll fallback: periodically query only unprocessed graded sessions.
  // Default is intentionally conservative to reduce DB load when NOTIFY is healthy.
  const pollEnabled = opts.pollEnabled !== undefined
    ? !!opts.pollEnabled
    : (config.EXAM_DB_POLL_ENABLED !== undefined ? !!config.EXAM_DB_POLL_ENABLED : true);
  const pollMs = Number.isFinite(Number(opts.pollMs)) && Number(opts.pollMs) > 0
    ? Number(opts.pollMs)
    : (Number.isFinite(Number(config.EXAM_DB_POLL_MS)) && Number(config.EXAM_DB_POLL_MS) > 0 ? Number(config.EXAM_DB_POLL_MS) : 120000);
  const pollBatchSize = Number.isFinite(Number(opts.pollBatchSize)) && Number(opts.pollBatchSize) > 0
    ? Number(opts.pollBatchSize)
    : 25;

  let poller = null;
  let pollInFlight = false;
  if (pollEnabled) {
    poller = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const q = await pool.query(
          "SELECT id::text AS session_id FROM exams_sessions WHERE status='graded' AND (payload->'review'->>'processed') IS DISTINCT FROM 'true' ORDER BY updated_at ASC LIMIT $1",
          [pollBatchSize]
        );
        for (const row of q.rows) {
          try {
            const payload = JSON.stringify({ sessionId: row.session_id });
            await handler(payload, 'poll');
          } catch (e) {
            console.error('Error handling polled graded session:', e);
          }
        }
      } catch (e) {
        console.error('Error polling for graded sessions:', e.message || e);
      } finally {
        pollInFlight = false;
      }
    }, pollMs);
    console.info(`Exam poll fallback enabled: interval=${pollMs}ms batch=${pollBatchSize}`);
  } else {
    console.info('Exam poll fallback disabled; relying on Postgres NOTIFY only.');
  }

  return () => {
    if (poller) clearInterval(poller);
    client.query('UNLISTEN exam_updates').catch(() => null);
    client.release();
  };
}

module.exports.listenForExamUpdates = listenForExamUpdates;

async function listenForAosFieldUpdates(handler) {
  if (!process.env.DATABASE_URL) {
    console.info('DATABASE_URL not set — skipping listenForAosFieldUpdates');
    return () => {};
  }

  const client = await pool.connect();
  client.on('error', (err) => console.error('Postgres AoS listener client error:', err));
  client.on('notification', async (msg) => {
    if (!msg || msg.channel !== 'aos_field_updates') return;
    try {
      await handler(msg.payload || '');
    } catch (e) {
      console.error('Error handling aos_field_updates payload:', e);
    }
  });

  await client.query('LISTEN aos_field_updates');
  console.info('Listening for Postgres NOTIFY on channel: aos_field_updates');

  return () => {
    client.query('UNLISTEN aos_field_updates').catch(() => null);
    client.release();
  };
}

module.exports.listenForAosFieldUpdates = listenForAosFieldUpdates;
