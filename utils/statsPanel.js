const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");
const { get, run } = require("../database/db");

function formatDate(value) {
  return value.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatTime(value = new Date()) {
  return value.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function progressBar(value) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const filled = Math.round(safeValue / 10);
  const empty = 10 - filled;
  return `${"▰".repeat(filled)}${"▱".repeat(empty)} ${safeValue}%`;
}

function getLogoAttachment() {
  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  return new AttachmentBuilder(logoPath, { name: "logo.png" });
}

async function findExistingStatsMessage(client, channel) {
  const stored = get("SELECT message_id FROM panel_messages WHERE guild_id = ? AND type = ?", [channel.guild.id, "stats"]);
  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message) return message;
  }

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return recent?.find((message) => (
    message.author?.id === client.user.id &&
    message.embeds?.[0]?.title?.includes("Painel do Servidor")
  )) || null;
}

async function ensureStatsPanel(client, config) {
  const statsChannelId = config.statsChannelId;
  if (!statsChannelId) return;

  const channel = await client.channels.fetch(statsChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const guild = channel.guild;
  const fetchedGuild = await guild.fetch().catch(() => guild);
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const totalMembers = fetchedGuild.memberCount || members.size || guild.memberCount || 0;
  const safeTotalMembers = totalMembers || 1;

  const humanMembers = members.filter((member) => !member.user.bot);
  const botMembers = members.filter((member) => member.user.bot);
  const presences = guild.presences.cache;

  const onlineMembers = presences.filter((presence) => presence.status === "online").size;
  const idleMembers = presences.filter((presence) => presence.status === "idle").size;
  const dndMembers = presences.filter((presence) => presence.status === "dnd").size;
  const offlineMembers = Math.max(0, totalMembers - onlineMembers - idleMembers - dndMembers);
  const activeMembers = onlineMembers + idleMembers + dndMembers;

  const channels = guild.channels.cache;
  const textChannels = channels.filter((guildChannel) => guildChannel.isTextBased()).size;
  const voiceChannels = channels.filter((guildChannel) => guildChannel.isVoiceBased()).size;
  const categoryChannels = channels.filter((guildChannel) => guildChannel.type === 4).size;
  const roles = guild.roles.cache;
  const boostCount = guild.premiumSubscriptionCount || 0;
  const boostLevel = guild.premiumTier || 0;
  const owner = guild.ownerId ? await guild.members.fetch(guild.ownerId).catch(() => null) : null;
  const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

  const activePercent = percent(activeMembers, safeTotalMembers);
  const botPercent = percent(botMembers.size, safeTotalMembers);
  const humanPercent = percent(humanMembers.size, safeTotalMembers);

  const embed = new EmbedBuilder()
    .setColor(config.colors?.primary || 0x1e88e5)
    .setTitle(`${config.botName} • Painel do Servidor`)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
    .setDescription([
      `Atualizado às **${formatTime()}** • atualização automática a cada **30 segundos**`,
      `Servidor criado em **${formatDate(guild.createdAt)}** (<t:${createdTimestamp}:R>)`
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .addFields([
      {
        name: "🏷️ Servidor",
        value: [
          `Nome: **${guild.name}**`,
          `ID: \`${guild.id}\``,
          `Dono: ${owner ? `<@${owner.id}>` : guild.ownerId ? `<@${guild.ownerId}>` : "Não identificado"}`
        ].join("\n"),
        inline: true
      },
      {
        name: "👥 Membros",
        value: [
          `Total: **${totalMembers}**`,
          `Humanos: **${humanMembers.size}** (${humanPercent}%)`,
          `Bots: **${botMembers.size}** (${botPercent}%)`
        ].join("\n"),
        inline: true
      },
      {
        name: "🟢 Presenças",
        value: [
          `Online: **${onlineMembers}**`,
          `Ausente: **${idleMembers}**`,
          `Não perturbe: **${dndMembers}**`,
          `Offline: **${offlineMembers}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "📚 Estrutura",
        value: [
          `Texto: **${textChannels}**`,
          `Voz: **${voiceChannels}**`,
          `Categorias: **${categoryChannels}**`,
          `Total: **${channels.size}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "💎 Boosts e Cargos",
        value: [
          `Nível: **${boostLevel}**`,
          `Boosts: **${boostCount}**`,
          `Cargos: **${roles.size}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "📊 Atividade",
        value: [
          `Ativos agora: **${activeMembers}**`,
          progressBar(activePercent),
          `Bots no servidor: **${botMembers.size}**`,
          progressBar(botPercent)
        ].join("\n"),
        inline: false
      },
      {
        name: "🧭 Leitura rápida",
        value: [
          activeMembers > 0 ? "🟢 Há membros ativos agora." : "⚪ Sem presenças ativas no momento.",
          boostCount > 0 ? "💎 O servidor possui boosts ativos." : "💎 Nenhum boost ativo ainda.",
          botMembers.size > 0 ? "🤖 Bots operacionais presentes no servidor." : "🤖 Nenhum bot detectado pelo cache atual."
        ].join("\n"),
        inline: false
      }
    ])
    .setFooter({
      text: `${config.botName} • Estatísticas do Servidor`,
      iconURL: "attachment://logo.png"
    })
    .setTimestamp();

  const logoAttachment = getLogoAttachment();
  const existingMessage = await findExistingStatsMessage(client, channel);
  const payload = { embeds: [embed], files: [logoAttachment] };
  const message = existingMessage ? await existingMessage.edit(payload) : await channel.send(payload);

  run(
    "INSERT INTO panel_messages (guild_id, type, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, type) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at",
    [guild.id, "stats", channel.id, message.id, Date.now()]
  );
}

module.exports = {
  ensureStatsPanel
};
