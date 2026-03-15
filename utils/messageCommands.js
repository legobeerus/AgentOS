const { getIndexEmbed } = require("./errorCodes");
const { EmbedBuilder } = require("discord.js");

async function handleMessageCommands(message, client) {
  // Ignore bots
  if (message.author.bot) return;

  // Only respond when the bot is mentioned and the message contains a ! command
  const mention = message.mentions && message.mentions.users && message.mentions.users.has(client.user.id);
  if (!mention) return;

  const content = message.content || "";
  const lower = content.toLowerCase();

  if (lower.includes("!errorindex")) {
    const embed = getIndexEmbed();
    try {
      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("Failed to send error index reply:", err);
    }
  }

  if (lower.includes("!ping")) {
    // Measure latency: difference between message created time and now, plus API RTT
    const sent = Date.now();
    try {
      const reply = await message.reply({ content: "Pinging..." });
      const rcv = Date.now();
      const messageLatency = rcv - message.createdTimestamp;
      const replyLatency = rcv - sent;
      const embed = new EmbedBuilder()
        .setTitle("Pong!")
        .setColor(0x57f287)
        .setDescription(`Message latency: ${messageLatency} ms\nAPI/response time: ${replyLatency} ms`)
        .setFooter({ text: `User: ${message.author.tag}` });

      await reply.edit({ content: null, embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Failed to respond to ping:", err);
    }
  }
}

module.exports = { handleMessageCommands };
