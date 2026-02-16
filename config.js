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
  INVITE_CHANNEL_ID: process.env.INVITE_CHANNEL_ID || "1041577710960513043"
};
