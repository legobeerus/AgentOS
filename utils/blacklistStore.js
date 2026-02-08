const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "data", "blacklist.json");
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let initPromise = null;

function normalize(username) {
  return String(username || "").trim().toLowerCase();
}

function ensureFileStore() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, "[]", "utf8");
}

function readList() {
  ensureFileStore();
  try {
    const raw = fs.readFileSync(FILE_PATH, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn("Failed to read blacklist store, resetting.", err);
    fs.writeFileSync(FILE_PATH, "[]", "utf8");
    return [];
  }
}

function writeList(list) {
  ensureFileStore();
  fs.writeFileSync(FILE_PATH, JSON.stringify(list, null, 2), "utf8");
}

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
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
    const list = readList();
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
    const list = readList();
    if (list.includes(norm)) return { added: false, reason: "exists" };
    list.push(norm);
    writeList(list);
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
    const list = readList();
    const idx = list.indexOf(norm);
    if (idx === -1) return { removed: false, reason: "missing" };
    list.splice(idx, 1);
    writeList(list);
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
