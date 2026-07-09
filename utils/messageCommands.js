const { getIndexEmbed } = require("./errorCodes");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonStyle } = require("discord.js");
const config = require("../config");
const agentosStore = require('./agentosStore');
const { getChangelog, setChangelog } = require("./changelogStore");
const { getState, setState } = require("./adminState");
const verificationStore = require('./verificationStore');
const fs = require('fs');
const path = require('path');

function parseQuotedArgs(input) {
  const text = String(input || '');
  const out = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1] || m[2] || m[3]);
  }
  return out;
}

function normalizeHeader(value) {
  return String(value || '').trim();
}

function isLikelyMetaColumn(header) {
  const h = String(header || '').trim().toLowerCase();
  if (!h) return true;
  return [
    'timestamp',
    'email address',
    'score',
    'name',
    'discord',
    'discord username',
    'discord user id',
    'discord id',
    'user id'
  ].includes(h);
}

async function fetchSheetRows({ sheetId, range, auth }) {
  if (!sheetId) throw new Error('Missing sheetId');
  if (!range) throw new Error('Missing range');
  const googleapis = require('googleapis');
  const { google } = googleapis;

  const mode = String(auth?.mode || '').toLowerCase();
  const apiKey = auth?.apiKey;
  const serviceAccount = auth?.serviceAccount;

  if (mode === 'apikey') {
    if (!apiKey) throw new Error('Missing API key for auth mode apikey');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
    const axios = require('axios');
    const res = await axios.get(url);
    return (res && res.data && res.data.values) || [];
  }

  if (mode !== 'servicejson') {
    throw new Error('Unsupported auth mode. Use apikey or servicejson.');
  }

  const keyObj = serviceAccount;
  if (!keyObj || !keyObj.client_email || !keyObj.private_key) {
    throw new Error('Invalid service account JSON. Missing client_email/private_key.');
  }

  const jwt = new google.auth.JWT({
    email: keyObj.client_email,
    key: keyObj.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  await jwt.authorize();

  const sheets = google.sheets({ version: 'v4', auth: jwt });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return (res && res.data && res.data.values) || [];
}

function parseServiceAccountInput(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('Service account JSON input is empty');

  try { return JSON.parse(s); } catch (e) {}
  try { return JSON.parse(s.replace(/\\n/g, '\n')); } catch (e) {}
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (e) {}

  throw new Error('Could not parse service account JSON input');
}

async function promptUserInput(message, promptText, timeoutMs = 120000) {
  await message.reply(promptText);
  const collected = await message.channel.awaitMessages({
    filter: (m) => m.author.id === message.author.id,
    max: 1,
    time: timeoutMs,
    errors: ['time']
  });
  const ans = collected.first();
  return ans ? String(ans.content || '').trim() : '';
}

const pendingExamImports = new Map();
const EXAM_IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;

function makeExamImportKey(userId, examId) {
  return `${String(userId)}:${String(examId).toLowerCase()}`;
}

function saveExamImportPreview({ userId, examId, examPath, questionTexts, range, sheetId }) {
  const key = makeExamImportKey(userId, examId);
  pendingExamImports.set(key, {
    userId: String(userId),
    examId: String(examId),
    examPath,
    questionTexts,
    range,
    sheetId,
    createdAt: Date.now()
  });
}

function getExamImportPreview({ userId, examId }) {
  const key = makeExamImportKey(userId, examId);
  const item = pendingExamImports.get(key);
  if (!item) return null;
  if ((Date.now() - (item.createdAt || 0)) > EXAM_IMPORT_PREVIEW_TTL_MS) {
    pendingExamImports.delete(key);
    return null;
  }
  return item;
}

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
        { name: '!agentoslog', auth: adminLabel },
        { name: '!roleId', auth: adminLabel },
        { name: '!verifylist', auth: adminLabel },
        { name: '!examimport', auth: adminLabel }
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
          // exact numeric id
          const idExact = t.match(/^(\d{5,20})$/);
          if (idExact) { excludeRoleIds.add(idExact[1]); continue; }

          // mention formats like <@&12345> or plain numbers embedded
          const mentionMatch = t.match(/<@&?(\d{5,20})>|(\d{5,20})/);
          const id = mentionMatch ? (mentionMatch[1] || mentionMatch[2]) : null;
          if (id) {
            excludeRoleIds.add(id);
            continue;
          }

          // try to resolve by name in this guild (case-insensitive)
          if (message.guild) {
            // prefer exact name match in cache
            const nameLower = t.toLowerCase();
            let roleByName = message.guild.roles.cache.find(r => r.name && r.name.toLowerCase() === nameLower);
            if (!roleByName) {
              // try partial match or display name fallback
              roleByName = message.guild.roles.cache.find(r => r.name && r.name.toLowerCase().includes(nameLower));
            }
            if (roleByName) { excludeRoleIds.add(roleByName.id); continue; }

            // As a last resort, attempt to fetch role by id if t contains digits
            const maybeId = (t.match(/(\d{5,20})/)||[])[1];
            if (maybeId) {
              try {
                const fetched = await message.guild.roles.fetch(maybeId).catch(() => null);
                if (fetched) { excludeRoleIds.add(fetched.id); continue; }
              } catch (e) {}
            }
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
          // Ensure we have an up-to-date member object (avoid stale cache)
          let freshMember = member;
          try { freshMember = await message.guild.members.fetch(member.id); } catch (e) { /* fallback to cached member */ }
          if (freshMember.roles && freshMember.roles.cache && freshMember.roles.cache.some(r => excludeRoleIds.has(r.id))) continue;
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

  if (lower.includes('!examimport')) {
    const authorId = message.author.id;
    const whitelist = config.ADMIN_WHITELIST || [];
    if (!whitelist.includes(authorId)) {
      try { await message.reply({ content: 'You are not authorized to use this command.' }); } catch (e) {}
      return;
    }

    try {
      const cmdMatch = message.content.match(/!examimport\b/i);
      const after = cmdMatch ? message.content.slice(cmdMatch.index + cmdMatch[0].length).trim() : '';
      const args = parseQuotedArgs(after);

      const first = (args[0] || '').toLowerCase();
      const explicitAction = ['preview', 'apply', 'import'].includes(first);
      const action = explicitAction ? first : 'preview';
      const baseIndex = explicitAction ? 1 : 0;

      const examId = args[baseIndex];

      if (!examId) {
        await message.reply('Usage: @Bot !examimport preview <examId> [sheetId] ["Sheet Range"] | @Bot !examimport apply <examId> | @Bot !examimport import <examId> [sheetId] ["Sheet Range"]');
        return;
      }

      const examPath = path.join(__dirname, '..', 'data', 'exams', `${examId}.json`);
      if (!fs.existsSync(examPath)) {
        await message.reply(`Exam file not found for id "${examId}".`);
        return;
      }

      if (action === 'apply') {
        const pending = getExamImportPreview({ userId: message.author.id, examId });
        if (!pending) {
          await message.reply(`No active preview found for ${examId}. Run: @Bot !examimport preview ${examId}`);
          return;
        }

        const raw = fs.readFileSync(examPath, 'utf8');
        const exam = JSON.parse(raw);
        const oldQuestions = Array.isArray(exam.questions) ? exam.questions : [];

        exam.questions = pending.questionTexts.map((text, idx) => {
          const prev = oldQuestions[idx] || {};
          const next = {
            text,
            type: prev.type || 'text',
            maxScore: Number.isFinite(Number(prev.maxScore)) ? Number(prev.maxScore) : 1
          };
          if (Array.isArray(prev.choices) && prev.choices.length) next.choices = prev.choices;
          if (prev.correctAnswer !== undefined) next.correctAnswer = prev.correctAnswer;
          return next;
        });

        fs.writeFileSync(examPath, `${JSON.stringify(exam, null, 2)}\n`, 'utf8');
        pendingExamImports.delete(makeExamImportKey(message.author.id, examId));
        await message.reply(`Applied preview and updated ${examId}.json with ${exam.questions.length} question(s).`);
        return;
      }

      // Interactive flow for preview/import: ask for every required input.
      const sheetId = await promptUserInput(
        message,
        'Step 1/4: Send the Google Sheet ID (from the spreadsheet URL).',
        120000
      );
      if (!sheetId) {
        await message.reply('Import cancelled: missing sheet ID.');
        return;
      }

      const range = await promptUserInput(
        message,
        'Step 2/4: Send the sheet range (example: Form Responses 1!A1:ZZ1).',
        120000
      );
      if (!range) {
        await message.reply('Import cancelled: missing range.');
        return;
      }

      const authModeInput = await promptUserInput(
        message,
        'Step 3/4: Choose auth mode by sending exactly one word: apikey or servicejson',
        120000
      );
      const authMode = String(authModeInput || '').toLowerCase();
      if (!['apikey', 'servicejson'].includes(authMode)) {
        await message.reply('Import cancelled: auth mode must be apikey or servicejson.');
        return;
      }

      const authSecret = await promptUserInput(
        message,
        authMode === 'apikey'
          ? 'Step 4/4: Send your Google Sheets API key.'
          : 'Step 4/4: Send your service account JSON (raw JSON string or base64-encoded JSON).',
        180000
      );
      if (!authSecret) {
        await message.reply('Import cancelled: missing auth credential.');
        return;
      }

      const auth = authMode === 'apikey'
        ? { mode: 'apikey', apiKey: authSecret }
        : { mode: 'servicejson', serviceAccount: parseServiceAccountInput(authSecret) };

      const rows = await fetchSheetRows({ sheetId, range, auth });
      if (!rows.length || !Array.isArray(rows[0])) {
        await message.reply('No header row found in the provided sheet range.');
        return;
      }

      const header = rows[0].map(normalizeHeader).filter(Boolean);
      const questionTexts = header.filter(h => !isLikelyMetaColumn(h));
      if (!questionTexts.length) {
        await message.reply('No question-like columns found in the header row.');
        return;
      }

      if (action === 'preview') {
        saveExamImportPreview({
          userId: message.author.id,
          examId,
          examPath,
          questionTexts,
          range,
          sheetId
        });

        const maxShow = 12;
        const listed = questionTexts.slice(0, maxShow).map((q, i) => `${i + 1}. ${q}`).join('\n');
        const more = questionTexts.length > maxShow ? `\n...and ${questionTexts.length - maxShow} more` : '';
        await message.reply(
          `Preview for ${examId}: found ${questionTexts.length} question(s) from ${range}.\n${listed}${more}\n\nIf this looks right, run: @Bot !examimport apply ${examId}`
        );
        return;
      }

      // action === 'import' (one-shot)
      const raw = fs.readFileSync(examPath, 'utf8');
      const exam = JSON.parse(raw);
      const oldQuestions = Array.isArray(exam.questions) ? exam.questions : [];

      exam.questions = questionTexts.map((text, idx) => {
        const prev = oldQuestions[idx] || {};
        const next = {
          text,
          type: prev.type || 'text',
          maxScore: Number.isFinite(Number(prev.maxScore)) ? Number(prev.maxScore) : 1
        };
        if (Array.isArray(prev.choices) && prev.choices.length) next.choices = prev.choices;
        if (prev.correctAnswer !== undefined) next.correctAnswer = prev.correctAnswer;
        return next;
      });

      fs.writeFileSync(examPath, `${JSON.stringify(exam, null, 2)}\n`, 'utf8');
      await message.reply(`Updated ${examId}.json with ${exam.questions.length} question(s) from sheet header range ${range}.`);
    } catch (err) {
      console.error('Failed to handle !examimport:', err);
      try { await message.reply(`Failed to import exam questions: ${err.message || err}`); } catch (e) {}
    }
  }

  
}

module.exports = { handleMessageCommands };
