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
    console.info(`[blacklist-remove] invoked by ${interaction.user?.id}`);
    if (!ALLOWED_USER_IDS.includes(interaction.user.id)) {
      const hasRole = interaction.member?.roles?.cache?.some(role => ALLOWED_ROLE_IDS.includes(role.id));
      if (!hasRole) {
        await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
        return;
      }
    }

    const username = interaction.options.getString("username");
    try {
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });

      const result = await removeUsername(username);
      console.info(`[blacklist-remove] result for ${username}:`, result);

      if (result.removed) {
        await interaction.editReply({ content: `✅ Removed **${username}** from the blacklist.` });
        return;
      }

      if (result.reason === "missing") {
        await interaction.editReply({ content: `⚠️ **${username}** is not in the blacklist.` });
        return;
      }

      await interaction.editReply({ content: "⚠️ Invalid username." });
    } catch (err) {
      console.error('[blacklist-remove] error:', err);
      try {
        if (!interaction.replied && !interaction.deferred) await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ content: "Error removing username from blacklist." });
      } catch (replyErr) {
        console.error('[blacklist-remove] reply error:', replyErr);
      }
    }
  }
};
