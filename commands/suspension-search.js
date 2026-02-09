const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const BOARD_ID = process.env.TRELLO_SUSPENSIONS_BOARD_ID || "693f1533319531ec08ae2ff4";
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

module.exports = {
	data: new SlashCommandBuilder()
		.setName("suspension-search")
		.setDescription("Search the suspensions Trello board for a username or term")
		.addStringOption(option =>
			option
				.setName("query")
				.setDescription("Username or term to search for")
				.setRequired(true)
		),

	async execute(interaction) {
		const query = (interaction.options.getString("query") || "").trim();
		if (!query) {
			await interaction.reply({ content: "Provide a search query.", ephemeral: true });
			return;
		}
		if (!TRELLO_KEY || !TRELLO_TOKEN) {
			await interaction.reply({ content: "Trello credentials are not configured.", ephemeral: true });
			return;
		}

		await interaction.deferReply({ ephemeral: true });

		try {
			const res = await axios.get(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
				params: {
					key: TRELLO_KEY,
					token: TRELLO_TOKEN,
					fields: "name,desc,url,due,labels",
				}
			});
			const cards = Array.isArray(res.data) ? res.data : [];
			const q = query.toLowerCase();
			const matches = cards.filter(c => {
				const hay = `${String(c.name || "")}\n${String(c.desc || "")}`.toLowerCase();
				return hay.includes(q);
			});

			if (!matches.length) {
				await interaction.editReply(`No results found for "${query}".`);
				return;
			}

			const MAX = 10;
			const out = matches.slice(0, MAX).map(c => {
				const due = c.due ? new Date(c.due).toISOString().split("T")[0] : "Permanent";
				const labels = Array.isArray(c.labels) ? c.labels.map(l => l.name).filter(Boolean).join(", ") : "";
				return `**${c.name}** — ${due}${labels ? ` — ${labels}` : ""}\n${c.url}`;
			});

			const more = matches.length > MAX ? `\n…and ${matches.length - MAX} more result(s)` : "";
			await interaction.editReply(`Results for "${query}":\n\n${out.join("\n\n")}${more}`);
		} catch (err) {
			console.error("suspension-search error:", err);
			await interaction.editReply("Could not search the suspensions board.");
		}
	}
};
