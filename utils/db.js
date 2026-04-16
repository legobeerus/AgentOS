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
