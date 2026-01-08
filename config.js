module.exports = {
  // Role allowed to approve cases
  REQUIRED_ROLE_ID: process.env.REQUIRED_ROLE_ID || "1449861438012133566",
  // Channel where approved cases are posted
  TARGET_CHANNEL_ID: process.env.TARGET_CHANNEL_ID || "1449832209316839455",
  // Role to ping when posting approved cases
  PING_ROLE_ID: process.env.PING_ROLE_ID || "1041582619965542400"
};
