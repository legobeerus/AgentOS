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
  await pool.query(
    `CREATE TABLE IF NOT EXISTS bot_verification_challenges (
      roblox_username TEXT,
      roblox_userid TEXT,
      discord_id TEXT,
      code TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (roblox_username, discord_id)
    )`
  );
}

// Note: table initialization is intentionally not run at require-time here.
// Call `init()` from app startup when a real DATABASE_URL is configured.

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

async function listAllDiscordIds() {
  const res = await pool.query('SELECT discord_id FROM bot_verifications WHERE discord_id IS NOT NULL');
  return res.rows.map(r => r.discord_id);
}

// Challenge helpers for two-step verification
async function createChallenge(robloxUsername, robloxUserId, discordId, code, expiresAt) {
  const q = `INSERT INTO bot_verification_challenges (roblox_username, roblox_userid, discord_id, code, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (roblox_username, discord_id) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, created_at = NOW()`;
  await pool.query(q, [robloxUsername.toLowerCase(), robloxUserId ? String(robloxUserId) : null, discordId, String(code), expiresAt]);
}

async function getChallenge(robloxUsername, discordId) {
  const res = await pool.query('SELECT roblox_username, roblox_userid, discord_id, code, expires_at, created_at FROM bot_verification_challenges WHERE roblox_username = $1 AND discord_id = $2', [String(robloxUsername).toLowerCase(), discordId]);
  return res.rows[0] || null;
}

async function clearChallenge(robloxUsername, discordId) {
  await pool.query('DELETE FROM bot_verification_challenges WHERE roblox_username = $1 AND discord_id = $2', [String(robloxUsername).toLowerCase(), discordId]);
}

// Lookup / clear helpers by the stored one-time code/state value
async function getChallengeByCode(code) {
  const res = await pool.query('SELECT roblox_username, roblox_userid, discord_id, code, expires_at, created_at FROM bot_verification_challenges WHERE code = $1', [String(code)]);
  return res.rows[0] || null;
}

async function clearChallengeByCode(code) {
  await pool.query('DELETE FROM bot_verification_challenges WHERE code = $1', [String(code)]);
}

// Export public API (includes challenge helpers and init)
module.exports = {
  addVerification,
  removeByRoblox,
  removeByDiscord,
  getByRoblox,
  getByDiscord,
  createChallenge,
  getChallenge,
  clearChallenge,
  getChallengeByCode,
  clearChallengeByCode,
  listAllDiscordIds,
  init
};

