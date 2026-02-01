/**
 * Handles modal submission for review feedback
 * @param {ModalSubmitInteraction} interaction - The modal submission interaction
 */
async function handleReviewModal(interaction) {
  if (!interaction.customId.startsWith("feedback_")) return;

  // customId format: feedback_<approve|deny>_<messageId>
  const parts = interaction.customId.split("_");
  const action = parts[1];
  const messageId = parts.slice(2).join("_");
  const approved = action === "approve";
  const feedback = interaction.fields.getTextInputValue("feedback");

  // Try to fetch the original message using the messageId embedded in the modal id
  let message;
  try {
    message = await interaction.channel.messages.fetch(messageId);
  } catch (err) {
    console.error("Could not fetch original message for review modal:", err);
    await interaction.reply({ content: "⚠️ Could not find the original message to update.", ephemeral: true });
    return;
  }

  const embed = message.embeds[0];

  // Extract applicant username
  const applicantField = embed.fields.find(f => f.name === "Discord Username (ex: animatedgreat)");
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