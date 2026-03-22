const { SlashCommandBuilder } = require("discord.js");
const { addUsername } = require("../utils/blacklistStore");
const { getErrorEmbed } = require("../utils/errorCodes");

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
      // Defer reply to avoid interaction timeout if DB ops take time
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });

      const result = await addUsername(username, { id: interaction.user.id, tag: interaction.user.tag });
      console.info(`[blacklist-add] result for ${username}:`, result);

      if (result.added) {
        await interaction.editReply({ content: `✅ Added **${username}** to the blacklist.` });
        return;
      }

      if (result.reason === "exists") {
        await interaction.editReply({ content: `⚠️ **${username}** is already blacklisted.` });
        return;
      }

      if (result.reason === "empty") {
        await interaction.editReply({ content: "⚠️ Invalid or empty username provided." });
        return;
      }

      if (result.reason === "db_error") {
        const embed = getErrorEmbed(70);
        if (embed) await interaction.editReply({ embeds: [embed] });
        else await interaction.editReply({ content: "⚠️ Database error (unable to persist). Try again later." });
        return;
      }

      await interaction.editReply({ content: `⚠️ Operation failed (${String(result.reason) || 'unknown'}).` });
    } catch (err) {
      console.error('[blacklist-add] error:', err);
      try {
        if (!interaction.replied && !interaction.deferred) await interaction.deferReply({ ephemeral: true });
        const embed = getErrorEmbed(50);
        if (embed) await interaction.editReply({ embeds: [embed] });
        else await interaction.editReply({ content: "Error adding username to blacklist." });
      } catch (replyErr) {
        console.error('[blacklist-add] reply error:', replyErr);
      }
    }
  }
};
