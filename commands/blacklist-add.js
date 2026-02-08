const { SlashCommandBuilder } = require("discord.js");
const { addUsername } = require("../utils/blacklistStore");

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
    const username = interaction.options.getString("username");
    const result = addUsername(username);

    if (result.added) {
      await interaction.reply({ content: `✅ Added **${username}** to the blacklist.`, ephemeral: true });
      return;
    }

    if (result.reason === "exists") {
      await interaction.reply({ content: `⚠️ **${username}** is already blacklisted.`, ephemeral: true });
      return;
    }

    await interaction.reply({ content: "⚠️ Invalid username.", ephemeral: true });
  }
};
