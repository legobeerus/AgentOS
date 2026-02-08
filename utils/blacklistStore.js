const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "data", "blacklist.json");

function ensureStore() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, "[]", "utf8");
}

function readList() {
  ensureStore();
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
  ensureStore();
  fs.writeFileSync(FILE_PATH, JSON.stringify(list, null, 2), "utf8");
}

function normalize(username) {
  return String(username || "").trim().toLowerCase();
}

function hasUsername(username) {
  const norm = normalize(username);
  if (!norm) return false;
  const list = readList();
  return list.includes(norm);
}

function addUsername(username) {
  const norm = normalize(username);
  if (!norm) return { added: false, reason: "empty" };
  const list = readList();
  if (list.includes(norm)) return { added: false, reason: "exists" };
  list.push(norm);
  writeList(list);
  return { added: true };
}

function removeUsername(username) {
  const norm = normalize(username);
  if (!norm) return { removed: false, reason: "empty" };
  const list = readList();
  const idx = list.indexOf(norm);
  if (idx === -1) return { removed: false, reason: "missing" };
  list.splice(idx, 1);
  writeList(list);
  return { removed: true };
}

module.exports = {
  hasUsername,
  addUsername,
  removeUsername
};
