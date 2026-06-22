/**
 * Handler de Vendas — carrinho, pagamento, cupons (contexto de compra), pedidos
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require("discord.js");
const { infoEmbed, successEmbed, dangerEmbed } = require("../utils/embeds");
const { createTicket, listTicketByChannel } = require("../utils/tickets");
const { logToDb } = require("../utils/logger");
const { notifySale } = require("../utils/notifications");
const { logTicketEvent } = require("../utils/advancedLogger");
const { buildCartEmbed, buildTermsEmbed, formatPrice, buildTermsSnapshot } = require("../utils/salesFlow");
const { createCheckoutPayment, getPendingPaymentByChannel } = require("../utils/mercadoPago");
const { get, run } = require("../database/db");
const { validateCoupon, calculateDiscount, useCoupon } = require("../utils/coupons");
const { logPedido } = require("../utils/channelLogger");
const { getSettings } = require("../utils/settings");
const { createReceiptAttachment } = require("../utils/receipt");
const { sendPurchaseAuditLog } = require("./shared");

const PIX_EXPIRY_MS = 15 * 60 * 1000;

function formatPixTimeout(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatPixDeadline(timestamp) {
  return new Date(timestamp).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function buildPixDescription({ interaction, product, coupon, discount, finalPrice, checkout, pixCountdownLabel, pixDeadlineLabel }) {
  return [
    `> 👤 **Cliente:** <@${interaction.user.id}>`,
    `> 📦 **Produto:** ${product.name}`,
    coupon ? `> 🏷️ **Desconto:** ${formatPrice(discount)} (cupom **${coupon.code.toUpperCase()}**)` : null,
    `> 💰 **Valor:** ${formatPrice(finalPrice)}`,
    checkout.checkoutUrl ? `> 🔗 **Link PIX:** [Clique aqui](${checkout.checkoutUrl})` : null,
    `> ⏱️ **Timeout do PIX:** ${pixCountdownLabel}`,
    `> ⏰ **Válido até:** ${pixDeadlineLabel}`,
    "",
    "─────────────────────────────",
    "",
    checkout.copyPasteCode
      ? `📋 **Copia e Cola PIX:**\n\`\`\`\n${checkout.copyPasteCode}\n\`\`\``
      : null,
    "",
    "─────────────────────────────",
    "",
    "> ⏳ **Status:** Aguardando pagamento via PIX...",
    `> ⏱️ **Tempo restante:** ${pixCountdownLabel}`,
    "> ✅ A confirmação será **automática** assim que o pagamento for identificado.",
    "> 📬 Após isso, seu pedido seguirá para entrega ou ticket de atendimento.",
  ].filter(Boolean).join("\n");
}

function buildPixEmbed({ interaction, config, description, qrCodeAttached }) {
  const embed = new EmbedBuilder()
    .setColor(0x00b4d8)
    .setAuthor({ name: `${config.botName} • Pagamento`, iconURL: interaction.client.user.displayAvatarURL() })
    .setTitle("💳 Pagamento via PIX")
    .setDescription(description)
    .setFooter({ text: `${config.botName} • Pagamento 100% seguro.`, iconURL: interaction.client.user.displayAvatarURL() })
    .setTimestamp();

  if (qrCodeAttached) {
    embed.setImage("attachment://pix-qrcode.png");
  }

  return embed;
}

function buildPaymentFallbackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("select_payment_gateway_menu")
      .setLabel("Tentar PIX novamente")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cart_manual_payment")
      .setLabel("Pagamento manual")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ticket_cancel_purchase")
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Danger)
  );
}

function startPixCountdown({ message, interaction, config, product, coupon, discount, finalPrice, checkout, paymentId, pixExpiresAt, qrCodeAttached, row }) {
  const updateCountdown = async () => {
    const remainingMs = Math.max(0, pixExpiresAt - Date.now());
    const countdownLabel = formatPixTimeout(remainingMs);
    const pixDeadlineLabel = formatPixDeadline(pixExpiresAt);
    const payment = await get("SELECT status FROM payments WHERE id = ?", [paymentId]);

    if (!message.editable || !payment || payment.status !== "pending" || remainingMs <= 0) {
      clearInterval(intervalId);
      return;
    }

    const description = buildPixDescription({
      interaction,
      product,
      coupon,
      discount,
      finalPrice,
      checkout,
      pixCountdownLabel: countdownLabel,
      pixDeadlineLabel
    });

    await message.edit({
      embeds: [buildPixEmbed({ interaction, config, description, qrCodeAttached })],
      components: [row]
    }).catch(() => {
      clearInterval(intervalId);
    });
  };

  const intervalId = setInterval(() => {
    updateCountdown().catch(() => {
      clearInterval(intervalId);
    });
  }, 1000);
}

async function handleProductSelect(interaction, config) {
  await interaction.deferReply({ ephemeral: true });
  
  const productId = interaction.values[0].replace("cart_start_", "");
  const settings = await getSettings(interaction.guild.id) || {};
  const product = config.products.find((p) => p.id === productId);

  if (!product) {
    return interaction.editReply({
      embeds: [dangerEmbed(config, "Produto não encontrado", "Este produto não está disponível no momento.")]
    });
  }

  if (product.stock <= 0) {
    return interaction.editReply({
      embeds: [dangerEmbed(config, "Produto esgotado", "Este produto está temporariamente sem estoque.")]
    });
  }

  const result = await createTicket({
    guild: interaction.guild,
    member: interaction.member,
    type: "sales",
    config,
    settings,
    productId
  });

  if (result.error) {
    return interaction.editReply({
      embeds: [dangerEmbed(config, "Carrinho não criado", result.error)]
    });
  }

  await interaction.editReply({
    embeds: [successEmbed(config, "Carrinho criado", `Acesse seu carrinho em ${result.channel}.`)]
  });

  await logToDb(interaction.guild.id, "info", "Carrinho criado", {
    channelId: result.channel.id,
    userId: interaction.user.id,
    productId
  });

  await logTicketEvent(interaction.client, config, "Carrinho Criado", result.channel.id, {
    description: `Carrinho criado por ${interaction.user.tag}.`,
    fields: [
      { name: "Canal", value: `<#${result.channel.id}>`, inline: true },
      { name: "Usuario", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Produto", value: product.name, inline: true },
      { name: "Valor", value: formatPrice(product.price), inline: true }
    ]
  });

  await notifySale(interaction.client, config, product, interaction.guild, interaction.user.id);
}

async function handleSupportTicketSelect(interaction, config) {
  await interaction.deferReply({ ephemeral: true });
  
  const reasonMap = {
    support: "suporte",
    service_issue: "problema-servico"
  };
  const reason = reasonMap[interaction.values[0]] || "suporte";
  const settings = await getSettings(interaction.guild.id) || {};

  const result = await createTicket({
    guild: interaction.guild,
    member: interaction.member,
    type: "support",
    config,
    settings,
    productId: null,
    reason
  });

  if (result.error) {
    return interaction.editReply({
      embeds: [dangerEmbed(config, "Ticket não criado", result.error)]
    });
  }

  await interaction.editReply({
    embeds: [successEmbed(config, "Ticket criado", `Acesse seu atendimento em ${result.channel}.`)]
  });

  await logTicketEvent(interaction.client, config, "Ticket de Suporte Criado", result.channel.id, {
    description: `Ticket criado por ${interaction.user.tag}.`,
    fields: [
      { name: "Canal", value: `<#${result.channel.id}>`, inline: true },
      { name: "Usuario", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Motivo", value: reason, inline: true }
    ]
  });
}

async function handlePaymentGatewaySelect(interaction, config) {
  await interaction.deferReply({ ephemeral: true });

  const ticket = await listTicketByChannel(interaction.channel.id);
  const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
  if (!product) {
    return interaction.editReply({
      embeds: [dangerEmbed(config, "Produto nao encontrado", "Nao foi possivel identificar o produto deste carrinho.")],
      components: []
    });
  }

  let coupon = null;
  let discount = 0;
  let finalPrice = product.price;

  if (ticket.coupon_id) {
    coupon = await get("SELECT * FROM coupons WHERE id = ?", [ticket.coupon_id]);
    if (coupon) {
      discount = calculateDiscount(product.price, coupon);
      finalPrice = Math.round((product.price - discount) * 100) / 100;
    }
  }

  let checkout = null;

  try {
    checkout = await createCheckoutPayment({
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      userId: interaction.user.id,
      product: { ...product, price: finalPrice },
      user: interaction.user
    });
  } catch (error) {
    console.error(`Erro ao criar pagamento:`, error.response?.data || error);
    const errorDescription = error?.message || error?.error || error?.cause?.[0]?.description || error?.response?.data?.errors?.[0]?.description || "Erro desconhecido";
    return interaction.editReply({
      embeds: [dangerEmbed(config, "Pagamento indisponivel", `Nao foi possivel gerar o pagamento automatico agora.\n\nDetalhe: ${errorDescription}\n\nVoce pode tentar novamente ou solicitar pagamento manual com a equipe.`)],
      components: [buildPaymentFallbackRow()]
    });
  }

  if (coupon) {
    await useCoupon(coupon.id);
  }

  const localPaymentRecord = await getPendingPaymentByChannel(interaction.channel.id);
  await logPedido(interaction.client, config, {
    userId: interaction.user.id,
    productName: product.name,
    amount: finalPrice,
    orderId: localPaymentRecord?.id || "?",
    channelId: interaction.channel.id,
  }).catch(() => null);

  const files = [];
  let qrCodeAttached = false;
  if (checkout.qrCodeBase64) {
    const qrBuffer = Buffer.from(checkout.qrCodeBase64, "base64");
    files.push(new AttachmentBuilder(qrBuffer, { name: "pix-qrcode.png" }));
    qrCodeAttached = true;
  }

  const pixExpiresAt = Date.now() + PIX_EXPIRY_MS;
  const pixTimeoutLabel = formatPixTimeout(PIX_EXPIRY_MS);
  const pixDeadlineLabel = formatPixDeadline(pixExpiresAt);
  const description = buildPixDescription({
    interaction,
    product,
    coupon,
    discount,
    finalPrice,
    checkout,
    pixCountdownLabel: pixTimeoutLabel,
    pixDeadlineLabel
  });
  const paymentEmbed = buildPixEmbed({ interaction, config, description, qrCodeAttached });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_cancel_purchase")
      .setLabel("\u274C Cancelar Pedido")
      .setStyle(ButtonStyle.Danger)
  );

  const receiptFile = await createReceiptAttachment({
    botName: config.botName,
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    user: interaction.user,
    product,
    amount: finalPrice,
    paymentMethod: checkout.method === "pix" ? "PIX Mercado Pago" : "Mercado Pago",
    checkoutUrl: checkout.checkoutUrl,
    providerPaymentId: checkout.paymentId || checkout.preferenceId || String(localPaymentRecord?.id || ""),
    coupon,
    orderId: localPaymentRecord?.id || checkout.paymentId || checkout.preferenceId || Date.now()
  });

  files.push(receiptFile);

  await interaction.editReply({ content: "✅ PIX gerado! Veja abaixo. Comprovante em anexo.", ephemeral: true });

  const paymentMessage = await interaction.channel.send({
    embeds: [paymentEmbed],
    components: [row],
    files
  });

  if (localPaymentRecord?.id) {
    startPixCountdown({
      message: paymentMessage,
      interaction,
      config,
      product,
      coupon,
      discount,
      finalPrice,
      checkout,
      paymentId: localPaymentRecord.id,
      pixExpiresAt,
      qrCodeAttached,
      row
    });
  }
}


async function handleCouponModal(interaction, config) {
  await interaction.deferReply({ ephemeral: true });
  const couponCode = interaction.fields.getTextInputValue("coupon_code").trim();
  const ticket = await listTicketByChannel(interaction.channel.id);
  const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;

  if (!product) {
    return interaction.editReply({
      embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")]
    });
  }

  let discount = 0;
  let coupon = null;
  let finalPrice = product.price;

  if (couponCode) {
    const validation = await validateCoupon(interaction.guild.id, couponCode, product.price, product.id);

    if (!validation.valid) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Cupom inv\u00E1lido", validation.reason)]
      });
    }

    coupon = validation.coupon;
    discount = calculateDiscount(product.price, coupon);
    finalPrice = product.price - discount;
  }

  const gatewayRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("select_payment_gateway_menu")
      .setLabel("Gerar PIX")
      .setStyle(ButtonStyle.Success)
  );

  const description = coupon
    ? `Cupom **${coupon.code}** aplicado! Desconto de ${formatPrice(discount)}.`
    : "Nenhum cupom aplicado.";

  await interaction.editReply({
    embeds: [infoEmbed(config, "Gerar Pagamento", `Clique no botão abaixo para gerar o pagamento de **${product.name}**.\n\n${description}\n\n**Total:** ${formatPrice(finalPrice)} (${coupon ? `De ${formatPrice(product.price)}` : ""})`)],
    components: [gatewayRow]
  });

  if (coupon) {
    await run("UPDATE tickets SET coupon_id = ? WHERE channel_id = ?", [coupon.id, interaction.channel.id]);
  }
}

async function handleCartButtons(interaction, config) {
  const { customId } = interaction;

  if (customId === "cart_apply_coupon") {
    const modal = new ModalBuilder()
      .setCustomId("coupon_modal")
      .setTitle("Aplicar Cupom");

    const couponInput = new TextInputBuilder()
      .setCustomId("coupon_code")
      .setLabel("C\u00F3digo do cupom")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ex: DESCONTO10")
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(couponInput));
    await interaction.showModal(modal);
    return true;
  }

  if (customId === "select_payment_gateway_menu") {
    try {
      await handlePaymentGatewaySelect(interaction, config);
      return true;

    } catch (error) {
      console.error("[DEBUG] Erro no handler select_payment_gateway_menu:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply({ ephemeral: true });
      }
      if (interaction.deferred) {
        await interaction.editReply({ content: "\u274C Erro ao gerar pagamento. Tente novamente." });
      }
      return true;
    }
  }

  if (customId === "cart_manual_payment") {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await listTicketByChannel(interaction.channel.id);
    const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
    if (!ticket || !product) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Carrinho nao encontrado", "Nao foi possivel identificar este carrinho.")]
      });
    }

    const deliveryChannelId = product.category === "sites" ? config.deliveryChannels?.sites : config.deliveryChannels?.bots;
    const staffChannel = deliveryChannelId ? await interaction.client.channels.fetch(deliveryChannelId).catch(() => null) : null;
    const manualEmbed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle(`${config.botName} | Pagamento Manual Solicitado`)
      .setDescription([
        `Cliente: <@${interaction.user.id}>`,
        `Produto: **${product.name}**`,
        `Valor: **${formatPrice(product.price)}**`,
        `Carrinho: <#${interaction.channel.id}>`,
        "",
        "A equipe deve combinar o pagamento manual e confirmar a entrega pelo carrinho."
      ].join("\n"))
      .setTimestamp();

    if (staffChannel?.send) {
      await staffChannel.send({ embeds: [manualEmbed] }).catch(() => null);
    }

    await interaction.channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [infoEmbed(config, "Pagamento manual solicitado", "A equipe foi avisada. Aguarde instrucoes neste carrinho.")]
    });

    return interaction.editReply({
      embeds: [successEmbed(config, "Equipe avisada", "Solicitacao de pagamento manual enviada.")]
    });
  }

  if (customId === "cart_read_terms") {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await listTicketByChannel(interaction.channel.id);
    const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
    if (!product) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")]
      });
    }
    await interaction.editReply({
      embeds: [buildTermsEmbed(config, interaction.user, product)],
      ephemeral: true
    });
    return true;
  }

  if (customId === "cart_accept_terms") {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await listTicketByChannel(interaction.channel.id);
    console.log(`[CART] cart_accept_terms: channel=${interaction.channel.id}, ticket=${ticket ? `found (id=${ticket.id}, productId=${ticket.product_id})` : "NOT FOUND"}`);
    const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
    if (!product) {
      console.error(`[CART] Product not found: ticket=${ticket ? "exists" : "null"}, product_id=${ticket?.product_id}, config.products=${config.products?.length || 0}`);
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")],
        ephemeral: true
      });
    }

    const acceptedAt = Date.now();
    const termsSnapshot = buildTermsSnapshot(interaction.user, product);
    await run(
      "UPDATE tickets SET terms_accepted_at = ?, terms_snapshot = ? WHERE channel_id = ?",
      [acceptedAt, termsSnapshot, interaction.channel.id]
    );

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("cart_apply_coupon")
        .setLabel("Aplicar Cupom")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("select_payment_gateway_menu")
        .setLabel("Fazer Pagamento")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("ticket_cancel_purchase")
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Danger)
    );

    const cartEmbed = buildCartEmbed(config, interaction.user, product);
    cartEmbed.setDescription(
      `Termos aceitos em **${new Date(acceptedAt).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})}**.\n\n` +
      "Clique em **Fazer Pagamento** para gerar o PIX."
    );

    await interaction.message.edit({
      embeds: [cartEmbed],
      components: [confirmRow]
    });

    await interaction.editReply({
      content: "✅ Termos aceitos! Escolha a ação acima.",
      embeds: [],
      components: []
    });
    return true;
  }

  if (customId === "ticket_cancel_purchase") {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await listTicketByChannel(interaction.channel.id);
    const settings = await getSettings(interaction.guild.id) || {};
    const isSupportMember = settings.support_role_id && interaction.member.roles.cache.has(settings.support_role_id);

    if (!ticket) {
      await interaction.editReply({
        embeds: [dangerEmbed(config, "Carrinho não encontrado", "Não foi possível localizar este carrinho no banco de dados.")]
      });
      return true;
    }

    if (ticket.user_id !== interaction.user.id && !isSupportMember) {
      await interaction.editReply({
        embeds: [dangerEmbed(config, "Sem permissão", "Apenas o cliente deste carrinho ou um membro da equipe de suporte pode cancelar a compra.")]
      });
      return true;
    }

    const channel = interaction.channel;
    await channel.send({
      embeds: [dangerEmbed(config, "Compra cancelada", "Este carrinho será fechado em 3 segundos.")]
    });

    await interaction.editReply({
      embeds: [successEmbed(config, "Carrinho encerrado", "A compra foi cancelada com sucesso.")]
    });

    setTimeout(() => {
      channel.delete("Compra cancelada pelo cliente").catch(() => null);
    }, 3000);
    return true;
  }

  return false;
}

async function handleOrderButtons(interaction, config) {
  const { customId } = interaction;

  if (customId === "order_open_delivery_ticket") {
    await interaction.deferReply({ ephemeral: true });
    const payment = await get("SELECT * FROM payments WHERE channel_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1", [interaction.channel.id]);
    if (!payment) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Pedido n\u00E3o encontrado", "N\u00E3o foi poss\u00EDvel encontrar o pedido aprovado neste carrinho.")]
      });
    }

    const existingDeliveryTicket = await get("SELECT channel_id FROM tickets WHERE user_id = ? AND type = 'delivery' AND status = 'open' LIMIT 1", [interaction.user.id]);
    if (existingDeliveryTicket) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Ticket j\u00E1 existe", "Voc\u00EA j\u00E1 possui um ticket de entrega aberto: <#" + existingDeliveryTicket.channel_id + ">")]
      });
    }

    const result = await createTicket({
      guild: interaction.guild,
      member: interaction.member,
      type: "delivery",
      config,
      productId: payment.product_id,
      paymentId: payment.id
    });

    if (result.error) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Erro ao criar ticket", result.error)]
      });
    }

    await interaction.editReply({
      embeds: [successEmbed(config, "Ticket de entrega criado", "Seu ticket de entrega foi aberto: <#" + result.channel.id + ">")]
    });
    return true;
  }

  if (customId === "order_copy_summary") {
    await interaction.deferReply({ ephemeral: true });
    const payment = await get("SELECT * FROM payments WHERE channel_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1", [interaction.channel.id]);
    if (!payment) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Pedido n\u00E3o encontrado", "N\u00E3o foi poss\u00EDvel encontrar o pedido aprovado neste carrinho.")]
      });
    }

    const product = config.products.find(p => p.id === payment.product_id);
    const summary = [
      `ID do Pedido: #${payment.id}`,
      `Produto: ${product?.name || payment.product_id}`,
      `Valor: ${formatPrice(payment.amount)}`,
      `Pagamento: ${payment.provider_payment_id || payment.preference_id || "N/A"}`,
      `Data: ${new Date(payment.created_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`
    ].join("\n");

    await interaction.editReply({
      content: "\uD83D\uDCCB **Resumo do Pedido**\n```\n" + summary + "\n```"
    });
    return true;
  }

  if (customId === "order_close_cart") {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await listTicketByChannel(interaction.channel.id);
    if (!ticket || ticket.user_id !== interaction.user.id) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Sem permiss\u00E3o", "Apenas o cliente deste carrinho pode fechar o carrinho.")]
      });
    }

    const channel = interaction.channel;
    await channel.send({
      embeds: [dangerEmbed(config, "Carrinho fechado", "Este carrinho ser\u00E1 fechado em 3 segundos.")]
    });

    await interaction.editReply({
      embeds: [successEmbed(config, "Carrinho encerrado", "O carrinho foi fechado com sucesso.")]
    });

    setTimeout(() => {
      channel.delete("Carrinho fechado pelo cliente").catch(() => null);
    }, 3000);
    return true;
  }

  if (customId === "ticket_confirm_purchase") {
    await interaction.deferReply({ ephemeral: true });
    const pendingPayment = await getPendingPaymentByChannel(interaction.channel.id);
    if (pendingPayment) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Pagamento pendente", "Aguarde a confirma\u00E7\u00E3o autom\u00E1tica do PIX antes de finalizar a compra.")]
      });
    }

    const ticket = await listTicketByChannel(interaction.channel.id);
    const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
    const deliveryChannelId = product?.category === "sites" ? config.deliveryChannels?.sites : config.deliveryChannels?.bots;
    const deliveryChannel = deliveryChannelId ? await interaction.client.channels.fetch(deliveryChannelId).catch(() => null) : null;
    const channel = interaction.channel;

    await channel.send({
      content: "**Compra finalizada.** Sua solicita\u00E7\u00E3o foi registrada e a entrega ser\u00E1 acompanhada pela equipe."
    });

    if (deliveryChannel?.send && product) {
      await deliveryChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle(`${config.botName} | Compra Realizada`)
            .setDescription([
              `> **Cliente:** <@${ticket.user_id}>`,
              `> **Produto:** ${product.name}`,
              `> **Valor:** ${formatPrice(product.price)}`,
              `> **Canal:** <#${interaction.channel.id}>`
            ].join("\n"))
            .setTimestamp()
        ]
      });
    }

    await logTicketEvent(interaction.client, config, "Compra Finalizada", interaction.channel.id, {
      description: `Compra finalizada no canal ${interaction.channel.name}.`,
      fields: [
        { name: "Produto", value: product?.name || "N\u00E3o identificado", inline: true },
        { name: "Cliente", value: ticket?.user_id ? `<@${ticket.user_id}>` : "N\u00E3o identificado", inline: true },
        { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true }
      ]
    });

    await sendPurchaseAuditLog(interaction, config, ticket, product).catch((error) => {
      console.error("Erro ao enviar registro de compra:", error);
    });

    await interaction.editReply({
      embeds: [successEmbed(config, "Compra finalizada", "A entrega foi registrada no canal correto.")]
    });
    return true;
  }

  return false;
}

module.exports = {
  handleProductSelect,
  handleSupportTicketSelect,
  handlePaymentGatewaySelect,
  handleCouponModal,
  handleCartButtons,
  handleOrderButtons
};
