/**
 * Handles modal submission for review feedback
 * @param {ModalSubmitInteraction} interaction - The modal submission interaction
 */
async function handleReviewModal(interaction) {
  if (!interaction.customId.startsWith("feedback_")) return;

  const approved = interaction.customId === "feedback_approve";
  const feedback = interaction.fields.getTextInputValue("feedback");

  const message = interaction.message; // original embed message
  const embed = message.embeds[0];

  // Extract applicant username
  const applicantField = embed.fields.find(f => f.name === "Applicant");
  const applicantUsername = applicantField?.value;

  // Try to find the user
  let applicantUser = null;
  if (applicantUsername) {
    applicantUser = interaction.client.users.cache.find(
      u => `${u.username}#${u.discriminator}` === applicantUsername
    );
  }

  // Update embed
  const updatedEmbed = {
    ...embed.data,
    color: approved ? 0x57F287 : 0xED4245,
    fields: [
      ...embed.fields,
      {
        name: "Result",
        value: approved ? "✅ Approved" : "❌ Denied",
        inline: true
      },
      {
        name: "Moderator Feedback",
        value: feedback,
        inline: false
      }
    ]
  };

  await message.edit({
    embeds: [updatedEmbed],
    components: []
  });

  // Ping applicant
  if (applicantUser) {
    await message.channel.send({
      content: `${applicantUser}, your application has been **${approved ? "approved" : "denied"}**.\n\n**Feedback:**\n${feedback}`
    });
  }

  await interaction.reply({
    content: "✅ Decision recorded.",
    ephemeral: true
  });
}

module.exports = { handleReviewModal };