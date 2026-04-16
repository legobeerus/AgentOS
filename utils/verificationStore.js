const { pool } = require('./db');

async function init() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS bot_verifications (
      roblox_username TEXT PRIMARY KEY,
      roblox_userid TEXT UNIQUE,
      discord_id TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

init().catch(err => console.error('Failed to init bot_verifications table:', err));

async function addVerification(robloxUsername, robloxUserId, discordId) {
  // Enforce one-to-one: check existing bindings
  const byRoblox = await getByRoblox(robloxUsername);
  if (byRoblox) {
    if (byRoblox.discord_id === discordId) return byRoblox; // already same binding
    throw new Error('roblox_already_bound');
  }
  const byDiscord = await getByDiscord(discordId);
  if (byDiscord) {
    if (byDiscord.roblox_username === robloxUsername) return byDiscord;
    throw new Error('discord_already_bound');
  }

  const q = `INSERT INTO bot_verifications (roblox_username, roblox_userid, discord_id) VALUES ($1, $2, $3) RETURNING roblox_username, roblox_userid, discord_id, created_at`;
  const res = await pool.query(q, [robloxUsername.toLowerCase(), robloxUserId ? String(robloxUserId) : null, discordId]);
  return res.rows[0];
}

async function removeByRoblox(robloxUsername) {
  await pool.query('DELETE FROM bot_verifications WHERE roblox_username = $1', [robloxUsername.toLowerCase()]);
}

async function removeByDiscord(discordId) {
  await pool.query('DELETE FROM bot_verifications WHERE discord_id = $1', [discordId]);
}

async function getByRoblox(robloxUsername) {
  const res = await pool.query('SELECT roblox_username, roblox_userid, discord_id, created_at FROM bot_verifications WHERE roblox_username = $1', [String(robloxUsername).toLowerCase()]);
  return res.rows[0] || null;
}

async function getByDiscord(discordId) {
  const res = await pool.query('SELECT roblox_username, roblox_userid, discord_id, created_at FROM bot_verifications WHERE discord_id = $1', [discordId]);
  return res.rows[0] || null;
}

module.exports = { addVerification, removeByRoblox, removeByDiscord, getByRoblox, getByDiscord };
