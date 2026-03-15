const axios = require("axios");
const { getErrorEmbed } = require("./errorCodes");

const WATCH_CHANNEL_ID = process.env.TRELLO_INGEST_CHANNEL_ID || "1221224045429915759";
const TRELLO_LIST_ID = process.env.TRELLO_CREATE_LIST_ID || "6940345b7ed679287366e82b";
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const TRELLO_LABEL_NAME = process.env.TRELLO_LABEL_NAME || "OSI Approved";
const TRELLO_LABEL_COLOR = process.env.TRELLO_LABEL_COLOR || "blue";

let cachedLabelId = null;

function parseMessage(content) {
  const pattern = /Suspect:\s*([\s\S]*?)\s*Incident Summary:\s*([\s\S]*?)\s*(?:Charge\(s\)|Charges?)\s*:\s*([\s\S]*?)\s*Sentence:\s*([\s\S]*?)\s*Proof:\s*([\s\S]*)/i;
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

async function getLabelIdByName() {
  if (cachedLabelId) return cachedLabelId;
  if (!TRELLO_LABEL_NAME) return null;

  const listRes = await axios.get(`https://api.trello.com/1/lists/${TRELLO_LIST_ID}`, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, fields: "idBoard" }
  });
  const boardId = listRes.data?.idBoard;
  if (!boardId) return null;

  const labelsRes = await axios.get(`https://api.trello.com/1/boards/${boardId}/labels`, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, fields: "name,color", limit: 1000 }
  });
  const labels = Array.isArray(labelsRes.data) ? labelsRes.data : [];
  const label = labels.find(l => String(l.name || "").toLowerCase() === TRELLO_LABEL_NAME.toLowerCase());
  if (label?.id) {
    cachedLabelId = label.id;
    return cachedLabelId;
  }

  const createRes = await axios.post("https://api.trello.com/1/labels", null, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      idBoard: boardId,
      name: TRELLO_LABEL_NAME,
      color: TRELLO_LABEL_COLOR
    }
  });
  cachedLabelId = createRes.data?.id || null;
  return cachedLabelId;
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

  const labelId = await getLabelIdByName();

  await axios.post("https://api.trello.com/1/cards", null, {
    params: {
      idList: TRELLO_LIST_ID,
      name,
      desc,
      idLabels: labelId ? labelId : undefined,
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
  if (!parsed) {
    // If the message contains at least one of the expected fields but parsing failed,
    // react with ❌ and reply with error code 60 so the sender knows the format is invalid.
    try {
      const contentLower = String(message.content || "").toLowerCase();
      const markers = ["suspect:", "incident summary:", "charge:", "charges:", "sentence:", "proof:"];
      const hasMarker = markers.some(m => contentLower.includes(m));
      if (hasMarker) {
        try { await message.react("❌").catch(() => null); } catch (_) {}
        try {
          const embed = getErrorEmbed(60);
          if (embed) await message.reply({ embeds: [embed] }).catch(() => null);
        } catch (_) {}
        return;
      }
    } catch (e) {
      // ignore marker-detection errors and fall through to no-op
    }
    return;
  }

  try {
    await createTrelloCard(parsed, message);
    await message.react("✅").catch(() => null);
  } catch (err) {
    console.error("Failed to create Trello card from message:", err);
    // React with failure emoji if possible
    try {
      await message.react("❌").catch(() => null);
    } catch (_) {}

    // Try to let the user know via a reply with the error code embed
    try {
      const embed = getErrorEmbed(60);
      if (embed) await message.reply({ embeds: [embed] }).catch(() => null);
    } catch (_) {}
  }
}

module.exports = { handleTrelloIngest };
