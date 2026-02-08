const axios = require("axios");

const WATCH_CHANNEL_ID = process.env.TRELLO_INGEST_CHANNEL_ID || "1221224045429915759";
const TRELLO_LIST_ID = process.env.TRELLO_CREATE_LIST_ID || "6940345b7ed679287366e82b";
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

function parseMessage(content) {
  const pattern = /Suspect:\s*([\s\S]*?)\s*Incident Summary:\s*([\s\S]*?)\s*Charge\(s\):\s*([\s\S]*?)\s*Sentence:\s*([\s\S]*?)\s*Proof:\s*([\s\S]*)/i;
  const match = String(content || "").match(pattern);
  if (!match) return null;

  return {
    suspect: match[1].trim(),
    summary: match[2].trim(),
    charges: match[3].trim(),
    sentence: match[4].trim(),
    proof: match[5].trim()
  };
}

async function createTrelloCard(parsed, message) {
  const name = parsed.suspect;
  const desc = [
    `Incident Summary: ${parsed.summary}`,
    `Charge(s): ${parsed.charges}`,
    `Sentence: ${parsed.sentence}`,
    `Proof: ${parsed.proof}`,
    `Source: ${message.url}`
  ].join("\n");

  await axios.post("https://api.trello.com/1/cards", null, {
    params: {
      idList: TRELLO_LIST_ID,
      name,
      desc,
      key: TRELLO_KEY,
      token: TRELLO_TOKEN
    }
  });
}

async function handleTrelloIngest(message) {
  if (!message || message.author?.bot) return;
  if (!message.guild) return;
  if (message.channelId !== WATCH_CHANNEL_ID) return;
  if (!message.content) return;

  if (!TRELLO_KEY || !TRELLO_TOKEN || !TRELLO_LIST_ID) {
    console.warn("Trello ingest is not configured (missing key/token/list id).");
    return;
  }

  const parsed = parseMessage(message.content);
  if (!parsed) return;

  try {
    await createTrelloCard(parsed, message);
    await message.react("✅").catch(() => null);
  } catch (err) {
    console.error("Failed to create Trello card from message:", err);
  }
}

module.exports = { handleTrelloIngest };
