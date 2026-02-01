const { handleSlashCommand } = require("./handleSlashCommand");
const { handleApproveButton } = require("./handleApproveButton");
const { handleFormReview } = require("./handleFormReview");
const { handleReviewModal } = require("./handleReviewModal");

/**
 * Main interaction handler that routes to appropriate handlers
 * @param {Interaction} interaction - The interaction that was triggered
 * @param {Client} client - Discord client instance
 */
async function handleInteraction(interaction, client) {
  try {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, client);
      return;
    }

    // Handle button interactions
    if (interaction.isButton()) {
      if (interaction.customId === "approve_request") {
        await handleApproveButton(interaction);
        return;
      }

      if (interaction.customId === "approve" || interaction.customId === "deny") {
        await handleFormReview(interaction);
        return;
      }
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("feedback_")) {
        await handleReviewModal(interaction);
        return;
      }
    }
  } catch (error) {
    console.error("Unhandled error in interaction handler:", error);
  }
}

module.exports = { handleInteraction };
