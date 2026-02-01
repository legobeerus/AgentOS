const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");

/**
 * Handles approve/deny button interactions by showing a feedback modal
 * @param {ButtonInteraction} interaction - The button interaction
 */
async function handleFormReview(interaction) {
  const isApprove = interaction.customId === "approve";
  const isDeny = interaction.customId === "deny";

  if (!isApprove && !isDeny) return;

  const modal = new ModalBuilder()
    .setCustomId(`feedback_${interaction.customId}`)
    .setTitle(isApprove ? "Approval Feedback" : "Denial Feedback");

  const feedbackInput = new TextInputBuilder()
    .setCustomId("feedback")
    .setLabel("Feedback for the applicant")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(feedbackInput)
  );

  await interaction.showModal(modal);
}

module.exports = { handleFormReview };