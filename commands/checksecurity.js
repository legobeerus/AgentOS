const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");

// Define restricted groups (from checkgroups.js)
const RESTRICTED_GROUPS = {
  "HOSTILE FACTIONS": [
    34810794,  // Ori
    14153848,  // RNID
    35686873   // Sodan
  ],

  "BLACKLISTED GROUPS": [
    765802690, // SGW NID
  ]
};

// Role IDs that are allowed to use this command
const ALLOWED_ROLE_IDS = [
  "1449860815086813224", // OSI HC
  "1106739929540730921", // OSI Oversight
  "1263502224181694467", // OSI CoS
  "1344664234641850441", // MATCOM Oversight
  "1193616594455253072", // MATCOM HC
  "1263502187208638534", // MATCOM CoS
  "994285075678109759" // SGC Officers
];

// User IDs that are allowed to use this command (for testing/debugging)
const ALLOWED_USER_IDS = [
  "716248402513494027" // UID for testing
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("checksecurity")
    .setDescription("(HC Restricted) Check if group members are in hostile or blacklisted factions")
    .addIntegerOption(option =>
      option
        .setName("groupid")
        .setDescription("Roblox group ID to check")
        .setRequired(true)
    ),

  async execute(interaction) {
    // User check (for testing/debugging)
    if (ALLOWED_USER_IDS.includes(interaction.user.id)) {
      // Skip all permission checks for whitelisted users
    } else {
      // Role check
      const hasRole = ALLOWED_ROLE_IDS.some(roleId =>
        interaction.member.roles.cache.has(roleId)
      );

      if (!hasRole) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          ephemeral: true
        });
      }
    }

    const groupId = interaction.options.getInteger("groupid");
    await interaction.deferReply();

    try {
      // Get group info
      const groupRes = await axios.get(
        `https://groups.roblox.com/v1/groups/${groupId}`
      );
      const groupName = groupRes.data.name;
      const groupIcon = groupRes.data.icon || "https://www.roblox.com/Thumbs/Avatar.ashx?x=150&y=150&Format=Png"; // Fallback icon

      // Get group members with pagination (max 500 members to avoid excessive API calls)
      const allMembers = [];
      let cursor = null;
      const maxMembers = 500;

      do {
        const url = cursor
          ? `https://groups.roblox.com/v1/groups/${groupId}/users?limit=100&sortOrder=Desc&cursor=${cursor}`
          : `https://groups.roblox.com/v1/groups/${groupId}/users?limit=100&sortOrder=Desc`;

        const membersRes = await axios.get(url);
        allMembers.push(...membersRes.data.data);
        cursor = membersRes.data.nextPageCursor;

        // Stop if we've reached max members or no more pages
        if (allMembers.length >= maxMembers) {
          allMembers.length = maxMembers;
          break;
        }
      } while (cursor);

      const members = allMembers;
      const checkedMemberCount = members.length;

      const suspiciousMembers = [];

      // Check each member against restricted groups
      for (const member of members) {
        const userId = member.user.userId;
        
        try {
          const userGroupsRes = await axios.get(
            `https://groups.roblox.com/v2/users/${userId}/groups/roles`
          );
          const userGroups = userGroupsRes.data.data;

          for (const [category, restrictedIds] of Object.entries(RESTRICTED_GROUPS)) {
            const foundGroup = userGroups.find(g => restrictedIds.includes(g.group.id));
            if (foundGroup) {
              suspiciousMembers.push({
                username: member.user.username,
                groupName: foundGroup.group.name,
                category: category,
                role: foundGroup.role.name
              });
              break; // Only report once per member
            }
          }
        } catch (err) {
          // Skip if we can't fetch user's groups
          continue;
        }
      }

      // Build embed report
      const embed = new EmbedBuilder()
        .setTitle(`Security Report: ${groupName}`)
        .setColor(suspiciousMembers.length > 0 ? 0xed4245 : 0x57F287)
        .setThumbnail(groupIcon)
        .setFooter({ text: `Checked ${checkedMemberCount} members (limited to first 500)` });

      if (suspiciousMembers.length === 0) {
        embed.setDescription("✅ No members found in hostile or blacklisted groups.");
      } else {
        let report = suspiciousMembers.map(m =>
          `**${m.username}**\n` +
          `└─ ${m.category}: ${m.groupName}`
        ).join("\n\n");

        // Truncate if too long
        if (report.length > 2048) {
          report = report.substring(0, 2045) + "...";
        }

        embed.addFields({
          name: `⚠️ Suspicious Members (${suspiciousMembers.length})`,
          value: report,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await interaction.editReply("⚠️ Something went wrong. Make sure the group ID is valid.");
    }
  }
};
