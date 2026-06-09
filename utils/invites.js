const { EmbedBuilder } = require("discord.js");
const { get, run, all } = require("../database/db");

const inviteCache = new Map();
const FAKE_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getInviteLogChannelId(config) {
  return config.inviteChannelId || config.invitesChannelId || config.logChannels?.invites || "1505706829022498846";
}

function getGuildCache(guildId) {
  if (!inviteCache.has(guildId)) inviteCache.set(guildId, new Map());
  return inviteCache.get(guildId);
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

async function addInviteJoin(member, invite) {
  const guildId = member.guild.id;
  const inviterId = invite?.inviter?.id || null;
  const inviteCode = invite?.code || null;
  const isFake = Date.now() - member.user.createdTimestamp < FAKE_ACCOUNT_AGE_MS ? 1 : 0;

  run(
    "INSERT OR REPLACE INTO invite_joins (guild_id, user_id, inviter_id, invite_code, is_fake, joined_at, left_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    [guildId, member.id, inviterId, inviteCode, isFake, Date.now()]
  );

  if (inviterId && inviterId !== member.id) {
    await ensureInviteStats(guildId, inviterId);
    run(
      `UPDATE invite_stats
       SET total = total + 1,
           current = current + ?,
           fake = fake + ?,
           updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
      [isFake ? 0 : 1, isFake, Date.now(), guildId, inviterId]
    );
  }

  return { inviterId, inviteCode, isFake: Boolean(isFake) };
}

async function markMemberLeft(member) {
  const guildId = member.guild.id;
  const joinRecord = get(
    "SELECT * FROM invite_joins WHERE guild_id = ? AND user_id = ? AND left_at IS NULL",
    [guildId, member.id]
  );

  if (!joinRecord) return null;

  run(
    "UPDATE invite_joins SET left_at = ? WHERE guild_id = ? AND user_id = ?",
    [Date.now(), guildId, member.id]
  );

  if (joinRecord.inviter_id) {
    await ensureInviteStats(guildId, joinRecord.inviter_id);
    run(
      `UPDATE invite_stats
       SET current = CASE WHEN current > 0 THEN current - ? ELSE 0 END,
           left_count = left_count + 1,
           updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
      [joinRecord.is_fake ? 0 : 1, Date.now(), guildId, joinRecord.inviter_id]
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
      `> **Total:** ${stats.total || 0}`,
      `> **Disponíveis:** ${getRedeemableInvites(stats)}`,
      `> **Resgatados/Resetados:** ${stats.redeemed || 0}`,
      `> **Fake:** ${stats.fake || 0}`,
      `> **Saiu:** ${stats.left_count || 0}`,
      `> **Entrou válido:** ${stats.current || 0}`
    ].join("\n"))
    .setTimestamp();
}

async function sendInviteJoinLog(member, config, inviteData) {
  const channelId = getInviteLogChannelId(config);
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const inviterText = inviteData.inviterId ? `<@${inviteData.inviterId}>` : "Desconhecido";
  const inviterStats = inviteData.inviterId ? await getInviteStats(member.guild.id, inviteData.inviterId) : null;
  const invitedCount = inviterStats ? getRedeemableInvites(inviterStats) : 0;

  await channel.send({
    content: [
      `**Convidado:** ${member}`,
      `**Por:** ${inviterText}`,
      `**Convidou:** ${invitedCount} invites.`,
      inviteData.isFake ? ":warning: **Conta marcada como fake/recente.**" : null
    ].filter(Boolean).join("\n")
  });
}

module.exports = {
  cacheGuildInvites,
  findUsedInvite,
  addInviteJoin,
  markMemberLeft,
  getInviteStats,
  setRedeemedInvites,
  resetRedeemableInvites,
  getRedeemableInvites,
  getInviteLeaderboard,
  buildInviteStatsEmbed,
  sendInviteJoinLog
};
