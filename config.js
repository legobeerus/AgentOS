module.exports = {
  // Role allowed to approve cases
  REQUIRED_ROLE_ID: process.env.REQUIRED_ROLE_ID || "1449861438012133566",
  // Channel where approved cases are posted
  TARGET_CHANNEL_ID: process.env.TARGET_CHANNEL_ID || "1449832209316839455",
  // Role to ping when posting approved cases
  PING_ROLE_ID: process.env.PING_ROLE_ID || "1041577710067138561",

  VOTING_CHANNEL_ID: process.env.VOTING_CHANNEL_ID || "1467678462302093334",
  RESULT_CHANNEL_ID: process.env.RESULT_CHANNEL_ID || "1320064034963325068",
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || "1467682055298089131"
  ,
  // Channel ID to create one-time invites in (falls back to the voting channel)
  INVITE_CHANNEL_ID: process.env.INVITE_CHANNEL_ID || "1041577710960513043",

  // Guild ID allowed to use blacklist view commands
  BLACKLIST_GUILD_ID: process.env.BLACKLIST_GUILD_ID || "1041577710067138560",

  // Trello ingest/watch channel and list for message-to-Trello ingestion
  TRELLO_INGEST_CHANNEL_ID: process.env.TRELLO_INGEST_CHANNEL_ID || "1221224045429915759",
  TRELLO_CREATE_LIST_ID: process.env.TRELLO_CREATE_LIST_ID || "6940345b7ed679287366e82b",

  // Suspensions Trello board id (used by suspension commands)
  TRELLO_SUSPENSIONS_BOARD_ID: process.env.TRELLO_SUSPENSIONS_BOARD_ID || "693f1533319531ec08ae2ff4"
};

