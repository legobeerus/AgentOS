const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anonymous-log")
    .setDescription("Submit a Sealed Case File or an Anonymous Request")
    .addSubcommand(sub =>
      sub
        .setName("case")
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
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("request")
        .setDescription("Submit an anonymity request for a user.")
        .addStringOption(option =>
          option
            .setName("requester")
            .setDescription("Requester username (who wants anonymity)")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason for the anonymity request")
            .setRequired(true)
        )
        .addAttachmentOption(option =>
          option
            .setName("evidence")
            .setDescription("Optional evidence file (attachment)")
            .setRequired(false)
        )
    ),

  guildOnly: "1041577710067138560",

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = await interaction.guild.channels.fetch("1449830431171149885");
      const sub = interaction.options.getSubcommand();

      if (sub === "case") {
        const link = interaction.options.getString("link");
        const casenumber = interaction.options.getString("casenumber");

        const embed = new EmbedBuilder()
          .setTitle(`Sealed Case File #${casenumber}`)
          .setDescription(`Submitted by ${interaction.user}`)
          .addFields({ name: "Case File", value: `[View Case File](${link})`, inline: false })
          .setColor(0x00aff1)
          .setTimestamp();

        await channel.send({ embeds: [embed] });
        await interaction.editReply("✅ Case submitted successfully.");
        return;
      }

      if (sub === "request") {
        const requester = interaction.options.getString("requester");
        const reason = interaction.options.getString("reason");
        const evidence = interaction.options.getAttachment("evidence");

        const embed = new EmbedBuilder()
          .setTitle("Anonymous Request")
          .setDescription(`Submitted by ${interaction.user}`)
          .addFields(
            { name: "Requester", value: requester, inline: false },
            { name: "Reason", value: reason, inline: false }
          )
          .setColor(0x00aff1)
          .setTimestamp();

        const sendOptions = { embeds: [embed] };
        if (evidence) {
          sendOptions.files = [evidence.url];
          embed.setImage(evidence.url);
        }

        await channel.send(sendOptions);
        await interaction.editReply("✅ Anonymous request submitted successfully.");
        return;
      }

      await interaction.editReply("⚠️ Unknown subcommand.");
    } catch (err) {
      console.error(err);
      try { await interaction.editReply("⚠️ Something went wrong."); } catch (e) {}
    }
  }
};