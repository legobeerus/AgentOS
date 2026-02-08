const { SlashCommandBuilder } = require("discord.js");
const { removeUsername } = require("../utils/blacklistStore");

const ALLOWED_ROLE_IDS = [
  "1449860815086813224", // OSI HC
  "1449860639475630240" // OSI MC
];

const ALLOWED_USER_IDS = [
  "716248402513494027"
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blacklist-remove")
    .setDescription("Remove a Roblox username from the application blacklist")
    .addStringOption(option =>
      option
        .setName("username")
        .setDescription("Roblox username to remove from blacklist")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!ALLOWED_USER_IDS.includes(interaction.user.id)) {
      const hasRole = interaction.member?.roles?.cache?.some(role => ALLOWED_ROLE_IDS.includes(role.id));
      if (!hasRole) {
        await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
        return;
      }
    }

    const username = interaction.options.getString("username");
    const result = removeUsername(username);

    if (result.removed) {
      await interaction.reply({ content: `✅ Removed **${username}** from the blacklist.`, ephemeral: true });
      return;
    }

    if (result.reason === "missing") {
      await interaction.reply({ content: `⚠️ **${username}** is not in the blacklist.`, ephemeral: true });
      return;
    }

    await interaction.reply({ content: "⚠️ Invalid username.", ephemeral: true });
  }
};
