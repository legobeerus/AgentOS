const { SlashCommandBuilder } = require("discord.js");
const { removeUsername } = require("../utils/blacklistStore");

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
