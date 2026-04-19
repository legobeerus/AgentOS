function cleanId(v) {
  if (v === undefined || v === null) return v;
  return String(v).trim().replace(/^\$+/, '');
}

module.exports = {
  // Role allowed to approve cases
  REQUIRED_ROLE_ID: cleanId(process.env.REQUIRED_ROLE_ID) || "1449861438012133566",
  // Channel where approved cases are posted
  TARGET_CHANNEL_ID: cleanId(process.env.TARGET_CHANNEL_ID) || "1449832209316839455",
  // Role to ping when posting approved cases
  PING_ROLE_ID: cleanId(process.env.PING_ROLE_ID) || "1041577710067138561",

  VOTING_CHANNEL_ID: process.env.VOTING_CHANNEL_ID || "1467678462302093334",
  RESULT_CHANNEL_ID: process.env.RESULT_CHANNEL_ID || "1320064034963325068",
  // Channels to post submissions based on verdict
  SUBMIT_GUILTY_CHANNEL_ID: process.env.SUBMIT_GUILTY_CHANNEL_ID || "1449832030291492925",
  SUBMIT_INNOCENT_CHANNEL_ID: process.env.SUBMIT_INNOCENT_CHANNEL_ID || "1449832086818128025",
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
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || "11k9MP9Qqt2-2xTWMco_YyAysAPVXG5PN3E7P18clWXc",
  GOOGLE_SHEETS_API_KEY: process.env.GOOGLE_SHEETS_API_KEY || "AIzaSyBU73pFrxOsIrwj4W_6GlwPv98gpZJBWPg",
  // Range to fetch (e.g. 'Sheet1!A:C'). Defaults to the first 3 columns.
  GOOGLE_SHEETS_RANGE: process.env.GOOGLE_SHEETS_RANGE || 'Blacklists!A4:B1000',

  // Time webhook sheet settings: range to search for usernames and minutes
  TIME_LOG_SHEET_RANGE: process.env.TIME_LOG_SHEET_RANGE || 'Master!A4:K1000',
  // Zero-based indices within the fetched range rows for username and minutes columns
  TIME_LOG_NAME_COL: process.env.TIME_LOG_NAME_COL !== undefined ? Number(process.env.TIME_LOG_NAME_COL) : 0,
  TIME_LOG_MINUTES_COL: process.env.TIME_LOG_MINUTES_COL !== undefined ? Number(process.env.TIME_LOG_MINUTES_COL) : 9,
  // Channel ID for the webhook messages to listen to (set via env)
  TIME_LOG_CHANNEL_ID: process.env.TIME_LOG_CHANNEL_ID || "1484714859592552498",
  // Enable verbose logging for time webhook handler when true (env: TIME_WEBHOOK_VERBOSE=true)
  TIME_WEBHOOK_VERBOSE: (process.env.TIME_WEBHOOK_VERBOSE || '').toLowerCase() === 'true' || process.env.TIME_WEBHOOK_VERBOSE === '1',
  // Optional: zero-based index of the rank column within TIME_LOG_SHEET_RANGE
  TIME_LOG_RANK_COL: process.env.TIME_LOG_RANK_COL !== undefined ? Number(process.env.TIME_LOG_RANK_COL) : 3,
  // Comma-separated list of rank names (case-insensitive) to exclude from quota checks
  GAME_QUOTA_EXCLUDE_RANKS: process.env.GAME_QUOTA_EXCLUDE_RANKS || "Probationary Agent,Chief of Investigations,Deputy Chief of Investigations,Superintendent,Overseer",
  // Channel to post quota check reports
    GAME_QUOTA_CHANNEL_ID: process.env.GAME_QUOTA_CHANNEL_ID || "1494043062991847546",
    GAME_LOG_STRIKE_COL: process.env.GAME_LOG_STRIKE_COL !== undefined ? Number(process.env.GAME_LOG_STRIKE_COL) : 5,
    // Probation detection: comma-separated rank names to consider probationary
    PROBATION_RANK_NAMES: process.env.PROBATION_RANK_NAMES || 'Probationary Agent',
    // Comma-separated role IDs that should trigger an alert if a probationary agent has them
    PROBATION_SUSPICIOUS_ROLE_IDS: process.env.PROBATION_SUSPICIOUS_ROLE_IDS || "1487506799400849518",
    // Comma-separated role IDs that are required for probationary agents; alert if missing
    PROBATION_REQUIRED_ROLE_IDS: process.env.PROBATION_REQUIRED_ROLE_IDS || "1482810978059161610",
    // Channel to post probation alerts
    PROBATION_ALERT_CHANNEL_ID: process.env.PROBATION_ALERT_CHANNEL_ID || "1041577711845519384",
    // Optional: a temporary role ID that the bot can add/remove to force a guildMemberUpdate
    PROBATION_TEMP_ROLE_ID: cleanId(process.env.PROBATION_TEMP_ROLE_ID) || '1494728925383757867',
  // Role to ping in quota reports (separate from general PING_ROLE_ID)
  GAME_QUOTA_PING_ROLE_ID: cleanId(process.env.GAME_QUOTA_PING_ROLE_ID) || "1041577710067138561",
  // Channel where inactivity notices are posted for staff review
  INACTIVITY_CHANNEL_ID: process.env.INACTIVITY_CHANNEL_ID || "1107773216140832878",
  // Comma-separated role IDs allowed to approve inactivity notices
  INACTIVITY_APPROVER_ROLE_IDS: process.env.INACTIVITY_APPROVER_ROLE_IDS || "1449861438012133566",
  // Zero-based index (within TIME_LOG_SHEET_RANGE) of the column to write the end-date to
  TIME_LOG_ENDDATE_COL: process.env.TIME_LOG_ENDDATE_COL !== undefined ? Number(process.env.TIME_LOG_ENDDATE_COL) : 6,
  // Optional: column index (zero-based) for the running total time column (adjacent to minutes column)
  TIME_LOG_TOTAL_COL: process.env.TIME_LOG_TOTAL_COL !== undefined ? Number(process.env.TIME_LOG_TOTAL_COL) : 10,
  // Column index (zero-based) for the SGC/main-group rank within TIME_LOG_SHEET_RANGE
  TIME_LOG_SGC_RANK_COL: process.env.TIME_LOG_SGC_RANK_COL !== undefined ? Number(process.env.TIME_LOG_SGC_RANK_COL) : 1,
  // Roblox group id for the main SGC group used when fetching ranks
  TIME_SGC_GROUP_ID: process.env.TIME_SGC_GROUP_ID !== undefined ? Number(process.env.TIME_SGC_GROUP_ID) : 6762663,

  // Which columns in the fetched range contain the name and the blacklist type.
  // These are zero-based indices into the returned row array. Adjust if your
  // name and type columns are not adjacent.
  GOOGLE_SHEET_NAME_COL: process.env.GOOGLE_SHEET_NAME_COL !== undefined ? Number(process.env.GOOGLE_SHEET_NAME_COL) : 0,
  GOOGLE_SHEET_TYPE_COL: process.env.GOOGLE_SHEET_TYPE_COL !== undefined ? Number(process.env.GOOGLE_SHEET_TYPE_COL) : 1,

  // Blacklist sheet settings (separate tab). Columns are zero-based indices
  BLACKLIST_SHEET_RANGE: process.env.BLACKLIST_SHEET_RANGE || 'Blacklists!A4:I1000',
  BLACKLIST_NAME_COL: process.env.BLACKLIST_NAME_COL !== undefined ? Number(process.env.BLACKLIST_NAME_COL) : 0,
  BLACKLIST_TYPE_COL: process.env.BLACKLIST_TYPE_COL !== undefined ? Number(process.env.BLACKLIST_TYPE_COL) : 1,
  BLACKLIST_ENDDATE_COL: process.env.BLACKLIST_ENDDATE_COL !== undefined ? Number(process.env.BLACKLIST_ENDDATE_COL) : 2,
  BLACKLIST_REASON_COL: process.env.BLACKLIST_REASON_COL !== undefined ? Number(process.env.BLACKLIST_REASON_COL) : 6,

  // Standard embed color (hex). Can be set via env as number (e.g. 0x5865f2) or decimal.
  EMBED_COLOR: process.env.EMBED_COLOR ? Number(process.env.EMBED_COLOR) : 0x00aff1,

  // Comma-separated role IDs that should be excluded from the !verifylist output
  // Example: VERIFYLIST_EXCLUDE_ROLE_IDS=12345,67890
  VERIFYLIST_EXCLUDE_ROLE_IDS: process.env.VERIFYLIST_EXCLUDE_ROLE_IDS || "1263502224181694467,1250194811521208353,1106779772492718180",
  // Arrest logging: channel where arrest embeds are posted
  ARREST_LOG_CHANNEL_ID: process.env.ARREST_LOG_CHANNEL_ID || "1221224045429915759",
  // Comma-separated role IDs that may edit/delete any arrest
  ARREST_ADMIN_ROLE_IDS: process.env.ARREST_ADMIN_ROLE_IDS || "1449861438012133566,1106739929540730921",

  // Service account credentials for private sheets. Provide the full JSON
  // as a string in `GOOGLE_SERVICE_ACCOUNT_JSON` (preferred) or a filesystem
  // path in `GOOGLE_SERVICE_ACCOUNT_PATH` (legacy).
  GOOGLE_SERVICE_ACCOUNT_JSON: (() => {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) return undefined;
    // Try plain JSON
    try { return JSON.parse(raw); } catch (e) {}
    // Try JSON with escaped newlines fixed
    try { return JSON.parse(raw.replace(/\\n/g, '\n')); } catch (e) {}
    // Try base64-encoded JSON
    try { const dec = Buffer.from(raw, 'base64').toString('utf8'); return JSON.parse(dec); } catch (e) {}
    return undefined;
  })(),
  GOOGLE_SERVICE_ACCOUNT_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || undefined
};

// Admin whitelist: comma-separated user IDs in env var ADMIN_WHITELIST
// Example: ADMIN_WHITELIST=123,456,789
module.exports.ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || "716248402513494027").split(",").map(s => cleanId(s)).map(s => s.trim()).filter(Boolean);
// Processed list of role IDs to exclude from verifylist (from VERIFYLIST_EXCLUDE_ROLE_IDS)
module.exports.VERIFYLIST_EXCLUDE_ROLE_IDS_LIST = (process.env.VERIFYLIST_EXCLUDE_ROLE_IDS || "").split(",").map(s => cleanId(s)).map(s => s.trim()).filter(Boolean);
