/**
 * Handler Admin — painel admin, produtos, pagamentos, cupons, invites, settings
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { infoEmbed, successEmbed, dangerEmbed } = require("../utils/embeds");
const { getSettings, upsertSettings } = require("../utils/settings");
const { isAdmin } = require("../utils/permissions");
const { get, run, all } = require("../database/db");
const { readConfigFile, writeConfigFile, formatPrice } = require("../utils/salesFlow");
const { listCoupons, createCoupon, deleteCoupon, validateCoupon, calculateDiscount } = require("../utils/coupons");
const { getInviteStats, getInviteLeaderboard, getRedeemableInvites, setRedeemedInvites } = require("../utils/invites");
const { parsePriceInput, getCurrentProducts, buildProductAdminView, buildProductBackRow, buildMainMenuBackRow } = require("./shared");

async function handleAdminMenu(interaction, config) {
  const settings = await getSettings(interaction.guild.id);
  if (!isAdmin(interaction.member, settings)) {
    return interaction.reply({
      embeds: [dangerEmbed(config, "Acesso negado", "Apenas administradores podem usar este menu.")],
      ephemeral: true
    });
  }

  const selectedValue = interaction.values[0];

  if (selectedValue === "admin_products") {
    const { embed, components } = buildProductAdminView(config);
    return interaction.update({ embeds: [embed], components });
  }

  if (selectedValue === "admin_payments") {
    const payments = await all("SELECT * FROM payments WHERE guild_id = ? ORDER BY created_at DESC LIMIT 25", [interaction.guild.id]);
    const stats = await get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='approved' THEN amount ELSE 0 END) as receita,
        SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as aprovados,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pendentes
      FROM payments WHERE guild_id = ?`, [interaction.guild.id]);

    if (!payments || payments.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("\uD83D\uDCB0 Hist\u00F3rico de Pagamentos")
        .setDescription("> Nenhum pagamento encontrado.");
      return interaction.update({ embeds: [embed], components: [buildMainMenuBackRow()] });
    }

    const statusEmoji = { approved: "\u2705", pending: "\u23F3", rejected: "\u274C", cancelled: "\u26D4" };
    const paymentOptions = payments.slice(0, 25).map(p => ({
      label: `#${p.id} \u2014 ${formatPrice(p.amount)}`,
      description: `${statusEmoji[p.status] || "\u2B55"} ${p.status.toUpperCase()} | ${new Date(p.created_at).toLocaleDateString('pt-BR')} | <@${p.user_id}>`,
      value: `view_payment_${p.id}`
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("payment_menu")
        .setPlaceholder("Selecione um pagamento para detalhar...")
        .addOptions(paymentOptions)
    );

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("\uD83D\uDCB0 Hist\u00F3rico de Pagamentos")
      .setDescription("> \u00DAUltimos 25 pagamentos registrados.")
      .addFields([
        { name: "\u2705 Aprovados", value: `${stats?.aprovados || 0}`, inline: true },
        { name: "\u23F3 Pendentes", value: `${stats?.pendentes || 0}`, inline: true },
        { name: "\uD83D\uDCB5 Receita Total", value: formatPrice(stats?.receita || 0), inline: true },
      ])
      .setFooter({ text: `${config.botName} \u2022 Pagamentos` })
      .setTimestamp();

    return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
  }

  if (selectedValue === "admin_coupons") {
    const coupons = await listCoupons(interaction.guild.id);

    if (!coupons || coupons.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle(`${config.botName} | Cupons`)
        .setDescription("Nenhum cupom cadastrado.");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("add_coupon")
          .setLabel("Criar Cupom")
          .setStyle(ButtonStyle.Success)
      );

      return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
    }

    const couponOptions = coupons.slice(0, 25).map(c => ({
      label: `${c.code.toUpperCase()} - ${c.discount_type === 'percentage' ? c.discount_value + '%' : formatPrice(c.discount_value)}`,
      description: `Usos: ${c.used_count}/${c.max_uses || '\u221E'} | ${c.enabled ? '\u2705 Ativo' : '\u274C Inativo'} | ${c.product_id ? config.products.find(p => p.id === c.product_id)?.name || 'Produto espec\u00EDfico' : 'Todos os produtos'}`,
      value: `edit_coupon_${c.id}`
    }));

    couponOptions.push({
      label: "Criar Novo Cupom",
      description: "Criar um novo cupom de desconto",
      value: "add_new_coupon"
    });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("coupon_menu")
        .setPlaceholder("Selecione um cupom...")
        .addOptions(couponOptions)
    );

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${config.botName} | Cupons`)
      .setDescription(`Total de cupons: ${coupons.length}`);

    return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
  }

  if (selectedValue === "admin_invites") {
    return showInvitesPanel(interaction, config);
  }

  if (selectedValue === "admin_settings") {
    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${config.botName} | Configura\u00E7\u00F5es`)
      .setDescription([
        "> Escolha qual \u00E1rea deseja configurar.",
        "",
        "> **Canais:** atendimento, entregas, feedbacks e estat\u00EDsticas.",
      ].join("\n"));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_edit_channels")
        .setLabel("Editar Canais")
        .setStyle(ButtonStyle.Primary),
    );

    const restartRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_restart_bot")
        .setLabel("Reiniciar Bot")
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.update({ embeds: [embed], components: [row, restartRow, buildMainMenuBackRow()] });
  }
}

async function showInvitesPanel(interaction, config) {
  const leaderboard = await getInviteLeaderboard(interaction.guild.id, 10);
  const ranking = leaderboard.length
      ? leaderboard.map((row, index) => `${index + 1}. <@${row.user_id}> \u2022 Dispon\u00EDveis: **${getRedeemableInvites(row)}** \u2022 Total: **${row.total || 0}** \u2022 Fake: **${row.fake || 0}** \u2022 Saiu: **${row.left_count || 0}**`).join("\n")
    : "Nenhum convite registrado ainda.";

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Invites`)
    .setDescription([
      "> Ranking de convites v\u00E1lidos e ferramentas de reset.",
      "",
      ranking
    ].join("\n"));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_invites_view_user")
      .setLabel("Ver Invites de Usu\u00E1rio")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("admin_invites_detailed")
      .setLabel("Informa\u00E7\u00F5es Completas")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("admin_invites_set")
      .setLabel("Definir/Resetar")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
}

async function handleAdminButtons(interaction, config) {
  const { customId } = interaction;

  if (customId === "admin_main_back") {
    const adminMenuRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("admin_menu")
        .setPlaceholder("Selecione uma op\u00E7\u00E3o")
        .addOptions([
          { label: "📦 Produtos", description: "Gerenciar produtos", value: "admin_products" },
          { label: "💰 Pagamentos", description: "Ver pagamentos recentes", value: "admin_payments" },
          { label: "🏷️ Cupons", description: "Gerenciar cupons de desconto", value: "admin_coupons" },
          { label: "📨 Invites", description: "Ranking e ferramentas de invites", value: "admin_invites" },
          { label: "⚙️ Configura\u00E7\u00F5es", description: "Configurar canais e pagamento", value: "admin_settings" }
        ])
    );

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${config.botName} | Painel Admin`)
      .setDescription("Selecione uma op\u00E7\u00E3o abaixo para gerenciar o servidor.");

    return interaction.update({ embeds: [embed], components: [adminMenuRow] });
  }

  if (customId === "admin_products_back") {
    const { embed, components } = buildProductAdminView(config, "Selecione um produto para gerenciar ou cadastre um novo item.");
    return interaction.update({ embeds: [embed], components });
  }

  if (customId === "admin_invites") {
    return showInvitesPanel(interaction, config);
  }

  if (customId === "start_config") {
    const modal = new ModalBuilder()
      .setCustomId("initial_config_modal")
      .setTitle("Configura\u00E7\u00E3o Inicial");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("admin_role_id").setLabel("ID do Cargo de Administrador").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("support_role_id").setLabel("ID do Cargo de Suporte").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("sales_category_id").setLabel("ID da Categoria de Vendas").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("support_category_id").setLabel("ID da Categoria de Suporte").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("log_channel_id").setLabel("ID do Canal de Logs").setStyle(TextInputStyle.Short).setRequired(true)
      )
    );

    return interaction.showModal(modal);
  }


  if (customId === "admin_edit_channels") {
    const modal = new ModalBuilder()
      .setCustomId("admin_channels_modal")
      .setTitle("Editar Canais");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("ticket_panel_channel_id").setLabel("Canal de atendimento").setStyle(TextInputStyle.Short).setValue(String(config.ticketPanelChannelId || "")).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("bot_delivery_channel_id").setLabel("Canal de entregas de bots").setStyle(TextInputStyle.Short).setValue(String(config.deliveryChannels?.bots || "")).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("site_delivery_channel_id").setLabel("Canal de entregas de sites").setStyle(TextInputStyle.Short).setValue(String(config.deliveryChannels?.sites || "")).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("feedback_channel_id").setLabel("Canal de feedbacks").setStyle(TextInputStyle.Short).setValue(String(config.feedbackChannelId || "")).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("stats_channel_id").setLabel("Canal de estat\u00EDsticas").setStyle(TextInputStyle.Short).setValue(String(config.statsChannelId || "")).setRequired(true)
      )
    );

    return interaction.showModal(modal);
  }

  if (customId === "admin_invites_view_user") {
    const leaderboard = await getInviteLeaderboard(interaction.guild.id, 25);
    if (!leaderboard || leaderboard.length === 0) {
      return interaction.reply({ embeds: [dangerEmbed(config, "Nenhum invite", "Nenhum convite registrado ainda.")], ephemeral: true });
    }

    const userOptions = leaderboard.map(row => ({
      label: `${interaction.guild.members.cache.get(row.user_id)?.user?.tag || row.user_id}`,
      description: `Total: ${row.total || 0} | Dispon\u00EDveis: ${getRedeemableInvites(row)}`,
      value: `invite_user_${row.user_id}`
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("invite_user_select").setPlaceholder("Selecione um usu\u00E1rio...").addOptions(userOptions)
    );

    const embed = new EmbedBuilder().setColor(config.colors.primary).setTitle(`${config.botName} | Selecionar Usu\u00E1rio`).setDescription("Selecione um usu\u00E1rio para ver seus invites.");
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (customId === "admin_invites_detailed") {
    const allJoins = await all("SELECT * FROM invite_joins WHERE guild_id = ? ORDER BY joined_at DESC", [interaction.guild.id]);
    if (!allJoins || allJoins.length === 0) {
      return interaction.reply({ embeds: [dangerEmbed(config, "Nenhum dado", "Nenhum convite registrado ainda.")], ephemeral: true });
    }

    const content = allJoins.map(join => {
      const user = interaction.guild.members.cache.get(join.user_id)?.user;
      const inviter = interaction.guild.members.cache.get(join.inviter_id)?.user;
      const joinedDate = new Date(join.joined_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
      const leftDate = join.left_at ? new Date(join.left_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}) : 'Ainda no servidor';
      return [
        `Usu\u00E1rio: ${user?.tag || join.user_id} (${join.user_id})`,
        `Convidado por: ${inviter?.tag || join.inviter_id || 'Desconhecido'} (${join.inviter_id || 'N/A'})`,
        `C\u00F3digo do invite: ${join.invite_code || 'N/A'}`,
        `Conta fake: ${join.is_fake ? 'Sim' : 'N\u00E3o'}`,
        `Entrou em: ${joinedDate}`,
        `Saiu em: ${leftDate}`,
        ''
      ].join('\n');
    }).join('\n');

    const chunks = content.match(/[\s\S]{1,1900}/g) || [];
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(config.colors.primary).setTitle(`${config.botName} | Informa\u00E7\u00F5es Completas de Invites`).setDescription(`Total de registros: ${allJoins.length}`)],
      ephemeral: true
    });
    for (const chunk of chunks) {
      await interaction.followUp({ content: chunk, ephemeral: true });
    }
    return;
  }

  if (customId === "admin_invites_set") {
    const modal = new ModalBuilder().setCustomId("admin_invites_set_modal").setTitle("Definir Invites Resetados");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("invite_user_id").setLabel("ID ou men\u00E7\u00E3o do usu\u00E1rio").setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("invite_amount").setLabel("Quantidade j\u00E1 resetada/resgatada").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Ex: 5"))
    );
    return interaction.showModal(modal);
  }

  if (customId === "admin_restart_bot") {
    const embed = new EmbedBuilder()
      .setColor(config.colors.danger)
      .setTitle(`${config.botName} | Reiniciar Bot`)
      .setDescription("> Confirme apenas se voc\u00EA estiver usando um gerenciador de processo.\n> Se o bot foi iniciado com `node .`, ele ser\u00E1 desligado e voc\u00EA precisar\u00E1 ligar manualmente.\n\n> Deseja reiniciar agora?")
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("admin_restart_confirm").setLabel("Confirmar Rein\u00EDcio").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("admin_restart_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  if (customId === "admin_restart_cancel") {
    return interaction.update({ embeds: [successEmbed(config, "Rein\u00EDcio cancelado", "Nenhuma a\u00E7\u00E3o foi executada.")], components: [] });
  }

  if (customId === "admin_restart_confirm") {
    await interaction.update({ embeds: [successEmbed(config, "Reiniciando", "O processo do bot ser\u00E1 encerrado em instantes.")], components: [] });
    setTimeout(() => { process.exit(0); }, 1500);
    return;
  }

  // Product buttons
  if (customId.startsWith("edit_product_price_")) {
    const productId = customId.replace("edit_product_price_", "");
    const product = config.products.find(p => p.id === productId);
    if (!product) return interaction.reply({ content: "Produto n\u00E3o encontrado", ephemeral: true });

    const modal = new ModalBuilder().setCustomId(`edit_product_modal_${productId}`).setTitle(`Editar ${product.name}`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product_price").setLabel("Pre\u00E7o (R$)").setStyle(TextInputStyle.Short).setValue(product.price.toString()).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product_stock").setLabel("Estoque").setStyle(TextInputStyle.Short).setValue(product.stock.toString()).setRequired(true))
    );
    return interaction.showModal(modal);
  }

  if (customId.startsWith("edit_product_delivery_")) {
    const productId = customId.replace("edit_product_delivery_", "");
    const product = config.products.find(p => p.id === productId);
    if (!product) return interaction.reply({ content: "Produto n\u00E3o encontrado", ephemeral: true });

    const modal = new ModalBuilder().setCustomId(`edit_delivery_modal_${productId}`).setTitle(`Entrega: ${product.name}`.slice(0, 45));
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("delivery_url").setLabel("Link de entrega (deixe vazio para remover)").setStyle(TextInputStyle.Paragraph).setValue(product.deliveryUrl || "").setRequired(false).setPlaceholder("https://drive.google.com/... ou link do produto")
      )
    );
    return interaction.showModal(modal);
  }

  if (customId.startsWith("delete_product_")) {
    const productId = customId.replace("delete_product_", "");
    const product = config.products.find(p => p.id === productId);
    if (!product) return interaction.reply({ content: "Produto n\u00E3o encontrado", ephemeral: true });

    const configData = readConfigFile();
    const productIndex = configData.products.findIndex(p => p.id === productId);
    if (productIndex === -1) return interaction.reply({ content: "Produto n\u00E3o encontrado", ephemeral: true });

    configData.products.splice(productIndex, 1);
    writeConfigFile(configData);

    await interaction.reply({
      embeds: [successEmbed(config, "Produto deletado", `Produto ${product.name} deletado com sucesso! O bot precisa ser reiniciado para aplicar as mudan\u00E7as. Clique em Voltar para editar outro produto.`)],
      ephemeral: true
    });
    return;
  }

  // Coupon buttons
  if (customId === "add_coupon") {
    return showCouponProductSelect(interaction, config);
  }

  if (customId.startsWith("toggle_coupon_")) {
    const couponId = customId.replace("toggle_coupon_", "");
    const coupon = await get("SELECT * FROM coupons WHERE id = ? AND guild_id = ?", [couponId, interaction.guild.id]);
    if (!coupon) return interaction.reply({ content: "Cupom n\u00E3o encontrado", ephemeral: true });

    const { updateCoupon } = require("../utils/coupons");
    await updateCoupon(couponId, { enabled: !coupon.enabled });

    await interaction.reply({
      embeds: [successEmbed(config, "Cupom atualizado", `Cupom **${coupon.code.toUpperCase()}** foi ${!coupon.enabled ? 'ativado' : 'desativado'}.`)],
      ephemeral: true
    });
    return;
  }

  if (customId.startsWith("delete_coupon_")) {
    const couponId = customId.replace("delete_coupon_", "");
    const coupon = await get("SELECT * FROM coupons WHERE id = ? AND guild_id = ?", [couponId, interaction.guild.id]);
    if (!coupon) return interaction.reply({ content: "Cupom n\u00E3o encontrado", ephemeral: true });

    await deleteCoupon(couponId);
    await interaction.reply({
      embeds: [successEmbed(config, "Cupom deletado", `Cupom **${coupon.code.toUpperCase()}** foi deletado.`)],
      ephemeral: true
    });
    return;
  }

  return false;
}

function showCouponProductSelect(interaction, config) {
  const productOptions = [{ label: "\uD83D\uDCE6 Todos os produtos", description: "Cupom v\u00E1lido para qualquer produto", value: "coupon_product_all" }];
  const bots = config.products.filter(p => p.category === "bots");
  const sites = config.products.filter(p => p.category === "sites");

  bots.forEach(p => { productOptions.push({ label: `\uD83E\uDD16 ${p.name} (${p.tier})`, description: `Bot - R$ ${p.price.toFixed(2)}`, value: `coupon_product_${p.id}` }); });
  sites.forEach(p => { productOptions.push({ label: `\uD83C\uDF10 ${p.name} (${p.tier})`, description: `Site - R$ ${p.price.toFixed(2)}`, value: `coupon_product_${p.id}` }); });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("coupon_product_select").setPlaceholder("Selecione o produto para o cupom...").addOptions(productOptions.slice(0, 25))
  );

  const embed = new EmbedBuilder().setColor(config.colors.primary).setTitle(`${config.botName} | Selecionar Produto`).setDescription("Escolha para qual produto o cupom ser\u00E1 v\u00E1lido.");
  return interaction.update({ embeds: [embed], components: [row] });
}

async function handleAdminSelectMenus(interaction, config) {
  const { customId, values } = interaction;

  if (customId === "invite_user_select") {
    const userId = values[0].replace("invite_user_", "");
    const stats = await getInviteStats(interaction.guild.id, userId);
    const joins = await all("SELECT * FROM invite_joins WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC", [interaction.guild.id, userId]);
    const member = interaction.guild.members.cache.get(userId);
    const user = member?.user;

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${config.botName} | Invites de ${user?.tag || userId}`)
      .setDescription([
        `> **Usu\u00E1rio:** ${user ? `<@${userId}>` : userId}`,
        `> **Total:** ${stats.total || 0}`,
        `> **Dispon\u00EDveis:** ${getRedeemableInvites(stats)}`,
        `> **Resgatados/Resetados:** ${stats.redeemed || 0}`,
        `> **Fake:** ${stats.fake || 0}`,
        `> **Saiu:** ${stats.left || 0}`,
        `> **Entrou v\u00E1lido:** ${stats.current || 0}`,
        "",
        `> **\u00DAltimas entradas (${joins.length} total):**`
      ].join("\n"));

    const recentJoins = joins.slice(0, 10).map((join, index) => {
      const joinedUser = interaction.guild.members.cache.get(join.user_id)?.user;
      const joinedDate = new Date(join.joined_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
      const leftDate = join.left_at ? new Date(join.left_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}) : 'Ainda no servidor';
      return `${index + 1}. ${joinedUser?.tag || join.user_id} - ${join.is_fake ? '\uD83D\uDEAB Fake' : '\u2705 V\u00E1lido'} - Entrou: ${joinedDate} - Saiu: ${leftDate}`;
    }).join("\n");

    embed.addFields({ name: "Hist\u00F3rico Recente", value: recentJoins || "Nenhuma entrada registrada" });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("admin_invites").setLabel("Voltar").setStyle(ButtonStyle.Secondary));
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (customId === "coupon_menu") {
    const selectedValue = values[0];
    if (selectedValue === "add_new_coupon") {
      return showCouponProductSelect(interaction, config);
    }
    if (selectedValue.startsWith("edit_coupon_")) {
      const couponId = selectedValue.replace("edit_coupon_", "");
      const coupon = await get("SELECT * FROM coupons WHERE id = ? AND guild_id = ?", [couponId, interaction.guild.id]);
      if (!coupon) return interaction.update({ content: "Cupom n\u00E3o encontrado", components: [] });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`toggle_coupon_${couponId}`).setLabel(coupon.enabled ? "Desativar" : "Ativar").setStyle(coupon.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`delete_coupon_${couponId}`).setLabel("Deletar").setStyle(ButtonStyle.Danger)
      );

      return interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Gerenciar Cupom`)
          .setDescription(`**C\u00F3digo:** ${coupon.code.toUpperCase()}\n**Tipo:** ${coupon.discount_type === 'percentage' ? 'Porcentagem' : 'Valor fixo'}\n**Desconto:** ${coupon.discount_type === 'percentage' ? coupon.discount_value + '%' : formatPrice(coupon.discount_value)}\n**Usos:** ${coupon.used_count}/${coupon.max_uses || '\u221E'}\n**Valor m\u00EDnimo:** ${coupon.min_amount ? formatPrice(coupon.min_amount) : 'N/A'}\n**Produto:** ${coupon.product_id ? config.products.find(p => p.id === coupon.product_id)?.name || 'Produto espec\u00EDfico' : 'Todos os produtos'}\n**Status:** ${coupon.enabled ? '\u2705 Ativo' : '\u274C Inativo'}`)],
        components: [row]
      });
    }
  }

  if (customId === "coupon_product_select") {
    const selectedValue = values[0];
    const productId = selectedValue === "coupon_product_all" ? "" : selectedValue.replace("coupon_product_", "");

    const modal = new ModalBuilder().setCustomId(`create_coupon_modal:${productId || "all"}`).setTitle("Criar Cupom");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("coupon_code").setLabel("C\u00F3digo do cupom").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Ex: PROMO10")),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("coupon_discount_type").setLabel("Tipo de desconto (percentage/fixed)").setStyle(TextInputStyle.Short).setRequired(true).setValue("percentage")),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("coupon_discount_value").setLabel("Valor do desconto").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Ex: 10 (para 10% ou R$ 10)")),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("coupon_max_uses").setLabel("M\u00E1ximo de usos (opcional)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Ex: 100")),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("coupon_min_amount").setLabel("Valor m\u00EDnimo (opcional)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Ex: 50"))
    );
    return interaction.showModal(modal);
  }

  if (customId === "payment_menu") {
    const paymentId = values[0].replace("view_payment_", "");
    const payment = await get("SELECT * FROM payments WHERE id = ?", [paymentId]);
    if (!payment) return interaction.update({ content: "Pagamento n\u00E3o encontrado", components: [] });

    const product = config.products.find(p => p.id === payment.product_id);
    const statusEmoji = payment.status === "approved" ? "\u2705" : payment.status === "pending" ? "\u23F3" : "\u274C";

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${config.botName} | Detalhes do Pedido #${payment.id}`)
      .setDescription([
        `> **Cliente:** <@${payment.user_id}>`,
        `> **Produto:** ${product?.name || payment.product_id}`,
        `> **Valor:** ${formatPrice(payment.amount)}`,
        `> **Gateway:** ${payment.provider}`,
        `> **Status:** ${statusEmoji} ${payment.status}`,
        `> **Pagamento ID:** ${payment.provider_payment_id || payment.preference_id || "N/A"}`,
        `> **Canal:** <#${payment.channel_id}>`,
        `> **Data:** ${new Date(payment.created_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`
      ].join("\n"));

    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("back_to_payments").setLabel("Voltar").setStyle(ButtonStyle.Secondary));
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (customId === "back_to_payments") {
    const payments = await all("SELECT * FROM payments WHERE guild_id = ? ORDER BY created_at DESC LIMIT 25", [interaction.guild.id]);
    if (!payments || payments.length === 0) {
      const embed = new EmbedBuilder().setColor(config.colors.primary).setTitle(`${config.botName} | Pagamentos`).setDescription("Nenhum pagamento encontrado.");
      return interaction.update({ embeds: [embed], components: [] });
    }

    const paymentOptions = payments.slice(0, 25).map(p => ({
      label: `Pedido #${p.id} - ${formatPrice(p.amount)}`,
      description: `${p.provider} | ${p.status} | ${new Date(p.created_at).toLocaleDateString('pt-BR')}`,
      value: `view_payment_${p.id}`
    }));

    const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("payment_menu").setPlaceholder("Selecione um pagamento...").addOptions(paymentOptions));
    const embed = new EmbedBuilder().setColor(config.colors.primary).setTitle(`${config.botName} | Pagamentos Recentes`).setDescription(`Total de pagamentos: ${payments.length}`);
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (customId === "product_menu") {
    const selectedValue = values[0];
    if (selectedValue === "add_new_product") {
      const modal = new ModalBuilder().setCustomId("add_product_modal").setTitle("Adicionar Produto");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product_name").setLabel("Nome do Produto").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product_price_stock").setLabel("Pre\u00E7o e Estoque (ex: 9.99 | 10)").setStyle(TextInputStyle.Short).setPlaceholder("9.99 | 10").setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product_category_tier").setLabel("Categoria e Tier (ex: bots | premium)").setStyle(TextInputStyle.Short).setPlaceholder("bots | premium").setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product_description").setLabel("Descri\u00E7\u00E3o").setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product_delivery_url").setLabel("Link de entrega (vazio = abre ticket)").setStyle(TextInputStyle.Short).setPlaceholder("https://... (opcional)").setRequired(false))
      );
      return interaction.showModal(modal);
    }

    if (selectedValue.startsWith("edit_product_")) {
      const productId = selectedValue.replace("edit_product_", "");
      const product = config.products.find(p => p.id === productId);
      if (!product) return interaction.update({ content: "Produto n\u00E3o encontrado", components: [] });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`edit_product_price_${productId}`).setLabel("Editar Pre\u00E7o/Estoque").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`edit_product_delivery_${productId}`).setLabel("Editar Entrega").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`delete_product_${productId}`).setLabel("Deletar Produto").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("admin_products_back").setLabel("Voltar").setStyle(ButtonStyle.Secondary)
      );

      const deliveryStatus = product.deliveryUrl ? `\u2705 Entrega autom\u00E1tica: [Link](${product.deliveryUrl})` : "\u274C Sem entrega autom\u00E1tica (abre ticket)";
      return interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Gerenciar Produto`)
          .setDescription(`Gerenciando: **${product.name}**\nPre\u00E7o: R$ ${product.price.toFixed(2)} | Estoque: ${product.stock}\nCategoria: ${product.category} | Tier: ${product.tier}\n\n\uD83D\uDCE6 ${deliveryStatus}`)],
        components: [row]
      });
    }
  }

  return false;
}

async function handleAdminModals(interaction, config) {
  const { customId } = interaction;

  if (customId === "initial_config_modal") {
    await upsertSettings(interaction.guild.id, {
      admin_role_id: interaction.fields.getTextInputValue("admin_role_id"),
      support_role_id: interaction.fields.getTextInputValue("support_role_id"),
      sales_category_id: interaction.fields.getTextInputValue("sales_category_id"),
      support_category_id: interaction.fields.getTextInputValue("support_category_id"),
      log_channel_id: interaction.fields.getTextInputValue("log_channel_id")
    });
    await interaction.reply({ content: "Configura\u00E7\u00E3o inicial realizada com sucesso! O bot agora est\u00E1 pronto para uso.", ephemeral: true });
    return true;
  }

  if (customId === "admin_invites_set_modal") {
    const userId = interaction.fields.getTextInputValue("invite_user_id").replace(/\D/g, "");
    const amount = Number(interaction.fields.getTextInputValue("invite_amount"));
    if (!userId || !Number.isInteger(amount) || amount < 0) {
      return interaction.reply({ embeds: [dangerEmbed(config, "Dados inv\u00E1lidos", "Informe um ID de usu\u00E1rio v\u00E1lido e uma quantidade positiva.")], ephemeral: true });
    }
    const stats = await setRedeemedInvites(interaction.guild.id, userId, amount);
    return interaction.reply({
      embeds: [successEmbed(config, "Invites ajustados", `Usu\u00E1rio: <@${userId}>\nDispon\u00EDveis agora: **${getRedeemableInvites(stats)}**\nTotal hist\u00F3rico: **${stats.total || 0}**`)],
      ephemeral: true
    });
  }

  if (customId === "add_product_modal") {
    const name = interaction.fields.getTextInputValue("product_name").trim();
    const priceStockRaw = interaction.fields.getTextInputValue("product_price_stock");
    const catTierRaw = interaction.fields.getTextInputValue("product_category_tier");
    const description = interaction.fields.getTextInputValue("product_description").trim();
    const deliveryUrl = interaction.fields.getTextInputValue("product_delivery_url")?.trim() || "";

    const [priceStr, stockStr] = priceStockRaw.split("|").map(s => s.trim());
    const price = parsePriceInput(priceStr);
    const stock = parseInt(stockStr);
    const [category, tier] = catTierRaw.split("|").map(s => s.trim().toLowerCase());

    if (!Number.isFinite(price) || price < 0 || Number.isNaN(stock) || stock < 0) {
      return interaction.reply({ embeds: [dangerEmbed(config, "Valor inv\u00E1lido", "Use formato: `9.99 | 10` para pre\u00E7o e estoque.")], ephemeral: true });
    }
    if (!category || !tier) {
      return interaction.reply({ embeds: [dangerEmbed(config, "Formato inv\u00E1lido", "Use formato: `bots | premium` para categoria e tier.")], ephemeral: true });
    }

    const group = name.toLowerCase().replace(/\s+(basic|premium|platinum|diamond|plus)$/i, "").replace(/\s+/g, "-");
    const newProduct = { id: name.toLowerCase().replace(/\s+/g, "-"), name, category, group, tier, channelId: interaction.channel.id, price, stock, description };
    if (deliveryUrl) newProduct.deliveryUrl = deliveryUrl;

    const configData = readConfigFile();
    configData.products.push(newProduct);
    writeConfigFile(configData);
    config.products.push({ ...newProduct });

    const deliveryInfo = deliveryUrl ? `\n\uD83D\uDCE6 Entrega autom\u00E1tica: \u2705` : `\n\uD83D\uDCE6 Entrega: Via ticket`;
    await interaction.reply({ embeds: [successEmbed(config, "Produto adicionado", `**${name}** criado com sucesso!\nPre\u00E7o: ${formatPrice(price)} | Estoque: ${stock}${deliveryInfo}`)], ephemeral: true });
    return true;
  }



  if (customId === "admin_channels_modal") {
    const configData = readConfigFile();
    configData.ticketPanelChannelId = interaction.fields.getTextInputValue("ticket_panel_channel_id");
    configData.deliveryChannels = {
      bots: interaction.fields.getTextInputValue("bot_delivery_channel_id"),
      sites: interaction.fields.getTextInputValue("site_delivery_channel_id")
    };
    configData.feedbackChannelId = interaction.fields.getTextInputValue("feedback_channel_id");
    configData.statsChannelId = interaction.fields.getTextInputValue("stats_channel_id");
    writeConfigFile(configData);
    await interaction.reply({ embeds: [successEmbed(config, "Canais atualizados", "Os canais principais foram salvos no config.json.")], ephemeral: true });
    return true;
  }

  if (customId.startsWith("edit_delivery_modal_")) {
    const productId = customId.replace("edit_delivery_modal_", "");
    const deliveryUrl = interaction.fields.getTextInputValue("delivery_url").trim();
    const configData = readConfigFile();
    const productIndex = configData.products.findIndex(p => p.id === productId);
    if (productIndex === -1) return interaction.reply({ content: "Produto n\u00E3o encontrado", ephemeral: true });

    if (deliveryUrl) { configData.products[productIndex].deliveryUrl = deliveryUrl; }
    else { delete configData.products[productIndex].deliveryUrl; }
    writeConfigFile(configData);

    const memProduct = config.products.find(p => p.id === productId);
    if (memProduct) { if (deliveryUrl) memProduct.deliveryUrl = deliveryUrl; else delete memProduct.deliveryUrl; }

    const status = deliveryUrl ? `\u2705 Entrega autom\u00E1tica configurada!\nLink: ${deliveryUrl}` : "\u274C Entrega autom\u00E1tica removida. O cliente abrir\u00E1 ticket de entrega.";
    await interaction.reply({ embeds: [successEmbed(config, "Entrega atualizada", `**${configData.products[productIndex].name}**\n\n${status}`)], ephemeral: true });
    return true;
  }

  if (customId.startsWith("edit_product_modal_")) {
    const productId = customId.replace("edit_product_modal_", "");
    const price = parsePriceInput(interaction.fields.getTextInputValue("product_price"));
    const stock = parseInt(interaction.fields.getTextInputValue("product_stock"));
    const configData = readConfigFile();
    const productIndex = configData.products.findIndex(p => p.id === productId);
    if (productIndex === -1) return interaction.reply({ content: "Produto n\u00E3o encontrado", ephemeral: true });

    if (!Number.isFinite(price) || price < 0 || Number.isNaN(stock) || stock < 0) {
      return interaction.reply({ embeds: [dangerEmbed(config, "Valor inv\u00E1lido", "Use um pre\u00E7o v\u00E1lido e um estoque v\u00E1lido.")], ephemeral: true });
    }

    configData.products[productIndex].price = price;
    configData.products[productIndex].stock = stock;
    writeConfigFile(configData);

    await interaction.reply({ embeds: [successEmbed(config, "Produto atualizado", `Pre\u00E7o: ${formatPrice(price)}, Estoque: ${stock}. Clique em Voltar para editar outro produto.`)], ephemeral: true });
    return true;
  }

  if (customId.startsWith("create_coupon_modal")) {
    try {
      const code = interaction.fields.getTextInputValue("coupon_code").trim();
      const discountType = interaction.fields.getTextInputValue("coupon_discount_type").trim();
      const discountValueStr = interaction.fields.getTextInputValue("coupon_discount_value").trim();
      const maxUses = interaction.fields.getTextInputValue("coupon_max_uses").trim();
      const minAmount = interaction.fields.getTextInputValue("coupon_min_amount").trim();
      const modalProductId = customId.includes(":") ? customId.split(":")[1] : "all";
      const productId = modalProductId === "all" ? "" : modalProductId;

      if (!["percentage", "fixed"].includes(discountType)) {
        return interaction.reply({ embeds: [dangerEmbed(config, "Tipo inv\u00E1lido", "O tipo deve ser 'percentage' ou 'fixed'.")], ephemeral: true });
      }

      const discountValue = parsePriceInput(discountValueStr.replace("%", ""));
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return interaction.reply({ embeds: [dangerEmbed(config, "Valor inv\u00E1lido", "O valor do desconto deve ser positivo.")], ephemeral: true });
      }

      const options = {};
      if (maxUses) { options.maxUses = parseInt(maxUses); if (Number.isNaN(options.maxUses) || options.maxUses <= 0) return interaction.reply({ embeds: [dangerEmbed(config, "Valor inv\u00E1lido", "O m\u00E1ximo de usos deve ser um n\u00FAmero positivo.")], ephemeral: true }); }
      if (minAmount) { options.minAmount = parsePriceInput(minAmount); if (!Number.isFinite(options.minAmount) || options.minAmount <= 0) return interaction.reply({ embeds: [dangerEmbed(config, "Valor inv\u00E1lido", "O valor m\u00EDnimo deve ser um n\u00FAmero positivo.")], ephemeral: true }); }
      if (productId) { const product = config.products.find(p => p.id === productId); if (!product) return interaction.reply({ embeds: [dangerEmbed(config, "Produto n\u00E3o encontrado", "O ID do produto informado n\u00E3o existe.")], ephemeral: true }); options.productId = productId; }

      await createCoupon(interaction.guild.id, code, discountType, discountValue, options);
      await interaction.reply({ embeds: [successEmbed(config, "Cupom criado", `Cupom **${code.toUpperCase()}** criado com sucesso!${productId ? ` V\u00E1lido para: ${config.products.find(p => p.id === productId)?.name || 'Produto espec\u00EDfico'}` : ' V\u00E1lido para todos os produtos'}`)], ephemeral: true });
      return true;
    } catch (error) {
      console.error("[Coupon] Erro ao criar cupom:", error);
      return interaction.reply({ embeds: [dangerEmbed(config, "Erro ao criar cupom", error.message || "Erro desconhecido.")], ephemeral: true });
    }
  }

  return false;
}

module.exports = {
  handleAdminMenu,
  handleAdminButtons,
  handleAdminSelectMenus,
  handleAdminModals
};
