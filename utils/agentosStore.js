const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const FILE_PATH = path.join(__dirname, '..', 'data', 'agentos.json');
const DATABASE_URL = config.DATABASE_URL || process.env.DATABASE_URL || '';

let pool = null;
let initPromise = null;
let writeLock = Promise.resolve();

async function ensureFile() {
  const dir = path.dirname(FILE_PATH);
  await fsp.mkdir(dir, { recursive: true });
  try { await fsp.access(FILE_PATH); } catch (e) { await fsp.writeFile(FILE_PATH, '[]', 'utf8'); }
}

async function readAllFile() {
  await ensureFile();
  try {
    const raw = await fsp.readFile(FILE_PATH, 'utf8');
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list;
  } catch (e) {
    try { await fsp.writeFile(FILE_PATH, '[]', 'utf8'); } catch (e) {}
    return [];
  }
}

async function writeAllFile(list) {
  const tmp = FILE_PATH + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await fsp.rename(tmp, FILE_PATH);
}

function enqueueWriteFile(list) {
  writeLock = writeLock.then(() => writeAllFile(list)).catch(err => console.warn('agentosStore write failed', err));
  return writeLock;
}

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    pool.on('error', (err) => console.error('[agentosStore] Postgres pool error:', err));
  }
  return pool;
}

async function ensureTable() {
  if (!DATABASE_URL) return false;
  if (!initPromise) {
    initPromise = (async () => {
      const db = getPool();
      await db.query(
        `CREATE TABLE IF NOT EXISTS agentos_commands (
          id TEXT PRIMARY KEY,
          command TEXT,
          params TEXT,
          user_id TEXT,
          user_tag TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      console.info('[agentosStore] ensured agentos_commands table exists');
      return true;
    })().catch(err => {
      console.warn('[agentosStore] failed to init table:', err);
      return false;
    });
  }
  return initPromise;
}

async function addEntry({ command, params, userId, userTag }) {
  const id = uuidv4();
  if (!DATABASE_URL) {
    const list = await readAllFile();
    const entry = { id, command: String(command), params: params == null ? null : String(params), userId: userId || null, userTag: userTag || null, createdAt: new Date().toISOString() };
    list.push(entry);
    await enqueueWriteFile(list);
    return entry;
  }
  const ok = await ensureTable();
  if (!ok) throw new Error('db_error');
  const db = getPool();
  await db.query('INSERT INTO agentos_commands (id, command, params, user_id, user_tag) VALUES ($1, $2, $3, $4, $5)', [id, String(command), params == null ? null : String(params), userId || null, userTag || null]);
  return { id, command, params, userId, userTag, createdAt: new Date().toISOString() };
}

async function listEntries(limit = 10) {
  if (!DATABASE_URL) {
    const list = await readAllFile();
    const sorted = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sorted.slice(0, limit);
  }
  const ok = await ensureTable();
  if (!ok) return [];
  const db = getPool();
  const res = await db.query('SELECT id, command, params, user_id AS "userId", user_tag AS "userTag", created_at AS "createdAt" FROM agentos_commands ORDER BY created_at DESC LIMIT $1', [limit]);
  return Array.isArray(res.rows) ? res.rows.map(r => ({ id: r.id, command: r.command, params: r.params, userId: r.userId, userTag: r.userTag, createdAt: (r.createdAt ? (new Date(r.createdAt)).toISOString() : null) })) : [];
}

module.exports = { addEntry, listEntries };
