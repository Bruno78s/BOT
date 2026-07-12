const { PermissionFlagsBits } = require("discord.js");
const {
  addModerationCase,
  createModerationEmbed,
  formatDuration,
  sendModerationLog
} = require("./moderation");

const userMessageBuckets = new Map();

const DEFAULT_SETTINGS = {
  enabled: true,
  antiLinks: true,
  antiSpam: true,
  antiCaps: true,
  badWords: [],
  ignoredChannelIds: [],
  ignoredRoleIds: [],
  ignoreStaff: false,
  linkWhitelist: ["bznx-store.duckdns.org"],
  spamWindowMs: 8000,
  spamMaxMessages: 6,
  capsMinLength: 18,
  capsPercent: 0.75,
  deleteMessage: true,
  strikePunishments: [
    { strikes: 2, action: "mute", durationMs: 10 * 60 * 1000 },
    { strikes: 3, action: "mute", durationMs: 60 * 60 * 1000 },
    { strikes: 5, action: "kick" },
    { strikes: 7, action: "ban" }
  ]
};

function splitList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
}

function getAutomodSettings(config) {
  const source = config.automod || {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: process.env.AUTOMOD_ENABLED ? process.env.AUTOMOD_ENABLED === "true" : source.enabled ?? DEFAULT_SETTINGS.enabled,
    antiLinks: process.env.AUTOMOD_ANTI_LINKS ? process.env.AUTOMOD_ANTI_LINKS === "true" : source.antiLinks ?? DEFAULT_SETTINGS.antiLinks,
    antiSpam: process.env.AUTOMOD_ANTI_SPAM ? process.env.AUTOMOD_ANTI_SPAM === "true" : source.antiSpam ?? DEFAULT_SETTINGS.antiSpam,
    antiCaps: process.env.AUTOMOD_ANTI_CAPS ? process.env.AUTOMOD_ANTI_CAPS === "true" : source.antiCaps ?? DEFAULT_SETTINGS.antiCaps,
    ignoreStaff: process.env.AUTOMOD_IGNORE_STAFF ? process.env.AUTOMOD_IGNORE_STAFF === "true" : source.ignoreStaff ?? DEFAULT_SETTINGS.ignoreStaff,
    badWords: splitList(process.env.AUTOMOD_BAD_WORDS || source.badWords),
    ignoredChannelIds: splitList(source.ignoredChannelIds),
    ignoredRoleIds: splitList(source.ignoredRoleIds),
    linkWhitelist: splitList(process.env.AUTOMOD_LINK_WHITELIST || source.linkWhitelist || DEFAULT_SETTINGS.linkWhitelist)
  };
}

function isIgnored(message, settings) {
  if (!settings.enabled) return true;
  if (!message.guild || message.author.bot) return true;
  if (settings.ignoreStaff && message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (settings.ignoredChannelIds.includes(message.channel.id)) return true;
  return settings.ignoredRoleIds.some((roleId) => message.member?.roles.cache.has(roleId));
}

function normalizeHost(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .replace(/:\d+$/, "");
}

function extractLinks(content) {
  const matches = String(content || "").match(
    /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/[a-z0-9-]+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<]*)?)/gi
  ) || [];

  return matches
    .map((item) => item.replace(/[)\].,!?;:]+$/g, ""))
    .filter((item) => {
      const host = normalizeHost(item);
      return host.includes(".") || host === "discord.gg";
    });
}

function isWhitelistedLink(url, settings) {
  const host = normalizeHost(url);
  return settings.linkWhitelist.some((allowed) => {
    const allowedHost = normalizeHost(allowed);
    return host === allowedHost || host.endsWith(`.${allowedHost}`);
  });
}

function containsBlockedLink(content, settings) {
  const urls = extractLinks(content);
  if (!urls.length) return false;
  return urls.some((url) => !isWhitelistedLink(url, settings));
}

function isCapsFlood(content, settings) {
  const letters = content.replace(/[^a-zA-ZÀ-ÿ]/g, "");
  if (letters.length < settings.capsMinLength) return false;
  const uppercase = letters.replace(/[^A-ZÀ-Ý]/g, "");
  return uppercase.length / letters.length >= settings.capsPercent;
}

function containsBadWord(content, settings) {
  const normalized = content.toLowerCase();
  return settings.badWords.some((word) => {
    const escaped = String(word).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(normalized);
  });
}

function isSpam(message, settings) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const bucket = (userMessageBuckets.get(key) || []).filter((timestamp) => now - timestamp <= settings.spamWindowMs);
  bucket.push(now);
  userMessageBuckets.set(key, bucket);
  return bucket.length > settings.spamMaxMessages;
}

function getViolation(message, settings) {
  if (settings.antiLinks && containsBlockedLink(message.content, settings)) {
    return { type: "anti-link", reason: "Envio de link não permitido." };
  }
  if (settings.badWords.length && containsBadWord(message.content, settings)) {
    return { type: "palavra-bloqueada", reason: "Uso de termo bloqueado pelo automod." };
  }
  if (settings.antiCaps && isCapsFlood(message.content, settings)) {
    return { type: "caps-lock", reason: "Excesso de letras maiúsculas." };
  }
  if (settings.antiSpam && isSpam(message, settings)) {
    return { type: "spam", reason: "Muitas mensagens em pouco tempo." };
  }
  return null;
}

async function countActiveStrikes(guildId, userId) {
  const { get } = require("../database/db");
  const row = get(
    "SELECT COUNT(*) as total FROM moderation_strikes WHERE guild_id = ? AND user_id = ? AND active = 1",
    [guildId, userId]
  );
  return Number(row?.total || 0);
}

async function addStrike(message, violation) {
  const { run } = require("../database/db");
  run(
    `INSERT INTO moderation_strikes (guild_id, user_id, moderator_id, reason, source, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [message.guild.id, message.author.id, message.client.user.id, violation.reason, violation.type, Date.now()]
  );
  return countActiveStrikes(message.guild.id, message.author.id);
}

async function applyStrikePunishment(message, config, settings, strikes, violation) {
  const punishment = [...settings.strikePunishments]
    .sort((a, b) => Number(b.strikes) - Number(a.strikes))
    .find((item) => strikes >= Number(item.strikes));

  if (!punishment) return null;
  const member = message.member;
  if (!member) return null;

  const reason = `Automod: ${violation.reason} (${strikes} strike(s))`;
  if (punishment.action === "mute" && member.moderatable) {
    await member.timeout(Number(punishment.durationMs || 10 * 60 * 1000), reason).catch(() => null);
    return `Mute automático por ${formatDuration(Number(punishment.durationMs || 0))}.`;
  }
  if (punishment.action === "kick" && member.kickable) {
    await member.kick(reason).catch(() => null);
    return "Kick automático aplicado.";
  }
  if (punishment.action === "ban" && member.bannable) {
    await member.ban({ reason, deleteMessageSeconds: 60 * 60 }).catch(() => null);
    return "Ban automático aplicado.";
  }
  return null;
}

async function handleAutomodMessage(message, config) {
  const settings = getAutomodSettings(config);
  if (isIgnored(message, settings)) return false;

  const violation = getViolation(message, settings);
  if (!violation) return false;

  if (settings.deleteMessage) {
    await message.delete().catch(() => null);
  }

  const strikes = await addStrike(message, violation);
  const punishment = await applyStrikePunishment(message, config, settings, strikes, violation);

  const caseItem = addModerationCase({
    guildId: message.guild.id,
    action: `automod:${violation.type}`,
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderatorId: message.client.user.id,
    moderatorTag: message.client.user.tag,
    reason: violation.reason
  });

  const embed = createModerationEmbed(config, {
    title: "Automod acionado",
    description: `${message.author} recebeu um strike automático.`,
    color: config.colors?.warning,
    icon: "🛡️",
    fields: [
      { name: "📌 Caso", value: `\`${caseItem.id}\``, inline: true },
      { name: "⚠️ Infração", value: violation.reason, inline: true },
      { name: "📊 Strikes ativos", value: `${strikes}`, inline: true },
      { name: "📍 Canal", value: `${message.channel}`, inline: true },
      { name: "🧾 Conteúdo", value: String(message.content || "Sem texto").slice(0, 900), inline: false },
      { name: "🚨 Punição", value: punishment || "Apenas registro/strike.", inline: false }
    ]
  });

  await sendModerationLog({ client: message.client }, config, embed);
  await message.channel.send({
    content: `${message.author}`,
    embeds: [createModerationEmbed(config, {
      title: "Mensagem bloqueada",
      description: `${violation.reason}\nStrikes ativos: **${strikes}**.`,
      color: config.colors?.warning,
      icon: "⚠️"
    })]
  }).then((sent) => setTimeout(() => sent.delete().catch(() => null), 8000)).catch(() => null);

  return true;
}

module.exports = {
  getAutomodSettings,
  handleAutomodMessage
};
