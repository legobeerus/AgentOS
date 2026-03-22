const { pool } = require('./db');

async function getState() {
  const res = await pool.query('SELECT paused_applications, debug_mode FROM bot_admin_state WHERE id = $1', [1]);
  const row = res.rows[0] || {};
  return { pausedApplications: !!row.paused_applications, debugMode: !!row.debug_mode };
}

async function setState(partial) {
  // Fetch current then update only provided fields
  const cur = await getState();
  const paused = typeof partial.pausedApplications === 'boolean' ? partial.pausedApplications : cur.pausedApplications;
  const debug = typeof partial.debugMode === 'boolean' ? partial.debugMode : cur.debugMode;
  const res = await pool.query(
    `UPDATE bot_admin_state SET paused_applications = $1, debug_mode = $2 WHERE id = $3 RETURNING paused_applications, debug_mode`,
    [paused, debug, 1]
  );
  const row = res.rows[0];
  return { pausedApplications: !!row.paused_applications, debugMode: !!row.debug_mode };
}

module.exports = { getState, setState };
