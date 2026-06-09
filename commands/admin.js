const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require("discord.js");
const { getSettings } = require("../utils/settings");
const { get } = require("../database/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Painel administrativo")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction, config) {
    const settings = await getSettings(interaction.guild.id);

    // Estatísticas rápidas
    const totalProducts = config.products.length;
    const lowStock = config.products.filter(p => p.stock > 0 && p.stock < 5).length;
    const outOfStock = config.products.filter(p => p.stock === 0).length;

    const stats = get(`
      SELECT 
        (SELECT COUNT(*) FROM payments WHERE status = 'approved') as total_sales,
        (SELECT COUNT(*) FROM tickets WHERE status = 'open') as open_tickets,
        (SELECT COUNT(*) FROM payments WHERE DATE(created_at/1000, 'unixepoch') = DATE('now')) as today_sales
    `);

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${config.botName} | Painel Administrativo`)
      .setDescription([
        "📊 **Estatísticas**",

        `├ Vendas hoje: **${stats?.today_sales || 0}**`,
        `├ Total vendas: **${stats?.total_sales || 0}**`,
        `├ Tickets abertos: **${stats?.open_tickets || 0}**`,
        "",
        "📦 **Produtos**",

        `├ Total: **${totalProducts}**`,
        `├ Estoque baixo: **${lowStock}**`,
        `└ Sem estoque: **${outOfStock}**`
      ].join("\n"))
      .setFooter({ text: "BznX • Admin" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("admin_menu")
        .setPlaceholder("Selecione uma opção...")
        .addOptions([
          { label: "📦 Produtos", description: "Gerenciar estoque e precos", value: "admin_products" },
          { label: "💰 Pagamentos", description: "Ver pedidos e transacoes", value: "admin_payments" },
          { label: "📝 Cupons", description: "Criar cupons de desconto", value: "admin_coupons" },
          { label: "📨 Invites", description: "Ranking de convites", value: "admin_invites" },
          { label: "🔧 Configuracoes", description: "Canais e IDs", value: "admin_settings" }
        ])
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: false
    });
  }
};
