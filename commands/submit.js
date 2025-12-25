const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const axios = require("axios");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("submit")
        .setDescription("Submit a case for review")
        .addStringOption(option =>
            option
                .setName("link")
                .setDescription("Link to the case file")
                .setRequired(true),
            option
                .setName("casenumber")
                .setDescription("The identifying number of the case")
                .setRequired(true),
            option
                .setName("verdict")
                .setDescription("The verdict of the case")
                .setRequired(true),
            option
                .setName("suspect")
                .setDescription("Username of the suspect")
                .setRequired(true),
    ),

    // gets the inputs in the command
    async execute(interaction) {
        const link = interaction.options.getString("link");
        const casenumber = interaction.options.getString("casenumber");
        const verdict = interaction.options.getString("verdict");
        const suspect = interaction.options.getString("suspect");
        await interaction.deferReply();

        try {

        // builds the embed
        const embed = new EmbedBuilder()
            .setTitle(`Case Submission - #${casenumber}`)
            .setDescription(`Submitted by ${interaction.user}`)
            .addFields(
                { name: "Case File", value: `[View Case File](${link})`, inline: false },
                { name: "Case Number", value: `${casenumber}`, inline: false },
                { name: "Suspect Username", value: `${suspect}`, inline: false },
                { name: "Verdict", value: `${verdict}`, inline: false }
            )
            .setColor(0x00aff1)
            .setFooter({ text: `Submitted at` })
            .setTimestamp();
        
        const approveButton = new ButtonBuilder()
            .setCustomId("approve_request")
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(approveButton);

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });


    } catch (err) {
        console.error(err);
        await interaction.editReply("⚠️ Something went wrong.");
    }
  }
};