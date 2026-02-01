const express = require("express");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require("discord.js");
const config = require("../config");

/**
 * Creates an Express server to handle form submissions from Google Apps Script
 * @param {Client} client - Discord client instance
 * @returns {Express.Application} Express app
 */
function createFormServer(client) {
  const app = express();
  app.use(express.json());

  // Log all incoming requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  /**
   * POST /form-submission
   * Receives form data from Google Apps Script and posts it to Discord
   * Expected body from Google Forms:
   * {
   *   "timestamp": "2024-01-01 12:00:00",
   *   "answers": {
   *     "Question 1": "Answer 1",
   *     "Question 2": "Answer 2"
   *   }
   * }
   */
  app.post("/form-submission", async (req, res) => {
    console.log("📨 Form submission received:", req.body);
    try {
      const { timestamp, answers } = req.body;

      if (!answers || typeof answers !== "object") {
        return res.status(400).json({ error: "Invalid form data: missing or invalid answers" });
      }

      // Use VOTING_CHANNEL_ID from config
      const channelId = config.VOTING_CHANNEL_ID;

      // Fetch the channel
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.error(`Could not fetch channel ${channelId}`);
        return res.status(400).json({ error: "Invalid channel ID or channel is not a text channel" });
      }

      // Convert answers object to fields array
      const fields = Object.entries(answers).map(([question, answer]) => ({
        name: question,
        value: String(answer),
        inline: false
      }));

      // Build the embed
      const embed = new EmbedBuilder()
        .setTitle("Form Submission")
        .setColor(0x00aff1)
        .setTimestamp(timestamp ? new Date(timestamp) : new Date());

      if (fields.length > 0) {
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

      console.log("✅ Form posted to Discord successfully");
      res.status(200).json({ success: true, message: "Form submitted successfully" });
    } catch (error) {
      console.error("Error handling form submission:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Health check endpoint
  app.get("/health", (req, res) => {
    console.log("✅ Health check received");
    res.status(200).json({ status: "ok" });
  });

  // Root endpoint
  app.get("/", (req, res) => {
    res.status(200).json({ message: "Discord bot form server is running" });
  });

  // Catch-all 404 handler
  app.use((req, res) => {
    console.warn(`⚠️ 404: ${req.method} ${req.path} - route not found`);
    res.status(404).json({ error: "Route not found" });
  });

  return app;
}

module.exports = { createFormServer };
