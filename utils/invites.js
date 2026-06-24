const { EmbedBuilder } = require("discord.js");
const { get, run, all } = require("../database/db");

const inviteCache = new Map();
const DEFAULT_FAKE_ACCOUNT_AGE_DAYS = 7;
const DEFAULT_VALID_AFTER_MINUTES = 30;

function getInviteLogChannelId(config) {
  return config.inviteChannelId || config.invitesChannelId || config.logChannels?.invites || "1505706829022498846";
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

  run(
    `INSERT OR REPLACE INTO invite_joins
      (guild_id, user_id, inviter_id, invite_code, is_fake, status, validated_at, invalid_reason, joined_at, left_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
    [guildId, member.id, inviterId, inviteCode, isFake, status, Date.now()]
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

  return { inviterId, inviteCode, isFake: Boolean(isFake), status };
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
  }

  return rows;
}

async function markMemberLeft(member) {
  const guildId = member.guild.id;
  const joinRecord = get(
    "SELECT * FROM invite_joins WHERE guild_id = ? AND user_id = ? AND left_at IS NULL",
    [guildId, member.id]
  );

  if (!joinRecord) return null;

  const status = joinRecord.status === "valid" ? "left" : "invalid";
  const invalidReason = joinRecord.status === "pending" ? "Saiu antes do tempo mínimo para convite válido" : joinRecord.invalid_reason;

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

async function sendInviteJoinLog(member, config, inviteData) {
  const channelId = getInviteLogChannelId(config);
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const inviterText = inviteData.inviterId ? `<@${inviteData.inviterId}>` : "Desconhecido";
  const inviterStats = inviteData.inviterId ? await getInviteStats(member.guild.id, inviteData.inviterId) : null;
  const validCount = inviterStats ? getRedeemableInvites(inviterStats) : 0;
  const pendingCount = inviterStats ? Number(inviterStats.pending || 0) : 0;
  const validationText = formatDuration(getInviteValidationMs(config));
  const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000));

  const embed = new EmbedBuilder()
    .setColor(inviteData.isFake ? 0xf1c40f : config.colors.primary)
    .setTitle(inviteData.isFake ? "⚠️ Entrada suspeita por invite" : "📨 Novo membro por invite")
    .setDescription([
      `**Convidado:** ${member}`,
      `**Por:** ${inviterText}`,
      `**Código:** ${inviteData.inviteCode || "não identificado"}`,
      `**Idade da conta:** ${accountAgeDays} dia(s)`,
      "",
      inviteData.isFake
        ? "⚠️ Esta entrada foi marcada como fake/recente e não conta como invite válido."
        : `⏳ Invite em análise por **${validationText}** antes de virar válido.`,
      "",
      `✅ **Válidos disponíveis:** ${validCount}`,
      `⏳ **Em análise:** ${pendingCount}`
    ].join("\n"))
    .setFooter({ text: `${config.botName} • Invites` })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
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
