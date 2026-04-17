const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
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
			const e = new EmbedBuilder().setTitle('Suspension Search').setColor(0xed4245).setDescription('Provide a search query.');
			await interaction.reply({ embeds: [e], ephemeral: false });
			return;
		}
		if (!TRELLO_KEY || !TRELLO_TOKEN) {
			const e = new EmbedBuilder().setTitle('Suspension Search').setColor(0xed4245).setDescription('Trello credentials are not configured.');
			await interaction.reply({ embeds: [e], ephemeral: false });
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
				const no = new EmbedBuilder().setTitle('No Results').setColor(0xedd400).setDescription(`No results found for "${query}".`);
				await interaction.editReply({ embeds: [no] });
				return;
			}

			const MAX = 10;
			const embed = new EmbedBuilder().setTitle(`Results for "${query}"`).setColor(0x00aff1).setTimestamp(new Date());
			const slice = matches.slice(0, MAX);
			for (const c of slice) {
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
				const value = `${dueText}${labels ? ` — ${labels}` : ""}\n${c.url}`;
				embed.addFields({ name: String(c.name).slice(0, 256) || '(untitled)', value: value.slice(0, 1024) });
			}
			if (matches.length > MAX) embed.setFooter({ text: `+${matches.length - MAX} more result(s)` });
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			console.error("suspension-search error:", err);
			const e = new EmbedBuilder().setTitle('Search Error').setColor(0xed4245).setDescription('Could not search the suspensions board.');
			await interaction.editReply({ embeds: [e] });
		}
	}
};
