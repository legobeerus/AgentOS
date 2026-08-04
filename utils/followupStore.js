const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const FILE_PATH = path.join(__dirname, '..', 'data', 'followups.json');
const DATABASE_URL = config.DATABASE_URL || process.env.DATABASE_URL || '';

let pool = null;
let initPromise = null;
let writeLock = Promise.resolve();

async function ensureFile() {
  const dir = path.dirname(FILE_PATH);
  await fsp.mkdir(dir, { recursive: true });
  try {
    await fsp.access(FILE_PATH);
  } catch (e) {
    await fsp.writeFile(FILE_PATH, '[]', 'utf8');
  }
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
  writeLock = writeLock.then(() => writeAllFile(list)).catch(err => console.warn('followupStore write failed', err));
  return writeLock;
}

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    pool.on('error', (err) => console.error('[followupStore] Postgres pool error:', err));
  }
  return pool;
}

async function ensureTable() {
  if (!DATABASE_URL) return false;
  if (!initPromise) {
    initPromise = (async () => {
      const db = getPool();
      await db.query(
          `CREATE TABLE IF NOT EXISTS followups (
              id TEXT PRIMARY KEY,
              guild_id TEXT,
              thread_id TEXT,
              send_at TIMESTAMPTZ,
              content TEXT,
              allowed_mentions TEXT
            )`
      );
      console.info('[followupStore] ensured followups table exists');
      return true;
    })().catch(err => {
      console.warn('[followupStore] failed to init followups table:', err);
      return false;
    });
  }
  return initPromise;
}

async function addFollowup({ guildId, threadId, sendAt, content }) {
  const allowedMentions = arguments[0].allowedMentions || [];
  const id = uuidv4();
  if (!DATABASE_URL) {
    const list = await readAllFile();
    const entry = { id, guildId, threadId, sendAt: new Date(sendAt).toISOString(), content, allowedMentions };
    list.push(entry);
    await enqueueWriteFile(list);
    return entry;
  }
  const ok = await ensureTable();
  if (!ok) throw new Error('db_error');
  const db = getPool();
  await db.query('INSERT INTO followups (id, guild_id, thread_id, send_at, content, allowed_mentions) VALUES ($1, $2, $3, $4, $5, $6)', [id, String(guildId), String(threadId), new Date(sendAt).toISOString(), content, JSON.stringify(allowedMentions)]);
  return { id, guildId, threadId, sendAt: new Date(sendAt).toISOString(), content, allowedMentions };
}

async function removeFollowup(id) {
  if (!DATABASE_URL) {
    const list = await readAllFile();
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await enqueueWriteFile(list);
    return true;
  }
  const ok = await ensureTable();
  if (!ok) return false;
  const db = getPool();
  const res = await db.query('DELETE FROM followups WHERE id = $1', [id]);
  return res.rowCount > 0;
}

async function listFollowups() {
  if (!DATABASE_URL) return await readAllFile();
  const ok = await ensureTable();
  if (!ok) return [];
  const db = getPool();
  try {
    const res = await db.query('SELECT id, guild_id AS "guildId", thread_id AS "threadId", send_at AS "sendAt", content, allowed_mentions FROM followups');
    return Array.isArray(res.rows) ? res.rows.map(r => ({ id: r.id, guildId: r.guildId, threadId: r.threadId, sendAt: (r.sendAt ? (new Date(r.sendAt)).toISOString() : null), content: r.content, allowedMentions: (r.allowed_mentions ? JSON.parse(r.allowed_mentions) : []) })) : [];
  } catch (e) {
    console.warn('[followupStore] failed to list from db:', e);
    return [];
  }
}

module.exports = { addFollowup, removeFollowup, listFollowups };
