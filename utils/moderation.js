const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { all, run } = require("../database/db");

const ACTION_PERMISSIONS = {
  ban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  unmute: PermissionFlagsBits.ModerateMembers,
  warn: PermissionFlagsBits.ModerateMembers,
  purge: PermissionFlagsBits.ManageMessages,
  clearUser: PermissionFlagsBits.ManageMessages,
  announce: PermissionFlagsBits.ManageGuild,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
  slowmode: PermissionFlagsBits.ManageChannels,
  nick: PermissionFlagsBits.ManageNicknames,
  role: PermissionFlagsBits.ManageRoles,
  pin: PermissionFlagsBits.ManageMessages,
  voice: PermissionFlagsBits.MoveMembers,
  info: PermissionFlagsBits.ModerateMembers
};

const ACTION_LABELS = {
  ban: "Banir membros",
  kick: "Expulsar membros",
  mute: "Silenciar membros",
  unmute: "Remover silêncio",
  warn: "Aplicar avisos",
  purge: "Limpar mensagens",
  clearUser: "Limpar mensagens de usuário",
  announce: "Enviar anúncios",
  lock: "Travar canais",
  unlock: "Destravar canais",
  slowmode: "Alterar modo lento",
  nick: "Alterar apelidos",
  role: "Gerenciar cargos",
  pin: "Fixar mensagens",
  voice: "Gerenciar voz",
  info: "Consultar moderação"
};

const moderationCases = [];
const warningStore = new Map();

function splitIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value)
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getModerationRoleIds(config, action) {
  const moderation = config.moderation || {};
  const fromConfig = [
    ...splitIds(moderation.adminRoleId),
    ...splitIds(moderation.adminRoleIds),
    ...splitIds(moderation.moderatorRoleId),
    ...splitIds(moderation.moderatorRoleIds),
    ...splitIds(moderation.permissions?.[action]),
    ...splitIds(moderation.roles?.[action])
  ];

  const upperAction = String(action).replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
  const fromEnv = [
    ...splitIds(process.env.MODERATION_ADMIN_ROLE_IDS),
    ...splitIds(process.env.MODERATION_MODERATOR_ROLE_IDS),
    ...splitIds(process.env[`MODERATION_${upperAction}_ROLE_IDS`])
  ];

  return [...new Set([...fromConfig, ...fromEnv])];
}

function hasAnyRole(member, roleIds) {
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function canUseModerationAction(member, action, config) {
  if (!member?.guild) return false;
  if (member.guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (hasAnyRole(member, getModerationRoleIds(config, action))) return true;

  const permission = ACTION_PERMISSIONS[action];
  return permission ? member.permissions.has(permission) : false;
}

async function requireModerationPermission(interaction, action, config) {
  if (canUseModerationAction(interaction.member, action, config)) return true;

  await interaction.reply({
    embeds: [
      createModerationEmbed(config, {
        title: "Acesso negado",
        description: `Você não tem permissão para usar **${ACTION_LABELS[action] || action}**.`,
        color: config.colors?.danger || "#c62828",
        icon: "⛔"
      })
    ],
    ephemeral: true
  }).catch(() => null);
  return false;
}

function createCaseId(action) {
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `MOD-${String(action).toUpperCase()}-${suffix}`;
}

function addModerationCase(data) {
  const createdAt = Date.now();
  const item = {
    id: data.id || createCaseId(data.action),
    guildId: data.guildId,
    action: data.action,
    targetId: data.targetId,
    targetTag: data.targetTag,
    moderatorId: data.moderatorId,
    moderatorTag: data.moderatorTag,
    reason: data.reason || "Sem motivo informado.",
    createdAt
  };

  moderationCases.unshift(item);
  if (moderationCases.length > 500) moderationCases.length = 500;

  if (item.guildId) {
    run(
      `INSERT OR REPLACE INTO moderation_cases
        (id, guild_id, action, target_id, target_tag, moderator_id, moderator_tag, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.guildId,
        item.action,
        item.targetId || null,
        item.targetTag || null,
        item.moderatorId || null,
        item.moderatorTag || null,
        item.reason,
        item.createdAt
      ]
    );
  }

  return item;
}

function addWarning(guildId, userId, warning) {
  const createdAt = Date.now();
  run(
    `INSERT INTO moderation_warnings (guild_id, user_id, moderator_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [guildId, userId, warning.moderatorId, warning.reason || "Sem motivo informado.", createdAt]
  );

  const key = `${guildId}:${userId}`;
  const list = warningStore.get(key) || [];
  list.push({ ...warning, createdAt });
  warningStore.set(key, list);
  return getWarnings(guildId, userId);
}

function getWarnings(guildId, userId) {
  const warnings = all(
    `SELECT id, guild_id AS guildId, user_id AS userId, moderator_id AS moderatorId, reason, created_at AS createdAt
     FROM moderation_warnings
     WHERE guild_id = ? AND user_id = ?
     ORDER BY created_at ASC`,
    [guildId, userId]
  );
  return warnings.length ? warnings : (warningStore.get(`${guildId}:${userId}`) || []);
}

function clearWarnings(guildId, userId) {
  run("DELETE FROM moderation_warnings WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
  warningStore.delete(`${guildId}:${userId}`);
}

function getCasesForUser(userId, limit = 8, guildId = null) {
  if (guildId) {
    return all(
      `SELECT id, guild_id AS guildId, action, target_id AS targetId, target_tag AS targetTag,
              moderator_id AS moderatorId, moderator_tag AS moderatorTag, reason, created_at AS createdAt
       FROM moderation_cases
       WHERE guild_id = ? AND target_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [guildId, userId, limit]
    );
  }
  return moderationCases.filter((item) => item.targetId === userId).slice(0, limit);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const units = [
    ["d", 24 * 60 * 60 * 1000],
    ["h", 60 * 60 * 1000],
    ["m", 60 * 1000],
    ["s", 1000]
  ];
  const parts = [];
  let remaining = ms;
  for (const [label, size] of units) {
    const amount = Math.floor(remaining / size);
    if (amount > 0) {
      parts.push(`${amount}${label}`);
      remaining -= amount * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0s";
}

function parseDuration(input) {
  if (!input) return null;
  const source = String(input).trim().toLowerCase();
  if (/^\d+$/.test(source)) return Number(source) * 60 * 1000;

  const matches = [...source.matchAll(/(\d+)\s*(s|seg|segundos?|m|min|minutos?|h|horas?|d|dias?|w|sem|semanas?)/g)];
  if (!matches.length) return null;

  let total = 0;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith("s") && !unit.startsWith("sem")) total += amount * 1000;
    else if (unit.startsWith("m")) total += amount * 60 * 1000;
    else if (unit.startsWith("h")) total += amount * 60 * 60 * 1000;
    else if (unit.startsWith("d")) total += amount * 24 * 60 * 60 * 1000;
    else total += amount * 7 * 24 * 60 * 60 * 1000;
  }

  return total || null;
}

function normalizeColor(value, fallback = "#1e88e5") {
  if (!value) return fallback;
  const color = String(value).trim();
  return /^#?[0-9a-f]{6}$/i.test(color) ? (color.startsWith("#") ? color : `#${color}`) : fallback;
}

function createModerationEmbed(config, options = {}) {
  const embed = new EmbedBuilder()
    .setColor(normalizeColor(options.color, config.colors?.primary || "#1e88e5"))
    .setTimestamp();

  if (options.title) embed.setTitle(`${options.icon || "🛡️"} ${options.title}`);
  if (options.description) embed.setDescription(options.description);
  if (options.fields?.length) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.footer) embed.setFooter({ text: options.footer });
  else embed.setFooter({ text: `${config.botName || "BznX Store"} • Moderação` });

  return embed;
}

function userLabel(user) {
  if (!user) return "Desconhecido";
  return `${user} (${user.tag || user.id})`;
}

function validateMemberTarget(interaction, targetMember, actionLabel = "moderar") {
  if (!targetMember) return null;
  const moderator = interaction.member;
  const botMember = interaction.guild.members.me;

  if (targetMember.id === interaction.user.id) {
    return `Você não pode ${actionLabel} a si mesmo.`;
  }
  if (targetMember.id === interaction.client.user.id) {
    return `Eu não posso ${actionLabel} meu próprio usuário.`;
  }
  if (targetMember.id === interaction.guild.ownerId) {
    return `Não é possível ${actionLabel} o dono do servidor.`;
  }
  if (botMember && targetMember.roles.highest.position >= botMember.roles.highest.position) {
    return `Meu cargo precisa estar acima do cargo de ${targetMember} para ${actionLabel}.`;
  }
  if (
    moderator.id !== interaction.guild.ownerId &&
    targetMember.roles.highest.position >= moderator.roles.highest.position
  ) {
    return `Seu cargo precisa estar acima do cargo de ${targetMember} para ${actionLabel}.`;
  }
  return null;
}

async function sendModerationLog(interaction, config, embed) {
  const channelId =
    config.moderation?.logChannelId ||
    config.logChannels?.moderacao ||
    config.logChannels?.seguranca ||
    config.logChannels?.sistema;

  if (!channelId) return;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

function buildCaseFields(caseItem, extraFields = []) {
  return [
    { name: "📌 Caso", value: `\`${caseItem.id}\``, inline: true },
    { name: "👤 Usuário", value: caseItem.targetId ? `<@${caseItem.targetId}>` : "Não informado", inline: true },
    { name: "🛡️ Moderador", value: caseItem.moderatorId ? `<@${caseItem.moderatorId}>` : "Sistema", inline: true },
    { name: "📝 Motivo", value: caseItem.reason.slice(0, 1024), inline: false },
    ...extraFields
  ];
}

module.exports = {
  ACTION_LABELS,
  ACTION_PERMISSIONS,
  addModerationCase,
  addWarning,
  buildCaseFields,
  canUseModerationAction,
  clearWarnings,
  createCaseId,
  createModerationEmbed,
  formatDuration,
  getCasesForUser,
  getWarnings,
  normalizeColor,
  parseDuration,
  requireModerationPermission,
  sendModerationLog,
  userLabel,
  validateMemberTarget
};
