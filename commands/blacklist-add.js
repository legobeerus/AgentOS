const { SlashCommandBuilder } = require("discord.js");
const { addUsername } = require("../utils/blacklistStore");

const ALLOWED_ROLE_IDS = [
  "1449860815086813224", // OSI HC
  "1449860639475630240" // OSI MC
];

const ALLOWED_USER_IDS = [
  "716248402513494027"
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blacklist-add")
    .setDescription("Add a Roblox username to the application blacklist")
    .addStringOption(option =>
      option
        .setName("username")
        .setDescription("Roblox username to blacklist")
        .setRequired(true)
    ),

  async execute(interaction) {
    console.info(`[blacklist-add] invoked by ${interaction.user?.id}`);
    if (!ALLOWED_USER_IDS.includes(interaction.user.id)) {
      const hasRole = interaction.member?.roles?.cache?.some(role => ALLOWED_ROLE_IDS.includes(role.id));
      if (!hasRole) {
        await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
        return;
      }
    }

    const username = interaction.options.getString("username");
    try {
      const result = await addUsername(username);
      console.info(`[blacklist-add] result for ${username}:`, result);

      if (result.added) {
        await interaction.reply({ content: `✅ Added **${username}** to the blacklist.`, ephemeral: true });
        return;
      }

      if (result.reason === "exists") {
        await interaction.reply({ content: `⚠️ **${username}** is already blacklisted.`, ephemeral: true });
        return;
      }

      await interaction.reply({ content: "⚠️ Invalid username.", ephemeral: true });
    } catch (err) {
      console.error('[blacklist-add] error:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Error adding username to blacklist.", ephemeral: true });
      }
    }
  }
};
