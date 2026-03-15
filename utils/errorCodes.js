const { EmbedBuilder } = require("discord.js");

const ERROR_CODES = {
  10: {
    title: "Too many results",
    description:
      "`checksecurity` found too many suspicious members and cannot post the full result. Narrow the check or query a smaller group.",
  },
  20: {
    title: "Roblox API rate limited",
    description:
      "The Roblox API returned HTTP 429 (rate limited). Wait a short time and try again.",
  },
  30: {
    title: "Missing bot permissions",
    description: "The bot lacks the required Discord permissions to perform this action (send messages, embed links, or manage messages).",
  },
  31: {
    title: "DM delivery failed",
    description: "Could not deliver a direct message to the user (DMs may be disabled or blocked).",
  },
  40: {
    title: "Invalid command usage",
    description: "The command was used with missing or invalid arguments. Check the command syntax and try again.",
  },
  41: {
    title: "Roblox user not found",
    description: "The requested Roblox username could not be resolved to a user ID.",
  },
  42: {
    title: "Roblox API server error",
    description: "Roblox returned a server error (5xx). Try again later.",
  },
  43: {
    title: "External API timeout",
    description: "A network request timed out or failed to complete. Try again.",
  },
  50: {
    title: "Internal exception",
    description: "An unexpected internal error occurred. Check logs for details.",
  },
  60: {
    title: "Trello ingest error",
    description: "Failed to create or update a Trello card from the provided message. Check Trello configuration and message format.",
  },
  70: {
    title: "Database error",
    description: "Failed to read or write persistent data (local file or DB). Try again later.",
  },
  80: {
    title: "Discord rate limited",
    description: "Discord returned HTTP 429 while sending or editing a message. Wait and try again.",
  },
  90: {
    title: "Content too large",
    description: "The content exceeds Discord limits (embed or message size) and could not be posted.",
  },
};

function getAllCodes() {
  return ERROR_CODES;
}

function getErrorEmbed(code) {
  const info = ERROR_CODES[code];
  if (!info) return null;
  const embed = new EmbedBuilder()
    .setTitle(`Error Code ${code}: ${info.title}`)
    .setColor(0xed4245)
    .setDescription(info.description);
  return embed;
}

function getIndexEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("Error Index")
    .setColor(0x5865f2)
    .setDescription("List of current error codes and their meanings.");

  const fields = Object.entries(ERROR_CODES).map(([code, info]) => ({
    name: `Code ${code} — ${info.title}`,
    value: info.description,
    inline: false,
  }));

  if (fields.length > 0) embed.addFields(fields);
  return embed;
}

module.exports = {
  getAllCodes,
  getErrorEmbed,
  getIndexEmbed,
};
