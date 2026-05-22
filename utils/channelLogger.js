const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const path = require("path");
const { get, run, all } = require("../database/db");

const LOG_CHANNELS = {
  sistema:        "1469735341165514794",
  relatorio:      "1507183329961574430",
  vendas:         "1469735299008565319",
  comprovantes:   "1469735330511851732",
  pedidos:        "1469735333662032013",
  ticket:         "1469735337604415612",
  seguranca:      "1469735354956251177",
  feedback:       "1469735361914601492",
  vendasSites:    "1507183243764699136",
};

const COLORS = {
  sistema:      0x5865F2,
  relatorio:    0x3498db,
  vendas:       0x00c853,
  comprovantes: 0x27ae60,
  pedidos:      0xf39c12,
  ticket:       0x9b59b6,
  seguranca:    0xe74c3c,
  feedback:     0xf1c40f,
  vendasSites:  0x1abc9c,
};

function getLogo() {
  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  return new AttachmentBuilder(logoPath, { name: "logo.png" });
}

async function sendToChannel(client, channelKey, embed, extra = {}) {
  const channelId = LOG_CHANNELS[channelKey];
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  const logo = getLogo();
  const payload = { embeds: [embed], files: [logo], ...extra };
  return channel.send(payload).catch(() => null);
}

async function editOrSend(client, channelKey, embed, storeKey) {
  const channelId = LOG_CHANNELS[channelKey];
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const stored = await get("SELECT message_id FROM panel_messages WHERE type = ? AND channel_id = ?", [storeKey, channelId]);
  const logo = getLogo();

  if (stored?.message_id) {
    const msg = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], files: [logo] }).catch(() => null);
      await run("UPDATE panel_messages SET updated_at = ? WHERE type = ? AND channel_id = ?", [Date.now(), storeKey, channelId]);
      return;
    }
  }

  const sent = await channel.send({ embeds: [embed], files: [logo] }).catch(() => null);
  if (sent) {
    await run(
      "INSERT INTO panel_messages (guild_id, type, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, type) DO UPDATE SET message_id = excluded.message_id, updated_at = excluded.updated_at",
      ["global", storeKey, channelId, sent.id, Date.now()]
    );
  }
}

async function logSistema(client, config, event, details = {}) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.sistema)
    .setAuthor({ name: `${config.botName} • Sistema`, iconURL: "attachment://logo.png" })
    .setTitle(`⚙️ ${event}`)
    .setThumbnail("attachment://logo.png")
    .setTimestamp()
    .setFooter({ text: `${config.botName} • sistema`, iconURL: "attachment://logo.png" });

  if (details.description) embed.setDescription(details.description);
  if (details.fields?.length) embed.addFields(details.fields);

  await editOrSend(client, "sistema", embed, `sistema_${event.toLowerCase().replace(/\s+/g,"_")}`);
}

async function logVenda(client, config, { userId, productName, amount, orderId, paymentId, channelId, coupon }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.vendas)
    .setAuthor({ name: `${config.botName} • Venda Aprovada`, iconURL: "attachment://logo.png" })
    .setTitle("✅ Nova Venda Confirmada")
    .setDescription([
      `> 👤 **Cliente:** <@${userId}>`,
      `> 📦 **Produto:** ${productName}`,
      coupon ? `> 🏷️ **Cupom:** ${coupon}` : null,
      `> 💰 **Valor:** R$ ${Number(amount).toFixed(2)}`,
      `> 🛒 **Canal:** <#${channelId}>`,
      `> 🔖 **Pedido:** #${orderId}`,
      `> 🆔 **Pagamento:** \`${paymentId}\``,
    ].filter(Boolean).join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-vendas`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await sendToChannel(client, "vendas", embed);
}

async function logComprovante(client, config, { userId, productName, amount, orderId, paymentId, channelId }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.comprovantes)
    .setAuthor({ name: `${config.botName} • Comprovante`, iconURL: "attachment://logo.png" })
    .setTitle("🧾 Comprovante de Venda")
    .addFields([
      { name: "👤 Cliente", value: `<@${userId}>`, inline: true },
      { name: "📦 Produto", value: productName, inline: true },
      { name: "💰 Valor", value: `R$ ${Number(amount).toFixed(2)}`, inline: true },
      { name: "🔖 Pedido", value: `#${orderId}`, inline: true },
      { name: "🆔 Pagamento", value: `\`${paymentId}\``, inline: true },
      { name: "🛒 Canal", value: `<#${channelId}>`, inline: true },
    ])
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-comprovantes`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await sendToChannel(client, "comprovantes", embed);
}

async function logPedido(client, config, { userId, productName, amount, orderId, channelId }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.pedidos)
    .setAuthor({ name: `${config.botName} • Pedido Criado`, iconURL: "attachment://logo.png" })
    .setTitle("📋 Novo Pedido")
    .setDescription([
      `> 👤 **Cliente:** <@${userId}>`,
      `> 📦 **Produto:** ${productName}`,
      `> 💰 **Valor:** R$ ${Number(amount).toFixed(2)}`,
      `> 🛒 **Canal:** <#${channelId}>`,
      `> 🔖 **Pedido:** #${orderId}`,
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-pedidos`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await sendToChannel(client, "pedidos", embed);
}

async function logTicketCriado(client, config, { userId, type, channelId, reason }) {
  const typeLabel = type === "sales" ? "🛒 Carrinho" : type === "delivery" ? "📦 Entrega" : "📩 Suporte";
  const embed = new EmbedBuilder()
    .setColor(COLORS.ticket)
    .setAuthor({ name: `${config.botName} • Ticket`, iconURL: "attachment://logo.png" })
    .setTitle(`${typeLabel} Aberto`)
    .setDescription([
      `> 👤 **Usuário:** <@${userId}>`,
      `> 📁 **Tipo:** ${typeLabel}`,
      `> 💬 **Canal:** <#${channelId}>`,
      reason ? `> 📝 **Motivo:** ${reason}` : null,
    ].filter(Boolean).join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-ticket`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await sendToChannel(client, "ticket", embed);
}

async function logSeguranca(client, config, { evento, userId, detalhes }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.seguranca)
    .setAuthor({ name: `${config.botName} • Segurança`, iconURL: "attachment://logo.png" })
    .setTitle(`🔒 ${evento}`)
    .setDescription([
      `> 👤 **Usuário:** <@${userId}>`,
      detalhes ? `> 📝 **Detalhes:** ${detalhes}` : null,
    ].filter(Boolean).join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-segurança`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await sendToChannel(client, "seguranca", embed);
}

async function logFeedback(client, config, { userId, rating, ticketName, ticketId }) {
  const stars = "⭐".repeat(rating) + "☆".repeat(5 - rating);
  const embed = new EmbedBuilder()
    .setColor(rating >= 4 ? COLORS.vendas : rating >= 3 ? COLORS.pedidos : COLORS.seguranca)
    .setAuthor({ name: `${config.botName} • Feedback`, iconURL: "attachment://logo.png" })
    .setTitle("💬 Feedback Recebido")
    .setDescription([
      `> 👤 **Usuário:** <@${userId}>`,
      `> ⭐ **Nota:** ${stars} (${rating}/5)`,
      `> 🎫 **Ticket:** ${ticketName || ticketId}`,
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-feedback`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await sendToChannel(client, "feedback", embed);
}

async function logVendaSite(client, config, { customerName, customerEmail, orderId, total, items, paymentMethod }) {
  const itemList = items.map(i => `• ${i.productName} x${i.quantity} — R$ ${Number(i.price).toFixed(2)}`).join("\n");
  const embed = new EmbedBuilder()
    .setColor(COLORS.vendasSites)
    .setAuthor({ name: `${config.botName} • Venda Site`, iconURL: "attachment://logo.png" })
    .setTitle("🌐 Venda Aprovada no Site")
    .setDescription([
      `> 👤 **Cliente:** ${customerName} (${customerEmail})`,
      `> 💰 **Total:** R$ ${Number(total).toFixed(2)}`,
      `> 🔖 **Pedido:** #${orderId}`,
      `> 💳 **Pagamento:** ${paymentMethod?.toUpperCase() || "PIX"}`,
      "",
      "**Itens:**",
      itemList,
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-vendas-sites`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await sendToChannel(client, "vendasSites", embed);
}

async function logRelatorio(client, config) {
  const totalVendas = await get("SELECT COUNT(*) as c, SUM(amount) as total FROM payments WHERE status = 'approved'");
  const vendasHoje = await get("SELECT COUNT(*) as c, SUM(amount) as total FROM payments WHERE status = 'approved' AND created_at > ?", [Date.now() - 86400000]);
  const ticketsAbertos = await get("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'");
  const produtos = await all("SELECT * FROM settings LIMIT 1");

  const embed = new EmbedBuilder()
    .setColor(COLORS.relatorio)
    .setAuthor({ name: `${config.botName} • Relatório`, iconURL: "attachment://logo.png" })
    .setTitle("📊 Relatório Geral")
    .addFields([
      { name: "📦 Produtos", value: `${config.products?.length || 0} cadastrados`, inline: true },
      { name: "🛒 Tickets Abertos", value: `${ticketsAbertos?.c || 0}`, inline: true },
      { name: "✅ Vendas Hoje", value: `${vendasHoje?.c || 0} — R$ ${Number(vendasHoje?.total || 0).toFixed(2)}`, inline: true },
      { name: "💰 Total Vendas", value: `${totalVendas?.c || 0} — R$ ${Number(totalVendas?.total || 0).toFixed(2)}`, inline: true },
    ])
    .setDescription(
      config.products?.map(p =>
        `> **${p.name}** — Estoque: \`${p.stock}\` | R$ ${Number(p.price).toFixed(2)} ${p.stock === 0 ? "⚠️ **SEM ESTOQUE**" : p.stock < 5 ? "⚠️ Baixo" : "✅"}`
      ).join("\n") || "Sem produtos"
    )
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • logs-relatorio`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  await editOrSend(client, "relatorio", embed, "relatorio_geral");
}

module.exports = {
  logSistema,
  logVenda,
  logComprovante,
  logPedido,
  logTicketCriado,
  logSeguranca,
  logFeedback,
  logVendaSite,
  logRelatorio,
  LOG_CHANNELS,
};
