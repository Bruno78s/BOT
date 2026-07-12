const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");
const { get, run, all } = require("../database/db");

function money(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}

function getAdminStats(config) {
  const totalProducts = config.products.length;
  const lowStock = config.products.filter((product) => product.stock > 0 && product.stock < 5).length;
  const outOfStock = config.products.filter((product) => product.stock === 0).length;

  const stats = get(`
    SELECT
      COUNT(*) as total_payments,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_payments,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_payments,
      SUM(CASE WHEN status IN ('rejected', 'cancelled', 'expired', 'problem') THEN 1 ELSE 0 END) as failed_payments,
      SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as total_revenue,
      SUM(CASE WHEN status = 'approved' AND DATE(created_at/1000, 'unixepoch') = DATE('now') THEN amount ELSE 0 END) as today_revenue,
      SUM(CASE WHEN status = 'approved' AND strftime('%Y-%m', created_at/1000, 'unixepoch') = strftime('%Y-%m', 'now') THEN amount ELSE 0 END) as month_revenue,
      SUM(CASE WHEN status = 'approved' AND DATE(created_at/1000, 'unixepoch') = DATE('now') THEN 1 ELSE 0 END) as today_sales,
      (SELECT COUNT(*) FROM tickets WHERE status = 'open') as open_tickets,
      (SELECT COUNT(*) FROM tickets WHERE status = 'open' AND internal_status = 'waiting_customer') as waiting_customer,
      (SELECT COUNT(*) FROM tickets WHERE status = 'open' AND internal_status = 'waiting_staff') as waiting_staff,
      (SELECT COUNT(*) FROM moderation_strikes WHERE active = 1) as active_strikes,
      (SELECT COUNT(*) FROM customer_profiles) as customers
    FROM payments
  `) || {};

  const topProducts = all(`
    SELECT product_id, COUNT(*) as sold, SUM(amount) as revenue
    FROM payments
    WHERE status = 'approved'
    GROUP BY product_id
    ORDER BY sold DESC, revenue DESC
    LIMIT 3
  `);

  return {
    totalProducts,
    lowStock,
    outOfStock,
    totalPayments: stats.total_payments || 0,
    approvedPayments: stats.approved_payments || 0,
    pendingPayments: stats.pending_payments || 0,
    failedPayments: stats.failed_payments || 0,
    totalRevenue: stats.total_revenue || 0,
    todayRevenue: stats.today_revenue || 0,
    monthRevenue: stats.month_revenue || 0,
    todaySales: stats.today_sales || 0,
    openTickets: stats.open_tickets || 0,
    waitingCustomer: stats.waiting_customer || 0,
    waitingStaff: stats.waiting_staff || 0,
    activeStrikes: stats.active_strikes || 0,
    customers: stats.customers || 0,
    topProducts
  };
}

function formatTopProducts(config, rows) {
  if (!rows.length) return "Nenhuma venda aprovada ainda.";
  return rows.map((row, index) => {
    const product = config.products.find((item) => item.id === row.product_id);
    return `${index + 1}. **${product?.name || row.product_id}** - ${row.sold} venda(s), ${money(row.revenue)}`;
  }).join("\n");
}

function buildAdminHome(config) {
  const stats = getAdminStats(config);

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Painel Administrativo`)
    .setDescription("Visão operacional da loja, pagamentos, tickets e estoque.")
    .addFields([
      {
        name: "💰 Vendas",
        value: [
          `Hoje: **${stats.todaySales}** (${money(stats.todayRevenue)})`,
          `Mês: **${money(stats.monthRevenue)}**`,
          `Total: **${money(stats.totalRevenue)}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "💳 Pagamentos",
        value: [
          `Aprovados: **${stats.approvedPayments}**`,
          `Pendentes: **${stats.pendingPayments}**`,
          `Falhas/problemas: **${stats.failedPayments}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "🎫 Tickets",
        value: [
          `Abertos: **${stats.openTickets}**`,
          `Aguardando cliente: **${stats.waitingCustomer}**`,
          `Aguardando staff: **${stats.waitingStaff}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "🛡️ Segurança",
        value: [
          `Automod: **${config.automod?.enabled === false ? "off" : "on"}**`,
          `Strikes ativos: **${stats.activeStrikes}**`,
          `Clientes: **${stats.customers}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "📦 Estoque",
        value: [
          `Produtos: **${stats.totalProducts}**`,
          `Estoque baixo: **${stats.lowStock}**`,
          `Esgotados: **${stats.outOfStock}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "🏆 Mais vendidos",
        value: formatTopProducts(config, stats.topProducts),
        inline: false
      }
    ])
    .setFooter({ text: "BznX • Admin" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("admin_menu")
      .setPlaceholder("⚙️ Selecione uma opção...")
      .addOptions([
        { label: "📦 Produtos", description: "Gerenciar estoque, preços e entrega", value: "admin_products" },
        { label: "💰 Pagamentos", description: "Ver pedidos, transações e financeiro", value: "admin_payments" },
        { label: "📝 Cupons", description: "Criar e gerenciar cupons inteligentes", value: "admin_coupons" },
        { label: "📨 Invites", description: "Ranking e ferramentas de convites", value: "admin_invites" },
        { label: "🛡️ Segurança", description: "Automod, strikes e permissões", value: "admin_security" },
        { label: "👥 Clientes", description: "Perfis, histórico e exportação", value: "admin_customers" },
        { label: "⚙️ Operações", description: "Status, sync, presença e configurações", value: "admin_settings" }
      ])
  );

  return { embeds: [embed], components: [row] };
}

async function upsertAdminPanel(interaction, config) {
  const payload = buildAdminHome(config);
  const stored = get("SELECT channel_id, message_id FROM panel_messages WHERE guild_id = ? AND type = ?", [interaction.guild.id, "admin"]);

  if (stored?.channel_id && stored?.message_id) {
    const channel = await interaction.client.channels.fetch(stored.channel_id).catch(() => null);
    const message = channel?.messages ? await channel.messages.fetch(stored.message_id).catch(() => null) : null;
    if (message) {
      await message.edit(payload);
      return { message, updated: true };
    }
  }

  const reply = await interaction.reply({ ...payload, fetchReply: true });
  run(
    "INSERT INTO panel_messages (guild_id, type, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, type) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at",
    [interaction.guild.id, "admin", interaction.channel.id, reply.id, Date.now()]
  );

  return { message: reply, updated: false };
}

module.exports = {
  buildAdminHome,
  upsertAdminPanel
};
