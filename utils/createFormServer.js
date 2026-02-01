const express = require("express");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require("discord.js");

/**
 * Creates an Express server to handle form submissions from Google Apps Script
 * @param {Client} client - Discord client instance
 * @returns {Express.Application} Express app
 */
function createFormServer(client) {
  const app = express();
  app.use(express.json());

  /**
   * POST /form-submission
   * Receives form data from Google Apps Script and posts it to Discord
   * Expected body:
   * {
   *   "channelId": "channel-id",
   *   "title": "Form Title",
   *   "fields": [
   *     { "name": "Field Name", "value": "Field Value" },
   *     ...
   *   ]
   * }
   */
  app.post("/form-submission", async (req, res) => {
    try {
      const { channelId, title, fields, color } = req.body;

      if (!channelId || !title) {
        return res.status(400).json({ error: "Missing channelId or title" });
      }

      // Fetch the channel
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return res.status(400).json({ error: "Invalid channel ID or channel is not a text channel" });
      }

      // Build the embed
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color || 0x00aff1)
        .setTimestamp();

      if (fields && Array.isArray(fields)) {
        embed.addFields(fields);
      }

      // Create approve/deny buttons
      const approveButton = new ButtonBuilder()
        .setCustomId("approve")
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success);

      const denyButton = new ButtonBuilder()
        .setCustomId("deny")
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger);

      const components = [new ActionRowBuilder().addComponents(approveButton, denyButton)];

      // Send the embed with buttons to the channel
      await channel.send({
        embeds: [embed],
        components
      });

      res.status(200).json({ success: true, message: "Form submitted successfully" });
    } catch (error) {
      console.error("Error handling form submission:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return app;
}

module.exports = { createFormServer };
