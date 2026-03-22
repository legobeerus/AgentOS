module.exports = {
  // Role allowed to approve cases
  REQUIRED_ROLE_ID: process.env.REQUIRED_ROLE_ID || "1449861438012133566",
  // Channel where approved cases are posted
  TARGET_CHANNEL_ID: process.env.TARGET_CHANNEL_ID || "1449832209316839455",
  // Role to ping when posting approved cases
  PING_ROLE_ID: process.env.PING_ROLE_ID || "1041577710067138561",

  VOTING_CHANNEL_ID: process.env.VOTING_CHANNEL_ID || "1467678462302093334",
  RESULT_CHANNEL_ID: process.env.RESULT_CHANNEL_ID || "1320064034963325068",
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || "1467682055298089131",
  // Channel to notify when a DM to an applicant fails. If unset, code falls back to LOG_CHANNEL_ID then RESULT_CHANNEL_ID.
  DM_FAIL_CHANNEL_ID: process.env.DM_FAIL_CHANNEL_ID || "1041577711845519384",
  // Channel ID to create one-time invites in (falls back to the voting channel)
  INVITE_CHANNEL_ID: process.env.INVITE_CHANNEL_ID || "1041577710960513043",

  // Guild ID allowed to use blacklist view commands
  BLACKLIST_GUILD_ID: process.env.BLACKLIST_GUILD_ID || "1041577710067138560",

  // Trello ingest/watch channel and list for message-to-Trello ingestion
  TRELLO_INGEST_CHANNEL_ID: process.env.TRELLO_INGEST_CHANNEL_ID || "1221224045429915759",
  TRELLO_CREATE_LIST_ID: process.env.TRELLO_CREATE_LIST_ID || "6940345b7ed679287366e82b",

  // Suspensions Trello board id (used by suspension commands)
  TRELLO_SUSPENSIONS_BOARD_ID: process.env.TRELLO_SUSPENSIONS_BOARD_ID || "693f1533319531ec08ae2ff4",

  // Database URL for blacklist roster
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:FsafHCChNBfgeTRpRHHeYsGIXvMQWzmc@postgres.railway.internal:5432/railway"
  ,
  // Optional: Google Sheets lookup for background checks
  // Set GOOGLE_SHEET_ID and GOOGLE_SHEETS_API_KEY in your environment to enable
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || "1UhVuCLbo6K4Ij9eiVezkeykObKZvdVNVw3SXKz7bUbU",
  GOOGLE_SHEETS_API_KEY: process.env.GOOGLE_SHEETS_API_KEY || "AIzaSyBU73pFrxOsIrwj4W_6GlwPv98gpZJBWPg",
  // Range to fetch (e.g. 'Sheet1!A:C'). Defaults to the first 3 columns.
  GOOGLE_SHEETS_RANGE: process.env.GOOGLE_SHEETS_RANGE || 'BLACKLIST!B11:D1000',

  // Which columns in the fetched range contain the name and the blacklist type.
  // These are zero-based indices into the returned row array. Adjust if your
  // name and type columns are not adjacent.
  GOOGLE_SHEET_NAME_COL: process.env.GOOGLE_SHEET_NAME_COL !== undefined ? Number(process.env.GOOGLE_SHEET_NAME_COL) : 0,
  GOOGLE_SHEET_TYPE_COL: process.env.GOOGLE_SHEET_TYPE_COL !== undefined ? Number(process.env.GOOGLE_SHEET_TYPE_COL) : 2,

  // Service account credentials for private sheets. Provide the full JSON
  // as a string in `GOOGLE_SERVICE_ACCOUNT_JSON` (preferred) or a filesystem
  // path in `GOOGLE_SERVICE_ACCOUNT_PATH` (legacy).
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?
    (() => { try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch (e) { return process.env.GOOGLE_SERVICE_ACCOUNT_JSON; } })()
    : undefined,
  GOOGLE_SERVICE_ACCOUNT_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || undefined
};

// Admin whitelist: comma-separated user IDs in env var ADMIN_WHITELIST
// Example: ADMIN_WHITELIST=123,456,789
module.exports.ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || "").split(",").map(s => s.trim()).filter(Boolean);
