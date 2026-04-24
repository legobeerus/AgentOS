const { getIndexEmbed } = require("./errorCodes");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonStyle } = require("discord.js");
const config = require("../config");
const agentosStore = require('./agentosStore');
const { getChangelog, setChangelog } = require("./changelogStore");
const { getState, setState } = require("./adminState");
const verificationStore = require('./verificationStore');
const axios = require('axios');
const arrestStore = require('./arrestStore');

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

  if (lower.includes("!roleid")) {
    try {
      if (!message.guild) return; // must be in a server to resolve roles
      const idx = lower.indexOf("!roleid");
      const after = message.content.slice(idx + "!roleid".length).trim();
      const m = String(after).match(/(\d{16,20})/);
      const roleId = m ? m[1] : null;
      if (!roleId) {
        await message.reply('Usage: `@Bot !roleID <roleId or role mention>` — provide a numeric role ID or mention.');
        return;
      }

      let role = message.guild.roles.cache.get(roleId);
      if (!role) {
        try { role = await message.guild.roles.fetch(roleId); } catch (e) { role = null; }
      }
      if (!role) {
        await message.reply(`Role not found for ID ${roleId}.`);
        return;
      }

      await message.reply({ content: `<@&${roleId}>`, allowedMentions: { roles: [roleId] } });
    } catch (err) {
      console.error('Failed to handle !roleid message command:', err);
      try { await message.reply('An error occurred while resolving that role.'); } catch (e) {}
    }
  }

  if (lower.includes("!help")) {
    try {
      const adminWhitelist = config.ADMIN_WHITELIST || [];
      const adminLabel = adminWhitelist.length > 0 ? 'Admin (whitelist)' : 'Admin';
      const commands = [
        { name: '!ping', auth: 'Public' },
        { name: '!help', auth: 'Public' },
        { name: '!changelog', auth: 'Public' },
        { name: '!errorindex', auth: 'Public' },
        { name: '!admin', auth: adminLabel },
        { name: '!agentoslog', auth: adminLabel }
      ];

      const embed = new EmbedBuilder()
        .setTitle('Help — Ping Commands')
        .setColor(config.EMBED_COLOR || 0x00aff1)
        .setFooter({ text: `User: ${message.author.tag}` });

      for (const c of commands) {
        embed.addFields({ name: c.name, value: `Authorization: ${c.auth}`, inline: false });
      }

      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to send help reply:', err);
    }
  }

  if (lower.includes("!admin")) {
    const authorId = message.author.id;
    const whitelist = config.ADMIN_WHITELIST || [];
    if (!whitelist.includes(authorId)) {
      try {
        await message.reply({ content: "You are not authorized to use this command." });
      } catch (e) {}
      return;
    }

    const state = await getState();
    const embed = new EmbedBuilder()
      .setTitle("Admin Menu")
      .setColor(config.EMBED_COLOR)
      .setDescription(`Paused Applications: ${state.pausedApplications}\nDebug Mode: ${state.debugMode}`)
      .setFooter({ text: `User: ${message.author.tag}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin_toggle_pause').setStyle(ButtonStyle.Secondary).setLabel('Toggle Pause'),
      new ButtonBuilder().setCustomId('admin_toggle_debug').setStyle(ButtonStyle.Secondary).setLabel('Toggle Debug'),
      new ButtonBuilder().setCustomId('admin_show_changelog').setStyle(ButtonStyle.Primary).setLabel('Show Changelog'),
      new ButtonBuilder().setCustomId('admin_edit_changelog').setStyle(ButtonStyle.Primary).setLabel('Edit Changelog')
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin_manage_commands').setStyle(ButtonStyle.Primary).setLabel('Manage Commands')
    );

    try {
      await message.reply({ embeds: [embed], components: [row, row2] });
    } catch (e) {
      console.error('Failed to send admin menu:', e);
    }
  }

  if (lower.includes("!changelog")) {
    const cl = await getChangelog();
    const embed = new EmbedBuilder()
      .setTitle(`Changelog ${cl.version || ''}`)
        .setColor(config.EMBED_COLOR)
      .addFields(
        { name: 'Additions', value: cl.additions || 'None', inline: false },
        { name: 'Notes', value: cl.notes || 'None', inline: false }
      )
      .setFooter({ text: `Updated: ${cl.updatedAt || 'never'}` });
    try {
      await message.reply({ embeds: [embed] });
    } catch (e) { console.error('Failed to send changelog:', e); }
  }

  if (lower.includes("!agentoslog")) {
    const authorId = message.author.id;
    const whitelist = config.ADMIN_WHITELIST || [];
    if (!whitelist.includes(authorId)) {
      try { await message.reply({ content: 'You are not authorized to use this command.' }); } catch (e) {}
      return;
    }
    try {
      const entries = await agentosStore.listEntries(10);
      const embed = new EmbedBuilder().setTitle('AgentOS — Recent Commands').setColor(config.EMBED_COLOR || 0x00aff1).setTimestamp(new Date());
      if (!entries || entries.length === 0) {
        embed.setDescription('No recent AgentOS commands found.');
      } else {
        for (const e of entries) {
          const time = e.createdAt ? new Date(e.createdAt).toLocaleString() : 'unknown';
          const who = e.userTag || e.userId || 'unknown';
          const name = `${e.command} — ${who} — ${time}`;
          let params = e.params || '(no params)';
          if (params.length > 1020) params = params.slice(0, 1017) + '...';
          embed.addFields({ name, value: params, inline: false });
        }
      }
      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to fetch AgentOS entries:', err);
      try { await message.reply({ content: 'Failed to fetch AgentOS entries.' }); } catch (e) {}
    }
  }

  if (lower.includes("!verifylist")) {
    try {
      if (!message.guild) return;
      // Load verified discord IDs from the DB (may be empty if DB not configured)
      const verifiedIds = new Set((await verificationStore.listAllDiscordIds().catch(() => [])) || []);
      // Role tokens configured to be excluded from verifylist (IDs, mentions, or names)
      const excludeTokens = Array.isArray(config.VERIFYLIST_EXCLUDE_ROLE_IDS_LIST) ? config.VERIFYLIST_EXCLUDE_ROLE_IDS_LIST : (config.VERIFYLIST_EXCLUDE_ROLE_IDS_LIST ? [config.VERIFYLIST_EXCLUDE_ROLE_IDS_LIST] : []);
      const excludeRoleIds = new Set();
      try {
        for (const tok of excludeTokens) {
          if (!tok) continue;
          const t = String(tok).trim();
          // direct numeric id
          const idMatch = t.match(/^(\d{5,20})$/);
          if (idMatch) { excludeRoleIds.add(idMatch[1]); continue; }
          // mention-like content
          const mentionMatch = t.match(/(\d{5,20})/);
          if (mentionMatch) { excludeRoleIds.add(mentionMatch[1]); continue; }
          // try to resolve by name in this guild (case-insensitive)
          if (message.guild) {
            const roleByName = message.guild.roles.cache.find(r => r.name && r.name.toLowerCase() === t.toLowerCase());
            if (roleByName) { excludeRoleIds.add(roleByName.id); continue; }
          }
        }
      } catch (e) { /* ignore resolution errors */ }
      // Check admin state early so we can avoid building mention syntax when needed
      let state = { debugMode: false };
      try { state = await getState(); } catch (e) { /* ignore */ }
      const disablePings = !!(state && state.debugMode);

      const members = await message.guild.members.fetch();
      const unverified = [];
      for (const [id, member] of members) {
        if (!member || member.user.bot) continue;
        // Skip members who have any excluded role
        try {
          if (member.roles && member.roles.cache && member.roles.cache.some(r => excludeRoleIds.has(r.id))) continue;
        } catch (e) {}
        if (!verifiedIds.has(id)) {
          if (disablePings) unverified.push(`${member.user.tag} (${id})`);
          else unverified.push(`${member.user.tag} (<@${id}>)`);
        }
      }

      if (unverified.length === 0) {
        await message.reply('All server members appear to be verified.');
        return;
      }

      const max = 50;
      const shown = unverified.slice(0, max).join('\n');
      const more = unverified.length > max ? `\n…and ${unverified.length - max} more` : '';
      const content = `Unverified members (${unverified.length}):\n${shown}${more}`;
      // Respect admin debug mode or explicit config: if pings are disabled, also set allowedMentions
      const allowedMentions = disablePings ? { parse: [] } : undefined;
      await message.reply({ content, allowedMentions });
    } catch (err) {
      console.error('Failed to handle !verifylist:', err);
      try { await message.reply({ content: 'Failed to generate verify list.' }); } catch (e) {}
    }
  }

  if (lower.includes("!trelloimport")) {
    const authorId = message.author.id;
    const whitelist = config.ADMIN_WHITELIST || [];
    if (!whitelist.includes(authorId)) {
      try { await message.reply({ content: 'You are not authorized to use this command.' }); } catch (e) {}
      return;
    }

    // Trello config
    const TRELLO_KEY = process.env.TRELLO_KEY;
    const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
    const BOARD_ID = process.env.TRELLO_SUSPENSIONS_BOARD_ID || config.TRELLO_SUSPENSIONS_BOARD_ID;
    const ARREST_LIST_ID = process.env.TRELLO_SUSPENSIONS_ARREST_LIST_ID;
    const ARREST_LIST_NAME = process.env.TRELLO_SUSPENSIONS_ARREST_LIST_NAME || 'Arrest';

    const missing = [];
    if (!TRELLO_KEY) missing.push('TRELLO_KEY');
    if (!TRELLO_TOKEN) missing.push('TRELLO_TOKEN');
    if (!BOARD_ID) missing.push('TRELLO_SUSPENSIONS_BOARD_ID');
    if (missing.length > 0) {
      try { await message.reply(`Trello import cannot run — missing env: ${missing.join(', ')}`); } catch (e) {}
      return;
    }

    try {
      // Resolve list id if not provided
      let listId = ARREST_LIST_ID || null;
      if (!listId) {
        const listsRes = await axios.get(`https://api.trello.com/1/boards/${BOARD_ID}/lists`, { params: { key: TRELLO_KEY, token: TRELLO_TOKEN, fields: 'name' } });
        const lists = Array.isArray(listsRes.data) ? listsRes.data : [];
        const found = lists.find(l => String(l.name || '').toLowerCase() === String(ARREST_LIST_NAME).toLowerCase() || String(l.name || '').toLowerCase() === `${String(ARREST_LIST_NAME).toLowerCase()}s`);
        if (found) listId = found.id;
      }

      if (!listId) {
        await message.reply('Could not determine the arrest list ID on the Trello board. Set `TRELLO_SUSPENSIONS_ARREST_LIST_ID` or ensure a list named "Arrest" exists.');
        return;
      }

      // Fetch closed (archived) cards on the board, then filter to those from the arrest list
      const cardsRes = await axios.get(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, { params: { key: TRELLO_KEY, token: TRELLO_TOKEN, filter: 'closed', fields: 'name,desc,idList' } });
      const cards = Array.isArray(cardsRes.data) ? cardsRes.data : [];
      const targetCards = cards.filter(c => String(c.idList) === String(listId));

      if (!targetCards || targetCards.length === 0) {
        await message.reply('No archived arrest cards found to import.');
        return;
      }

      // Robust parsing helper: find labeled sections anywhere in the text
      function parseDesc(desc, title) {
        const descText = String(desc || '').replace(/\r/g, '');
        const titleText = title ? String(title || '') : '';
        const text = (titleText ? titleText + '\n' : '') + descText;
        // Find labeled headings like "Suspect:", "Incident Summary:", "Charges:", "Sentence:", "Proof:"
        const labelRegex = /(Suspect|Incident Summary|Charges|Charge\(s\)|Sentence|Proof)\s*:/gi;
        const matches = [];
        let m;
        while ((m = labelRegex.exec(text)) !== null) {
          matches.push({ label: m[1], index: m.index, end: m.index + m[0].length });
        }

        if (matches.length === 0) {
          // No labeled sections — fallback: try to use title as suspect and whole desc as summary
          if (titleText && titleText.trim()) {
            return { suspect: titleText.trim(), summary: descText.trim(), charges: '', sentence: '', proof: '' };
          }
          return null;
        }

        const out = { suspect: '', summary: '', charges: '', sentence: '', proof: '' };
        for (let i = 0; i < matches.length; i++) {
          const cur = matches[i];
          const nextIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
          const value = text.slice(cur.end, nextIndex).trim();
          const key = String(cur.label || '').toLowerCase();
          if (key.includes('suspect')) out.suspect = value;
          else if (key.includes('incident')) out.summary = value;
          else if (key.includes('charg')) out.charges = value;
          else if (key.includes('sentence')) out.sentence = value;
          else if (key.includes('proof')) out.proof = value;
        }

        // If suspect missing, use the card title
        if (!out.suspect && title && String(title).trim()) out.suspect = String(title).trim();

        // Consider it a valid parse if we have at least a suspect and one of summary/charges
        if (!out.suspect) return null;
        if (!out.summary && !out.charges) return null;
        return out;
      }

      const results = { imported: 0, skipped: 0, errors: 0 };
      for (const card of targetCards) {
        try {
          const parsed = parseDesc(card.desc || '', card.name || '');
          if (!parsed) { results.skipped++; continue; }

          await arrestStore.createArrest({
            roblox_username: parsed.suspect,
            incident_summary: parsed.summary,
            charges: parsed.charges,
            sentence: parsed.sentence,
            proof: parsed.proof,
            submitted_by: message.author.id,
            submitted_by_tag: message.author.tag
          });
          results.imported++;
        } catch (e) {
          console.error('Failed to import Trello card:', e);
          results.errors++;
        }
      }

      await message.reply(`Trello import complete — imported: ${results.imported}, skipped: ${results.skipped}, errors: ${results.errors}`);
    } catch (err) {
      console.error('Trello import failed:', err);
      try { await message.reply('Trello import failed — check bot logs.'); } catch (e) {}
    }
  }
}

module.exports = { handleMessageCommands };
