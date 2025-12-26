const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anonymous-case")
    .setDescription("Submit a Sealed Case File to High Command.")
    .addStringOption(option =>
      option
        .setName("link")
        .setDescription("Link to the Case File")
        .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName("casenumber")
            .setDescription("The identifying number of the case")
            .setRequired(true),
    ),

  async execute(interaction) {
    const channel = "1449830431171149885";
    const link = interaction.options.getString("link");
    const casenumber = interaction.options.getString("casenumber");
    await interaction.deferReply();

    try {
    
    const embed = new EmbedBuilder()
        .setTitle(`Sealed Case File #${casenumber}`)
        .setDescription(`Submitted by ${interaction.user}`)
        .addFields(
                { name: "Case File", value: `[View Case File](${link})`, inline: false },
        )
        .setColor(0x00aff1)
        .setTimestamp();

        await channel.send({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await interaction.editReply("⚠️ Something went wrong.");
    }
  }
}