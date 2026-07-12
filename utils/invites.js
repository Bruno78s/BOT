const { EmbedBuilder } = require("discord.js");
const { get, run, all } = require("../database/db");

const inviteCache = new Map();
const DEFAULT_FAKE_ACCOUNT_AGE_DAYS = 7;
const DEFAULT_VALID_AFTER_MINUTES = 5;
const DEFAULT_SUSPICIOUS_LOG_CHANNEL_ID = "1520846532591747172";

function getInviteLogChannelId(config) {
  return config.inviteChannelId || config.invitesChannelId || config.logChannels?.invites || "1505706829022498846";
}

function getSuspiciousInviteLogChannelId(config) {
  return (
    process.env.INVITE_SUSPICIOUS_LOG_CHANNEL_ID ||
    config.invites?.suspiciousLogChannelId ||
    config.logChannels?.inviteSuspeitos ||
    config.logChannels?.seguranca ||
    DEFAULT_SUSPICIOUS_LOG_CHANNEL_ID
  );
}

function getFakeAccountAgeMs(config) {
  const days = Number(process.env.INVITE_MIN_ACCOUNT_AGE_DAYS || config.invites?.minAccountAgeDays || DEFAULT_FAKE_ACCOUNT_AGE_DAYS);
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function getInviteValidationMs(config) {
  const minutes = Number(process.env.INVITE_VALID_AFTER_MINUTES || config.invites?.validAfterMinutes || DEFAULT_VALID_AFTER_MINUTES);
  return Math.max(0, minutes) * 60 * 1000;
}

function getGuildCache(guildId) {
  if (!inviteCache.has(guildId)) inviteCache.set(guildId, new Map());
  return inviteCache.get(guildId);
}

function formatAccountAge(user) {
  const totalHours = Math.max(0, Math.floor((Date.now() - user.createdTimestamp) / (60 * 60 * 1000)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days <= 0) return `${hours || 1} hora(s)`;
  return hours ? `${days} dia(s) e ${hours} hora(s)` : `${days} dia(s)`;
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

async function cacheGuildInvites(guild) {
  const cache = getGuildCache(guild.id);
  cache.clear();

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;

  invites.forEach((invite) => {
    cache.set(invite.code, invite.uses || 0);
  });
}

async function findUsedInvite(guild) {
  const before = getGuildCache(guild.id);
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;

  let usedInvite = null;
  invites.forEach((invite) => {
    const previousUses = before.get(invite.code) || 0;
    const currentUses = invite.uses || 0;
    if (currentUses > previousUses && !usedInvite) {
      usedInvite = invite;
    }
    before.set(invite.code, currentUses);
  });

  return usedInvite;
}

async function ensureInviteStats(guildId, userId) {
  run(
    "INSERT OR IGNORE INTO invite_stats (guild_id, user_id, updated_at) VALUES (?, ?, ?)",
    [guildId, userId, Date.now()]
  );
}

async function getInviteStats(guildId, userId) {
  await ensureInviteStats(guildId, userId);
  return get("SELECT * FROM invite_stats WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
}

async function addInviteJoin(member, invite, config = {}) {
  const guildId = member.guild.id;
  const inviterId = invite?.inviter?.id || null;
  const inviteCode = invite?.code || null;
  const isFake = Date.now() - member.user.createdTimestamp < getFakeAccountAgeMs(config) ? 1 : 0;
  const status = isFake ? "fake" : "pending";
  const invalidReason = isFake ? "Conta recente abaixo do tempo mínimo configurado" : null;

  run(
    `INSERT OR REPLACE INTO invite_joins
      (guild_id, user_id, inviter_id, invite_code, is_fake, status, validated_at, invalid_reason, log_channel_id, log_message_id, joined_at, left_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL)`,
    [guildId, member.id, inviterId, inviteCode, isFake, status, invalidReason, Date.now()]
  );

  if (inviterId && inviterId !== member.id) {
    await ensureInviteStats(guildId, inviterId);
    run(
      `UPDATE invite_stats
       SET total = total + 1,
           pending = pending + ?,
           fake = fake + ?,
           updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
      [isFake ? 0 : 1, isFake, Date.now(), guildId, inviterId]
    );
  }

  return { inviterId, inviteCode, isFake: Boolean(isFake), status, invalidReason };
}

function buildInviteStatusLine(status, reason = null) {
  if (status === "valid") return "✅ **Aprovado.**";
  if (status === "invalid") return `❌ **Inválido.**${reason ? `\n> ${reason}` : ""}`;
  if (status === "fake") return `⚠️ **Suspeito.**${reason ? `\n> ${reason}` : ""}`;
  return "⏳ **Em análise.**";
}

function buildPublicInviteEmbed(config, member, inviteData, status = "pending", reason = null) {
  const inviterText = inviteData.inviterId ? `<@${inviteData.inviterId}>` : "Desconhecido";

  return new EmbedBuilder()
    .setColor(status === "valid" ? (config.colors?.success || 0x2e7d32) : config.colors?.primary || 0x1e88e5)
    .setTitle("📨 Novo membro por invite")
    .setDescription([
      `**Convidado:** ${member}`,
      `**Por:** ${inviterText}`,
      "",
      `**Idade da conta:** ${formatAccountAge(member.user)}`,
      "",
      buildInviteStatusLine(status, reason)
    ].join("\n"))
    .setFooter({ text: `${config.botName || "BznX Store"} • Invites` })
    .setTimestamp();
}

function buildSuspiciousInviteEmbed(config, member, inviteData) {
  const inviterText = inviteData.inviterId ? `<@${inviteData.inviterId}>` : "Desconhecido";

  return new EmbedBuilder()
    .setColor(config.colors?.warning || 0xf9a825)
    .setTitle("Entrada suspeita por invite")
    .setDescription([
      `**Convidado:** ${member} (${member.id})`,
      `**Por:** ${inviterText}`,
      `**Código:** ${inviteData.inviteCode || "não identificado"}`,
      `**Idade da conta:** ${formatAccountAge(member.user)}`,
      "",
      `**Motivo:** ${inviteData.invalidReason || "Conta marcada como suspeita."}`,
      "",
      "Esta entrada não foi enviada ao canal público de invites."
    ].join("\n"))
    .setFooter({ text: `${config.botName || "BznX Store"} • Logs de invites` })
    .setTimestamp();
}

async function saveInviteLogMessage(guildId, userId, message) {
  if (!message?.id || !message.channel?.id) return;
  run(
    "UPDATE invite_joins SET log_channel_id = ?, log_message_id = ? WHERE guild_id = ? AND user_id = ?",
    [message.channel.id, message.id, guildId, userId]
  );
}

async function sendInviteJoinLog(member, config, inviteData) {
  const channelId = inviteData.isFake ? getSuspiciousInviteLogChannelId(config) : getInviteLogChannelId(config);
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = inviteData.isFake
    ? buildSuspiciousInviteEmbed(config, member, inviteData)
    : buildPublicInviteEmbed(config, member, inviteData, "pending");

  const message = await channel.send({ embeds: [embed] });
  await saveInviteLogMessage(member.guild.id, member.id, message);
}

async function editInviteLogMessage(guild, config, row, status, reason = null) {
  if (!row.log_channel_id || !row.log_message_id) return;

  const channel = await guild.channels.fetch(row.log_channel_id).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(row.log_message_id).catch(() => null) : null;
  if (!message?.editable) return;

  const member = await guild.members.fetch(row.user_id).catch(() => null);
  const user = member?.user || await guild.client.users.fetch(row.user_id).catch(() => null);
  const memberLike = member || {
    id: row.user_id,
    user: user || { id: row.user_id, createdTimestamp: row.joined_at || Date.now() },
    toString: () => `<@${row.user_id}>`
  };

  const inviteData = {
    inviterId: row.inviter_id,
    inviteCode: row.invite_code,
    isFake: Boolean(row.is_fake),
    invalidReason: row.invalid_reason
  };

  await message.edit({
    embeds: [buildPublicInviteEmbed(config, memberLike, inviteData, status, reason)]
  }).catch(() => null);
}

async function validatePendingInvites(guild, config) {
  const validationMs = getInviteValidationMs(config);
  if (validationMs <= 0) return [];

  const readyAt = Date.now() - validationMs;
  const rows = all(
    "SELECT * FROM invite_joins WHERE guild_id = ? AND status = 'pending' AND left_at IS NULL AND joined_at <= ?",
    [guild.id, readyAt]
  );

  for (const row of rows) {
    run(
      "UPDATE invite_joins SET status = 'valid', validated_at = ? WHERE guild_id = ? AND user_id = ?",
      [Date.now(), guild.id, row.user_id]
    );

    if (row.inviter_id) {
      await ensureInviteStats(guild.id, row.inviter_id);
      run(
        `UPDATE invite_stats
         SET current = current + 1,
             pending = CASE WHEN pending > 0 THEN pending - 1 ELSE 0 END,
             updated_at = ?
         WHERE guild_id = ? AND user_id = ?`,
        [Date.now(), guild.id, row.inviter_id]
      );
    }

    await editInviteLogMessage(guild, config, row, "valid");
  }

  return rows;
}

async function markMemberLeft(member, config = {}) {
  const guildId = member.guild.id;
  const joinRecord = get(
    "SELECT * FROM invite_joins WHERE guild_id = ? AND user_id = ? AND left_at IS NULL",
    [guildId, member.id]
  );

  if (!joinRecord) return null;

  const status = joinRecord.status === "valid" ? "left" : "invalid";
  const invalidReason = joinRecord.status === "pending" ? "Saiu antes dos 5 minutos de análise" : joinRecord.invalid_reason;

  run(
    "UPDATE invite_joins SET left_at = ?, status = ?, invalid_reason = ? WHERE guild_id = ? AND user_id = ?",
    [Date.now(), status, invalidReason, guildId, member.id]
  );

  if (joinRecord.inviter_id) {
    await ensureInviteStats(guildId, joinRecord.inviter_id);
    run(
      `UPDATE invite_stats
       SET current = CASE WHEN current > 0 THEN current - ? ELSE 0 END,
           pending = CASE WHEN pending > 0 THEN pending - ? ELSE 0 END,
           invalid = invalid + ?,
           left_count = left_count + 1,
           updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
      [
        joinRecord.status === "valid" && !joinRecord.is_fake ? 1 : 0,
        joinRecord.status === "pending" && !joinRecord.is_fake ? 1 : 0,
        joinRecord.status === "pending" ? 1 : 0,
        Date.now(),
        guildId,
        joinRecord.inviter_id
      ]
    );
  }

  if (joinRecord.status === "pending") {
    await editInviteLogMessage(member.guild, config, joinRecord, "invalid", invalidReason);
  }

  return joinRecord;
}

async function setRedeemedInvites(guildId, userId, amount) {
  await ensureInviteStats(guildId, userId);
  run(
    "UPDATE invite_stats SET redeemed = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?",
    [Math.max(0, Number(amount) || 0), Date.now(), guildId, userId]
  );
  return getInviteStats(guildId, userId);
}

async function resetRedeemableInvites(guildId, userId) {
  const stats = await getInviteStats(guildId, userId);
  return setRedeemedInvites(guildId, userId, stats.current);
}

function getRedeemableInvites(stats) {
  return Math.max(0, Number(stats.current || 0) - Number(stats.redeemed || 0));
}

async function getInviteLeaderboard(guildId, limit = 10) {
  return all(
    "SELECT * FROM invite_stats WHERE guild_id = ? ORDER BY current DESC, total DESC LIMIT ?",
    [guildId, limit]
  );
}

function buildInviteStatsEmbed(config, member, stats) {
  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Convites`)
    .setDescription([
      `> **Usuário:** ${member}`,
      `> **Disponíveis:** ${getRedeemableInvites(stats)}`,
      `> **Válidos:** ${stats.current || 0}`,
      `> **Em análise:** ${stats.pending || 0}`,
      `> **Histórico total:** ${stats.total || 0}`,
      `> **Resgatados/Resetados:** ${stats.redeemed || 0}`,
      `> **Fake/recente:** ${stats.fake || 0}`,
      `> **Inválidos:** ${stats.invalid || 0}`,
      `> **Saídas:** ${stats.left_count || 0}`
    ].join("\n"))
    .setTimestamp();
}

module.exports = {
  cacheGuildInvites,
  findUsedInvite,
  addInviteJoin,
  markMemberLeft,
  validatePendingInvites,
  getInviteStats,
  setRedeemedInvites,
  resetRedeemableInvites,
  getRedeemableInvites,
  getInviteLeaderboard,
  buildInviteStatsEmbed,
  sendInviteJoinLog
};
