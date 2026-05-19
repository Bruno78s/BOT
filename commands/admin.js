const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
const { getSettings, upsertSettings } = require("../utils/settings");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Painel administrativo para gerenciar produtos e configurações")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction, config) {
    const settings = await getSettings(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${config.botName} | Painel Administrativo`)
      .setDescription([
        "Selecione uma opção abaixo para gerenciar:",
        "",
        "**Produtos:** Gerenciar estoque, preços e informações",
        "**Pagamentos:** Ver e gerenciar pagamentos e pedidos",
        "**Cupons:** Criar e gerenciar cupons de desconto",
        "**Invites:** Ranking e reset de convites",
        "**Configurações:** Atualizar canais e IDs"
      ].join("\n"))
      .setFooter({ 
        text: "Bzn X • Admin"
      })
      .setTimestamp()
      .addFields([
        {
          name: "Produtos Disponíveis",
          value: config.products.map(p => `• ${p.name} (Estoque: ${p.stock})`).join("\n").substring(0, 1000),
          inline: false
        }
      ]);

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("admin_menu")
        .setPlaceholder("Selecione uma opção...")
        .addOptions([
          {
            label: "Gerenciar Produtos",
            description: "Editar estoque, preços e informações",
            value: "admin_products"
          },
          {
            label: "Gerenciar Pagamentos",
            description: "Ver e gerenciar pagamentos e pedidos",
            value: "admin_payments"
          },
          {
            label: "Gerenciar Cupons",
            description: "Criar e gerenciar cupons de desconto",
            value: "admin_coupons"
          },
          {
            label: "Gerenciar Invites",
            description: "Ranking, consulta e reset de convites",
            value: "admin_invites"
          },
          {
            label: "Configurações",
            description: "Atualizar canais e IDs do sistema",
            value: "admin_settings"
          }
        ])
    );

    await interaction.reply({ 
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  }
};
