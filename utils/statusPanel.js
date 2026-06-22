const { EmbedBuilder } = require("discord.js");
const { get, run } = require("../database/db");
const { getCustomerRoleSyncStatus } = require("./customerRoleSync");

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatTimestamp(value) {
  if (!value) return "Nunca";
  return `<t:${Math.floor(value / 1000)}:R>`;
}

function getStatusChannelId(config) {
  return process.env.STATUS_PANEL_CHANNEL_ID || config.statusPanelChannelId || config.logChannels?.sistema || config.statsChannelId;
}

function getPaymentStats(guildId) {
  return get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as revenue
    FROM payments
    WHERE guild_id = ?
  `, [guildId]) || {};
}

async function ensureStatusPanel(client, config) {
  const channelId = getStatusChannelId(config);
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const guild = channel.guild;
  const stats = getPaymentStats(guild.id);
  const sync = getCustomerRoleSyncStatus();
  const ping = Math.round(client.ws.ping);
  const customerRoleId = process.env.DISCORD_CUSTOMER_ROLE_ID || process.env.CLIENT_ROLE_ID || config.clientRoleId;
  const customerRole = customerRoleId ? guild.roles.cache.get(customerRoleId) : null;

  let stored = null;
  try {
    stored = get("SELECT message_id FROM panel_messages WHERE guild_id = ? AND type = ?", [guild.id, "status"]);
  } catch {
    stored = null;
  }

  let existingMessage = stored?.message_id ? await channel.messages.fetch(stored.message_id).catch(() => null) : null;
  if (!existingMessage) {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    existingMessage = recent?.find((msg) => msg.author?.id === client.user.id && msg.embeds?.[0]?.title?.includes("Status do Bot"));
  }

  const embed = new EmbedBuilder()
    .setColor(sync.lastError ? config.colors.warning : config.colors.success)
    .setTitle(`${config.botName} | Status do Bot`)
    .setDescription("Monitoramento operacional do bot e das integracoes principais.")
    .addFields([
      {
        name: "Bot",
        value: [
          `Online: **sim**`,
          `Ping: **${Number.isFinite(ping) ? ping : 0}ms**`,
          `Uptime: **${formatUptime(client.uptime || 0)}**`,
          `Servidor: **${guild.name}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "Vendas",
        value: [
          `Pagamentos: **${stats.total || 0}**`,
          `Aprovados: **${stats.approved || 0}**`,
          `Pendentes: **${stats.pending || 0}**`,
          `Receita: **R$ ${Number(stats.revenue || 0).toFixed(2)}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "Sync Cliente",
        value: [
          `Status: **${sync.enabled ? (sync.running ? "rodando" : "ativo") : "desativado"}**`,
          `Ultima execucao: **${formatTimestamp(sync.lastRunAt)}**`,
          `Pendentes recebidos: **${sync.lastPendingCount || 0}**`,
          `Processados: **${sync.lastProcessedCount || 0}**`,
          `Sucessos/erros: **${sync.lastSuccessCount || 0}/${sync.lastErrorCount || 0}**`,
          `Cargo: ${customerRole ? `<@&${customerRole.id}>` : customerRoleId ? `\`${customerRoleId}\`` : "**nao configurado**"}`
        ].join("\n"),
        inline: false
      }
    ])
    .setFooter({ text: sync.lastError ? `Ultimo erro: ${sync.lastError}`.slice(0, 200) : "Tudo operacional" })
    .setTimestamp();

  const payload = { embeds: [embed] };
  const message = existingMessage ? await existingMessage.edit(payload) : await channel.send(payload);

  run(
    "INSERT INTO panel_messages (guild_id, type, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, type) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at",
    [guild.id, "status", channel.id, message.id, Date.now()]
  );
}

function startStatusPanel(client, config) {
  ensureStatusPanel(client, config).catch((error) => {
    console.error("[STATUS PANEL] Erro ao atualizar painel:", error.message);
  });

  const timer = setInterval(() => {
    ensureStatusPanel(client, config).catch((error) => {
      console.error("[STATUS PANEL] Erro ao atualizar painel:", error.message);
    });
  }, 2 * 60 * 1000);

  if (timer.unref) timer.unref();
  console.log("[STATUS PANEL] Painel de status iniciado.");
  return timer;
}

module.exports = {
  ensureStatusPanel,
  startStatusPanel
};
