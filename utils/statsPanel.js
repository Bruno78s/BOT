const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");
const { get, run } = require("../database/db");

async function ensureStatsPanel(client, config) {
  const statsChannelId = config.statsChannelId;
  if (!statsChannelId) return;

  const channel = await client.channels.fetch(statsChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const stored = await get("SELECT message_id FROM panel_messages WHERE guild_id = ? AND type = ?", [channel.guild.id, "stats"]).catch(() => null);
  let existingMessage = null;
  if (stored?.message_id) {
    existingMessage = await channel.messages.fetch(stored.message_id).catch(() => null);
  }

  const recent = existingMessage ? null : await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (recent) {
    existingMessage = recent.find(
      (msg) =>
        msg.author?.id === client.user.id &&
        msg.embeds?.[0]?.title?.includes("Estatísticas")
    );
  }

  const guild = channel.guild;

  const fetchedGuild = await guild.fetch().catch(() => guild);
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const totalMembers = fetchedGuild.memberCount || members.size || guild.memberCount;

  const humanMembers = members.filter(m => !m.user.bot);
  const botMembers = members.filter(m => m.user.bot);

  const presences = guild.presences.cache;
  const onlineMembers = presences.filter(p => p.status === "online").size;
  const idleMembers = presences.filter(p => p.status === "idle").size;
  const dndMembers = presences.filter(p => p.status === "dnd").size;
  const offlineMembers = Math.max(0, totalMembers - onlineMembers - idleMembers - dndMembers);
  const activeMembers = onlineMembers + idleMembers + dndMembers;
  
  const roles = guild.roles.cache.sort((a, b) => b.position - a.position);
  const channels = guild.channels.cache;
  
  const textChannels = channels.filter(c => c.isTextBased()).size;
  const voiceChannels = channels.filter(c => c.isVoiceBased()).size;
  const categoryChannels = channels.filter(c => c.type === 4).size;
  
  const boostCount = guild.premiumSubscriptionCount;
  const boostLevel = guild.premiumTier;
  
  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Estatísticas do Servidor`)
    .setDescription([
      "**Visão geral**",
      `**Nome:** ${guild.name}`,
      `**ID:** ${guild.id}`,
      `**Dono:** <@${guild.ownerId}>`,
      `**Criado em:** ${guild.createdAt.toLocaleDateString('pt-BR')}`,
      "",
      "**Membros**",
      `**Total:** ${totalMembers}`,
      `**Humanos:** ${humanMembers.size}`,
      `**Bots:** ${botMembers.size}`,
      "",
      "**Status**",
      `**Online:** ${onlineMembers}`,
      `**Ausente:** ${idleMembers}`,
      `**Não perturbe:** ${dndMembers}`,
      `**Offline:** ${offlineMembers}`,
      `**Ativos agora:** ${activeMembers}`,
      "",
      "**Canais**",
      `**Texto:** ${textChannels}`,
      `**Voz:** ${voiceChannels}`,
      `**Categorias:** ${categoryChannels}`,
      `**Total:** ${channels.size}`,
      "",
      "**Boosts**",
      `**Nível:** ${boostLevel}`,
      `**Total Boosts:** ${boostCount}`,
      "",
      "**Cargos**",
      `**Total:** ${roles.size}`,
      "",
      `**Última atualização:** ${new Date().toLocaleTimeString("pt-BR")}`,
      "**Atualização automática:** a cada 30 segundos"
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ 
      text: `${config.botName} • Estatísticas`, 
      iconURL: "attachment://logo.png"
    })
    .setTimestamp()
    .addFields([
      {
        name: "Membros online",
        value: `${Math.round((activeMembers / totalMembers) * 100)}%`,
        inline: true
      },
      {
        name: "Bots",
        value: `${Math.round((botMembers.size / totalMembers) * 100)}%`,
        inline: true
      }
    ]);

  if (existingMessage) {
    await existingMessage.edit({ 
      embeds: [embed],
      files: [logoAttachment]
    });
    await run(
      "INSERT INTO panel_messages (guild_id, type, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, type) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at",
      [channel.guild.id, "stats", channel.id, existingMessage.id, Date.now()]
    ).catch(() => null);
    return;
  }

  const message = await channel.send({
    embeds: [embed],
    files: [logoAttachment]
  });

  await run(
    "INSERT INTO panel_messages (guild_id, type, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, type) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at",
    [channel.guild.id, "stats", channel.id, message.id, Date.now()]
  ).catch(() => null);
}

module.exports = {
  ensureStatsPanel
};
