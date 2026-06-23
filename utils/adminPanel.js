const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");
const { get, run } = require("../database/db");

function getAdminStats(config) {
  const totalProducts = config.products.length;
  const lowStock = config.products.filter((product) => product.stock > 0 && product.stock < 5).length;
  const outOfStock = config.products.filter((product) => product.stock === 0).length;

  const stats = get(`
    SELECT
      (SELECT COUNT(*) FROM payments WHERE status = 'approved') as total_sales,
      (SELECT COUNT(*) FROM tickets WHERE status = 'open') as open_tickets,
      (SELECT COUNT(*) FROM payments WHERE DATE(created_at/1000, 'unixepoch') = DATE('now')) as today_sales
  `) || {};

  return {
    totalProducts,
    lowStock,
    outOfStock,
    totalSales: stats.total_sales || 0,
    openTickets: stats.open_tickets || 0,
    todaySales: stats.today_sales || 0
  };
}

function buildAdminHome(config) {
  const stats = getAdminStats(config);

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Painel Administrativo`)
    .setDescription([
      "📊 **Estatísticas**",
      `• Vendas hoje: **${stats.todaySales}**`,
      `• Total de vendas: **${stats.totalSales}**`,
      `• Tickets abertos: **${stats.openTickets}**`,
      "",
      "📦 **Produtos**",
      `• Total: **${stats.totalProducts}**`,
      `• Estoque baixo: **${stats.lowStock}**`,
      `• Sem estoque: **${stats.outOfStock}**`
    ].join("\n"))
    .setFooter({ text: "BznX • Admin" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("admin_menu")
      .setPlaceholder("⚙️ Selecione uma opção...")
      .addOptions([
        { label: "📦 Produtos", description: "Gerenciar estoque, preços e entrega", value: "admin_products" },
        { label: "💰 Pagamentos", description: "Ver pedidos e transações", value: "admin_payments" },
        { label: "📝 Cupons", description: "Criar e gerenciar cupons", value: "admin_coupons" },
        { label: "📨 Invites", description: "Ranking e ferramentas de convites", value: "admin_invites" },
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
