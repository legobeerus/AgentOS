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
			await interaction.reply({ content: "Provide a search query.", ephemeral: false });
			return;
		}
		if (!TRELLO_KEY || !TRELLO_TOKEN) {
			await interaction.reply({ content: "Trello credentials are not configured.", ephemeral: false });
			return;
		}

		await interaction.deferReply();

		try {
			const res = await axios.get(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
				params: {
					key: TRELLO_KEY,
					token: TRELLO_TOKEN,
					fields: "name,desc,url,due,labels,idList",
				}
			});
			const cards = Array.isArray(res.data) ? res.data : [];
			// fetch lists to map id -> name so we can special-case a list name
			const listsRes = await axios.get(`https://api.trello.com/1/boards/${BOARD_ID}/lists`, {
				params: { key: TRELLO_KEY, token: TRELLO_TOKEN, fields: "name" }
			});
			const lists = Array.isArray(listsRes.data) ? listsRes.data : [];
			const listNameById = {};
			for (const l of lists) {
				if (l && l.id) listNameById[l.id] = String(l.name || "");
			}
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
				const listName = c.idList ? (listNameById[c.idList] || "") : "";
				let dueText;
				if (c.due) {
					dueText = new Date(c.due).toISOString().split("T")[0];
				} else if (listName === "Arrests") {
					dueText = "Arrest Log";
				} else {
					dueText = "Permanent";
				}
				const labels = Array.isArray(c.labels) ? c.labels.map(l => l.name).filter(Boolean).join(", ") : "";
				return `**${c.name}** — ${dueText}${labels ? ` — ${labels}` : ""}\n${c.url}`;
			});

			const more = matches.length > MAX ? `\n…and ${matches.length - MAX} more result(s)` : "";
			await interaction.editReply(`Results for "${query}":\n\n${out.join("\n\n")}${more}`);
		} catch (err) {
			console.error("suspension-search error:", err);
			await interaction.editReply("Could not search the suspensions board.");
		}
	}
};
