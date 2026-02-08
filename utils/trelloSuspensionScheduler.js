const axios = require("axios");

const BOARD_ID = process.env.TRELLO_SUSPENSIONS_BOARD_ID || "693f1533319531ec08ae2ff4";
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const COMPLETED_LIST_NAME = process.env.TRELLO_SUSPENSIONS_COMPLETED_LIST || "Completed";
const ACTIVE_LIST_NAMES = ["Approved", "Permanent"];
const INTERVAL_MS = Number(process.env.TRELLO_SUSPENSIONS_POLL_MS || 15 * 60 * 1000);

async function getListIds() {
  const res = await axios.get(`https://api.trello.com/1/boards/${BOARD_ID}/lists`, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, fields: "name" }
  });
  const lists = Array.isArray(res.data) ? res.data : [];
  const active = new Map();
  let completedId = null;

  for (const list of lists) {
    const name = String(list.name || "").toLowerCase();
    if (ACTIVE_LIST_NAMES.some(n => n.toLowerCase() === name)) active.set(name, list.id);
    if (name === COMPLETED_LIST_NAME.toLowerCase()) completedId = list.id;
  }

  return { active, completedId };
}

async function fetchCardsForList(listId) {
  const res = await axios.get(`https://api.trello.com/1/lists/${listId}/cards`, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, fields: "due,dueComplete,closed" }
  });
  return Array.isArray(res.data) ? res.data : [];
}

async function moveCard(cardId, listId) {
  await axios.put(`https://api.trello.com/1/cards/${cardId}`, null, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, idList: listId, dueComplete: true }
  });
}

async function runOnce() {
  if (!TRELLO_KEY || !TRELLO_TOKEN || !BOARD_ID) return;

  const { active, completedId } = await getListIds();
  if (!completedId || active.size === 0) return;

  const now = Date.now();
  for (const listId of active.values()) {
    const cards = await fetchCardsForList(listId);
    for (const card of cards) {
      if (card.closed) continue;
      if (!card.due || card.dueComplete) continue;
      if (new Date(card.due).getTime() <= now) {
        await moveCard(card.id, completedId).catch(() => null);
      }
    }
  }
}

function startSuspensionScheduler() {
  if (!TRELLO_KEY || !TRELLO_TOKEN || !BOARD_ID) {
    console.warn("Suspension scheduler not configured (missing Trello credentials).");
    return;
  }

  runOnce().catch(() => null);
  setInterval(() => {
    runOnce().catch(() => null);
  }, INTERVAL_MS);
}

module.exports = { startSuspensionScheduler };
