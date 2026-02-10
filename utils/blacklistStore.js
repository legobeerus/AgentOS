const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "data", "blacklist.json");
const DATABASE_URL = process.env.DATABASE_URL;

console.info("[blacklistStore] storage:", DATABASE_URL ? "postgres (DATABASE_URL set)" : "file (no DATABASE_URL)");

let pool = null;
let initPromise = null;

let writeLock = Promise.resolve();

function normalize(username) {
  return String(username || "").trim().toLowerCase();
}

async function ensureFileStore() {
  const dir = path.dirname(FILE_PATH);
  await fsp.mkdir(dir, { recursive: true });
  try {
    await fsp.access(FILE_PATH);
  } catch (err) {
    await fsp.writeFile(FILE_PATH, "[]", "utf8");
  }
}

async function readList() {
  await ensureFileStore();
  try {
    const raw = await fsp.readFile(FILE_PATH, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn("Failed to read blacklist store, resetting.", err);
    try { await fsp.writeFile(FILE_PATH, "[]", "utf8"); } catch (e) {}
    return [];
  }
}

async function doAtomicWrite(list) {
  const tmp = FILE_PATH + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fsp.rename(tmp, FILE_PATH);
}

function enqueueWrite(list) {
  writeLock = writeLock
    .then(() => doAtomicWrite(list))
    .catch(err => {
      console.warn("Failed to write blacklist store:", err);
    });
  return writeLock;
}

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require("pg");
    console.info("[blacklistStore] creating Postgres pool");
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    pool.on("error", (err) => {
      console.error("[blacklistStore] Postgres pool error:", err);
    });
  }
  return pool;
}

async function ensureTable() {
  if (!DATABASE_URL) return false;
  if (!initPromise) {
    initPromise = (async () => {
      const db = getPool();
      await db.query(
        "CREATE TABLE IF NOT EXISTS blacklist (username TEXT PRIMARY KEY)"
      );
      console.info("[blacklistStore] ensured blacklist table exists");
      return true;
    })().catch(err => {
      console.warn("Failed to init blacklist table:", err);
      return false;
    });
  }
  return initPromise;
}

async function hasUsername(username) {
  const norm = normalize(username);
  if (!norm) return false;

  if (!DATABASE_URL) {
    const list = await readList();
    return list.includes(norm);
  }

  const ok = await ensureTable();
  if (!ok) return false;
  const db = getPool();
  const result = await db.query("SELECT 1 FROM blacklist WHERE username = $1", [norm]);
  return result.rowCount > 0;
}

async function addUsername(username) {
  const norm = normalize(username);
  if (!norm) return { added: false, reason: "empty" };

  if (!DATABASE_URL) {
    const list = await readList();
    if (list.includes(norm)) return { added: false, reason: "exists" };
    list.push(norm);
    await enqueueWrite(list);
    return { added: true };
  }

  const ok = await ensureTable();
  if (!ok) return { added: false, reason: "db_error" };
  const db = getPool();
  const result = await db.query(
    "INSERT INTO blacklist (username) VALUES ($1) ON CONFLICT DO NOTHING",
    [norm]
  );
  if (result.rowCount === 0) return { added: false, reason: "exists" };
  return { added: true };
}

async function removeUsername(username) {
  const norm = normalize(username);
  if (!norm) return { removed: false, reason: "empty" };

  if (!DATABASE_URL) {
    const list = await readList();
    const idx = list.indexOf(norm);
    if (idx === -1) return { removed: false, reason: "missing" };
    list.splice(idx, 1);
    await enqueueWrite(list);
    return { removed: true };
  }

  const ok = await ensureTable();
  if (!ok) return { removed: false, reason: "db_error" };
  const db = getPool();
  const result = await db.query("DELETE FROM blacklist WHERE username = $1", [norm]);
  if (result.rowCount === 0) return { removed: false, reason: "missing" };
  return { removed: true };
}

module.exports = {
  hasUsername,
  addUsername,
  removeUsername
};
