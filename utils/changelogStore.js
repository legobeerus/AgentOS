const { pool } = require('./db');

async function getChangelog() {
  const res = await pool.query('SELECT version, additions, notes, updated_at FROM bot_changelog WHERE id = $1', [1]);
  if (!res.rows[0]) return { version: '', additions: '', notes: '', updatedAt: null };
  const row = res.rows[0];
  return { version: row.version || '', additions: row.additions || '', notes: row.notes || '', updatedAt: row.updated_at ? row.updated_at.toISOString() : null };
}

async function setChangelog({ version, additions, notes }) {
  const res = await pool.query(
    `UPDATE bot_changelog SET version = $1, additions = $2, notes = $3, updated_at = NOW() WHERE id = $4 RETURNING version, additions, notes, updated_at`,
    [version || '', additions || '', notes || '', 1]
  );
  const row = res.rows[0];
  return { version: row.version, additions: row.additions, notes: row.notes, updatedAt: row.updated_at ? row.updated_at.toISOString() : null };
}

module.exports = { getChangelog, setChangelog };
