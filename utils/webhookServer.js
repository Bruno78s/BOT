const express = require("express");
const crypto = require("crypto");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const {
  fetchPayment,
  attachProviderPaymentIdByReference,
  getPaymentByProviderPaymentId,
  getPendingPaymentByChannel,
  listPendingProviderPayments,
  updatePaymentStatusByProviderId
} = require("./mercadoPago");
const { formatPrice, readConfigFile, writeConfigFile } = require("./salesFlow");
const { logTicketEvent } = require("./advancedLogger");
const { logVenda, logComprovante, logPedido, logVendaSite } = require("./channelLogger");
const { ensureProductPanels } = require("./productPanels");
const { sendReceiptDM, sendReceiptToPrivateChannel } = require("./receipt");
const { useCoupon } = require("./coupons");
const { get, run } = require("../database/db");
const { getFulfillmentStatusLabel, getOrderCode } = require("./orders");
const { recordCustomerOrder, recordFailedPayment } = require("./customers");
const {
  constructStripeWebhookEvent,
  fetchCardCheckoutSession,
  getStripePaymentBySessionId,
  listPendingStripePayments,
  updateStripePaymentStatus
} = require("./stripePayments");

const processingPayments = new Set();

function decrementStock(config, productId) {
  try {
    const fileConfig = readConfigFile();
    const product = fileConfig.products.find(p => p.id === productId);
    if (product && product.stock > 0) {
      product.stock -= 1;
      writeConfigFile(fileConfig);
      const memProduct = config.products.find(p => p.id === productId);
      if (memProduct) memProduct.stock = product.stock;
      console.log(`[STOCK] ${product.name}: estoque atualizado para ${product.stock}`);
      return product.stock;
    }
    return product?.stock ?? 0;
  } catch (err) {
    console.error("[STOCK] Erro ao decrementar estoque:", err);
    return -1;
  }
}

async function sendClientDM(client, config, localPayment, product, orderId, paymentId) {
  try {
    const user = await client.users.fetch(localPayment.user_id).catch(() => null);
    if (!user) return { sent: false, dmChannelId: null };

    const hasAutoDelivery = !!product?.deliveryUrl;
    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel?.send) return { sent: false, dmChannelId: null };

    const dmEmbed = new EmbedBuilder()
      .setColor(0x00c853)
      .setAuthor({ name: `${config.botName} • Compra Confirmada`, iconURL: client.user.displayAvatarURL() })
      .setTitle("✅ Seu pagamento foi aprovado!")
      .setDescription([
        `> 📦 **Produto:** ${product?.name || localPayment.product_id}`,
        `> 💰 **Valor:** ${formatPrice(localPayment.amount)}`,
        `> 📋 **Pedido:** #${orderId}`,
        "",
        hasAutoDelivery
          ? "> 🚀 Seu produto foi entregue automaticamente! Confira abaixo:"
          : "> Volte ao servidor e clique em **Abrir Ticket de Entrega** para receber seu produto.",
      ].join("\n"))
      .setFooter({ text: `${config.botName} • Obrigado pela compra!` })
      .setTimestamp();

    if (hasAutoDelivery) {
      const deliveryEmbed = new EmbedBuilder()
        .setColor(0x1e88e5)
        .setTitle("📦 Entrega do Produto")
        .setDescription([
          `> **Produto:** ${product.name}`,
          `> **Link de acesso:**`,
          `> ${product.deliveryUrl}`,
          "",
          "⚠️ Este link é pessoal e intransferível.",
          "Em caso de problemas, abra um ticket de suporte no servidor.",
        ].join("\n"))
        .setFooter({ text: `${config.botName} • Entrega Automática` })
        .setTimestamp();

      await dmChannel.send({ embeds: [dmEmbed, deliveryEmbed] });
    } else {
      await dmChannel.send({ embeds: [dmEmbed] });
    }

    console.log(`[DM] Notificação enviada para ${user.tag} (entrega automática: ${hasAutoDelivery})`);
    return { sent: true, dmChannelId: dmChannel.id };
  } catch (err) {
    console.log(`[DM] Falha ao enviar DM para ${localPayment.user_id}:`, err.message);
    return { sent: false, dmChannelId: null };
  }
}

async function cleanupCartBotMessages(channel, client) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;

  const botMessages = messages.filter((message) => message.author?.id === client.user.id);
  for (const message of botMessages.values()) {
    await message.delete().catch(() => null);
  }
}

async function confirmApprovedPayment(client, config, paymentData, localPayment) {
  console.log("[WEBHOOK] confirmApprovedPayment chamado para canal:", localPayment.channel_id);
  const channel = await client.channels.fetch(localPayment.channel_id).catch(() => null);
  if (!channel?.send) {
    console.log("[WEBHOOK] Erro: canal não encontrado ou não pode enviar mensagens");
    return false;
  }

  const product = config.products.find((item) => item.id === localPayment.product_id);
  const coupon = localPayment.coupon_id ? get("SELECT * FROM coupons WHERE id = ?", [localPayment.coupon_id]) : null;
  const orderCode = getOrderCode(localPayment, product);
  const paymentId = paymentData.id;
  const paymentMethodLabel = localPayment.provider === "stripe" ? "Cartão" : "PIX Mercado Pago";
  const deliveryChannelId = product?.category === "sites" ? config.deliveryChannels?.sites : config.deliveryChannels?.bots;
  const deliveryChannel = deliveryChannelId ? await client.channels.fetch(deliveryChannelId).catch(() => null) : null;
  const hasAutoDelivery = !!product?.deliveryUrl;

  const remainingStock = decrementStock(config, localPayment.product_id);
  ensureProductPanels(client, config).catch((err) =>
    console.log("[WEBHOOK] Erro ao atualizar painéis:", err.message)
  );

  const dmResult = await sendClientDM(client, config, localPayment, product, orderCode, paymentId);
  const dmDelivered = dmResult.sent;
  const dmUrl = dmResult.dmChannelId
    ? `https://discord.com/channels/@me/${dmResult.dmChannelId}`
    : "https://discord.com/channels/@me";
  const fulfillmentStatus = hasAutoDelivery ? "delivered" : "preparing";

  await cleanupCartBotMessages(channel, client);

  const summaryEmbed = new EmbedBuilder()
    .setColor(0x00c853)
    .setAuthor({ name: `${config.botName} • Pagamento`, iconURL: client.user.displayAvatarURL() })
    .setTitle("✅ Pagamento Confirmado!")
    .setDescription([
      `> 👤 **Cliente:** <@${localPayment.user_id}>`,
      `> 📦 **Produto:** ${product?.name || localPayment.product_id}`,
      `> 💰 **Valor:** ${formatPrice(localPayment.amount)}`,
      `> 📝 **Pedido:** ${orderCode}`,
      `> 📋 **Pagamento:** \`${paymentId}\``,
      "",
      "─────────────────────────────",
      "",
      "> ✅ Seu pagamento foi **aprovado automaticamente**.",
      hasAutoDelivery
        ? `> 🚀 Seu produto foi **entregue por DM**.${dmDelivered ? " Verifique suas mensagens privadas." : " Caso a DM esteja fechada, abra um ticket de suporte."}`
        : "> 📦 Seu pedido foi registrado. Abra um ticket de entrega para receber seu produto."
    ].join("\n"))
    .setFooter({ text: `${config.botName} • Pedido Confirmado`, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();

  const buttons = [];
  if (hasAutoDelivery) {
    buttons.push(
      new ButtonBuilder()
        .setLabel("Abrir DM do bot")
        .setStyle(ButtonStyle.Link)
        .setURL(dmUrl)
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("order_open_delivery_ticket")
        .setLabel("Abrir Ticket de Entrega")
        .setStyle(ButtonStyle.Primary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId("order_close_cart")
      .setLabel("Fechar Carrinho")
      .setStyle(ButtonStyle.Danger)
  );

  console.log("[WEBHOOK] Enviando mensagem de pagamento aprovado para canal:", channel.id);
  await channel.send({
    content: `<@${localPayment.user_id}>`,
    embeds: [summaryEmbed],
    components: [new ActionRowBuilder().addComponents(...buttons)]
  });
  console.log("[WEBHOOK] Mensagem enviada com sucesso");

  try {
    const guild = channel.guild;
    const member = await guild.members.fetch(localPayment.user_id).catch(() => null);
    const clientRoleId = config.clientRoleId || process.env.DISCORD_CUSTOMER_ROLE_ID || process.env.CLIENT_ROLE_ID;
    if (!clientRoleId) {
      console.log("[WEBHOOK] Cargo de cliente nao configurado: defina DISCORD_CUSTOMER_ROLE_ID ou CLIENT_ROLE_ID.");
      return;
    }
    if (member && clientRoleId && !member.roles.cache.has(clientRoleId)) {
      await member.roles.add(clientRoleId);
      console.log(`[WEBHOOK] Cargo de cliente adicionado para ${member.user.tag}`);
    }
  } catch (err) {
    console.log("[WEBHOOK] Falha ao adicionar cargo de cliente:", err.message);
  }

  const receiptUser = await client.users.fetch(localPayment.user_id).catch(() => null);
  const receiptData = {
    guildId: channel.guild.id,
    channelId: localPayment.channel_id,
    user: receiptUser || { id: localPayment.user_id, tag: localPayment.user_id },
    userId: localPayment.user_id,
    product: product || { id: localPayment.product_id, name: localPayment.product_id },
    amount: localPayment.amount,
    paymentMethod: paymentMethodLabel,
    checkoutUrl: localPayment.checkout_url,
    providerPaymentId: paymentId,
    coupon,
    orderId: orderCode
  };

  await sendReceiptToPrivateChannel(client, config, receiptData, "PAGO").catch((error) => {
    console.error("[RECEIPT] Falha ao enviar comprovante aprovado:", error.message);
  });
  await sendReceiptDM(client, config, receiptData, "PAGO").catch(() => null);

  if (deliveryChannel?.send) {
    const deliveryType = hasAutoDelivery ? "✅ Automática (DM)" : "📋 Via Ticket";
    await deliveryChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c853)
          .setAuthor({ name: `${config.botName} • Entrega`, iconURL: client.user.displayAvatarURL() })
          .setTitle("✅ Entrega confirmada!")
          .addFields([
            { name: "👤 Cliente", value: `<@${localPayment.user_id}>`, inline: true },
            { name: "📦 Produto", value: product?.name || localPayment.product_id, inline: true },
            { name: "💰 Valor", value: formatPrice(localPayment.amount), inline: true },
            { name: "📋 Pedido", value: orderCode, inline: true },
            { name: "📦 Estoque", value: `${remainingStock >= 0 ? remainingStock : "?"} restantes`, inline: true },
            { name: "🚀 Entrega", value: deliveryType, inline: true }
          ])
          .setFooter({ text: `${config.botName} • Entrega`, iconURL: client.user.displayAvatarURL() })
          .setTimestamp()
      ]
    });
  }

  if (channel.deletable) {
    setTimeout(() => {
      channel.delete("Carrinho fechado automaticamente após pagamento confirmado").catch(() => null);
    }, 45000);
  }

  await logVenda(client, config, {
    userId: localPayment.user_id,
    productName: product?.name || localPayment.product_id,
    amount: localPayment.amount,
    orderId: orderCode,
    paymentId,
    channelId: localPayment.channel_id,
    coupon: coupon?.code ? coupon.code.toUpperCase() : null
  });

  await logComprovante(client, config, {
    userId: localPayment.user_id,
    productName: product?.name || localPayment.product_id,
    amount: localPayment.amount,
    orderId: orderCode,
    paymentId,
    channelId: localPayment.channel_id
  });

  await logTicketEvent(client, config, "Pagamento Aprovado", localPayment.channel_id, {
    description: `Pagamento aprovado automaticamente via ${paymentMethodLabel}.`,
    fields: [
      { name: "Cliente", value: `<@${localPayment.user_id}>`, inline: true },
      { name: "Produto", value: product?.name || localPayment.product_id, inline: true },
      { name: "Valor", value: formatPrice(localPayment.amount), inline: true },
      { name: "ID do Pedido", value: orderCode, inline: true }
    ]
  });

  run(
    "UPDATE payments SET order_code = ?, fulfillment_status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END WHERE id = ?",
    [orderCode, fulfillmentStatus, fulfillmentStatus, Date.now(), localPayment.id]
  );
  recordCustomerOrder({ ...localPayment, status: "approved", guild_id: channel.guild.id });

  return true;
}
function verifyWebhookSignature(req) {
  const secret = (process.env.MERCADO_PAGO_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;

  const xSignature = req.headers["x-signature"];
  const xRequestId = req.headers["x-request-id"];
  if (!xSignature || !xRequestId) return true;

  try {
    const dataId = req.body?.data?.id || req.query?.id;
    const parts = xSignature.split(",").reduce((acc, part) => {
      const [key, val] = part.trim().split("=");
      acc[key] = val;
      return acc;
    }, {});
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) return true;

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    if (expected !== v1) {
      console.log("[WEBHOOK] Assinatura nÃ£o confere (secret pode estar incorreto), aceitando mesmo assim");
    }
    return true;
  } catch {
    return true;
  }
}

const rateLimitMap = new Map();
function rateLimit(ip, maxRequests = 30, windowMs = 60000) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now - record.start > windowMs) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return true;
  }
  record.count++;
  return record.count <= maxRequests;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now - record.start > 120000) rateLimitMap.delete(ip);
  }
}, 60000);

async function processMercadoPagoPayment(client, config, paymentId, source = "webhook") {
  if (!paymentId) return false;
  const paymentKey = String(paymentId);

  if (processingPayments.has(paymentKey)) {
    console.log(`[MERCADO_PAGO] Pagamento ${paymentKey} ja esta em processamento (${source}).`);
    return false;
  }

  processingPayments.add(paymentKey);
  try {
    const paymentData = await fetchPayment(paymentKey);
    console.log(`[MERCADO_PAGO] ${source}: status=${paymentData.status}, id=${paymentData.id}, ref=${paymentData.external_reference || "sem-ref"}`);

    const channelId = paymentData.external_reference || paymentData.metadata?.channel_id;
    if (!channelId) {
      console.log(`[MERCADO_PAGO] ${source}: pagamento ${paymentData.id} sem external_reference/channel_id.`);
      return false;
    }

    await attachProviderPaymentIdByReference(channelId, paymentData.id, paymentData.status);
    let localPayment = await getPaymentByProviderPaymentId(paymentData.id);

    if (!localPayment) {
      console.log(`[MERCADO_PAGO] ${source}: pagamento nao encontrado por provider_payment_id, tentando channel_id=${channelId}.`);
      localPayment = await getPendingPaymentByChannel(channelId);
    }

    if (!localPayment) {
      console.log(`[MERCADO_PAGO] ${source}: pagamento ${paymentData.id} nao encontrado no banco local.`);
      return false;
    }

    if (paymentData.status === "approved" && localPayment.status === "approved") {
      console.log(`[MERCADO_PAGO] ${source}: pagamento ${paymentData.id} ja confirmado, ignorando duplicata.`);
      return true;
    }

    if (paymentData.status !== "approved") {
      const finalStatuses = new Set(["rejected", "cancelled", "canceled", "refunded", "charged_back"]);
      if (finalStatuses.has(paymentData.status)) {
        await updatePaymentStatusByProviderId(paymentData.id, paymentData.status);
        recordFailedPayment(localPayment);
      }
      console.log(`[MERCADO_PAGO] ${source}: pagamento ${paymentData.id} ainda esta como ${paymentData.status}.`);
      return false;
    }

    localPayment.provider_payment_id = String(paymentData.id);

    let retries = 0;
    const maxRetries = 3;
    while (retries < maxRetries) {
      try {
        const confirmed = await confirmApprovedPayment(client, config, paymentData, localPayment);
        if (confirmed === false) throw new Error("confirmacao local nao concluida");
        await updatePaymentStatusByProviderId(paymentData.id, "approved");
        run("UPDATE payments SET order_code = COALESCE(order_code, ?), fulfillment_status = COALESCE(NULLIF(fulfillment_status, 'awaiting_payment'), ?) WHERE id = ?", [getOrderCode(localPayment), "paid", localPayment.id]);
        if (localPayment.coupon_id) {
          await useCoupon(localPayment.coupon_id).catch((error) => console.error("[COUPON] Falha ao registrar uso:", error.message));
        }
        return true;
      } catch (err) {
        retries++;
        console.error(`[MERCADO_PAGO] ${source}: tentativa ${retries}/${maxRetries} falhou:`, err.message);
        if (retries < maxRetries) await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
      }
    }

    console.error(`[MERCADO_PAGO] ${source}: FALHA CRITICA ao confirmar pagamento ${paymentData.id} apos ${maxRetries} tentativas.`);
    return false;
  } finally {
    processingPayments.delete(paymentKey);
  }
}

async function processStripePayment(client, config, sessionId, source = "webhook") {
  if (!sessionId) return false;
  const paymentKey = `stripe:${sessionId}`;

  if (processingPayments.has(paymentKey)) {
    console.log(`[STRIPE] Sessao ${sessionId} ja esta em processamento (${source}).`);
    return false;
  }

  processingPayments.add(paymentKey);
  try {
    const session = await fetchCardCheckoutSession(sessionId);
    console.log(`[STRIPE] ${source}: session=${session.id}, status=${session.status}, payment_status=${session.payment_status}`);

    let localPayment = await getStripePaymentBySessionId(session.id);
    if (!localPayment) {
      console.log(`[STRIPE] ${source}: sessao ${session.id} nao encontrada no banco local.`);
      return false;
    }

    if (session.payment_status === "paid" && localPayment.status === "approved") {
      console.log(`[STRIPE] ${source}: pagamento ${session.id} ja confirmado, ignorando duplicata.`);
      return true;
    }

    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

    if (session.payment_status !== "paid") {
      if (session.status === "expired") {
        await updateStripePaymentStatus(session.id, "expired", paymentIntentId);
        recordFailedPayment(localPayment);
      }
      console.log(`[STRIPE] ${source}: pagamento ${session.id} ainda nao esta pago.`);
      return false;
    }

    localPayment.preference_id = paymentIntentId || localPayment.preference_id;

    let retries = 0;
    const maxRetries = 3;
    while (retries < maxRetries) {
      try {
        const confirmed = await confirmApprovedPayment(
          client,
          config,
          { id: session.id, status: "approved", payment_intent: paymentIntentId },
          localPayment
        );
        if (confirmed === false) throw new Error("confirmacao local nao concluida");
        await updateStripePaymentStatus(session.id, "approved", paymentIntentId);
        run("UPDATE payments SET order_code = COALESCE(order_code, ?), fulfillment_status = COALESCE(NULLIF(fulfillment_status, 'awaiting_payment'), ?) WHERE id = ?", [getOrderCode(localPayment), "paid", localPayment.id]);
        if (localPayment.coupon_id) {
          await useCoupon(localPayment.coupon_id).catch((error) => console.error("[COUPON] Falha ao registrar uso:", error.message));
        }
        return true;
      } catch (err) {
        retries++;
        console.error(`[STRIPE] ${source}: tentativa ${retries}/${maxRetries} falhou:`, err.message);
        if (retries < maxRetries) await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
      }
    }

    console.error(`[STRIPE] ${source}: FALHA CRITICA ao confirmar pagamento ${session.id} apos ${maxRetries} tentativas.`);
    return false;
  } finally {
    processingPayments.delete(paymentKey);
  }
}

function startPendingPaymentWatcher(client, config) {
  const intervalMs = Math.max(Number(process.env.MERCADO_PAGO_PENDING_CHECK_INTERVAL_MS || 30000), 15000);

  const runCheck = async () => {
    try {
      const pendingPayments = await listPendingProviderPayments(25);
      if (pendingPayments.length) {
        console.log(`[MERCADO_PAGO] Verificando ${pendingPayments.length} pagamento(s) pendente(s).`);
      }
      for (const payment of pendingPayments) {
        await processMercadoPagoPayment(client, config, payment.provider_payment_id, "polling");
      }

      const pendingStripePayments = await listPendingStripePayments(25);
      if (pendingStripePayments.length) {
        console.log(`[STRIPE] Verificando ${pendingStripePayments.length} pagamento(s) pendente(s).`);
      }
      for (const payment of pendingStripePayments) {
        await processStripePayment(client, config, payment.provider_payment_id, "polling");
      }
    } catch (error) {
      console.error("[MERCADO_PAGO] Erro ao verificar pagamentos pendentes:", error.message);
    }
  };

  runCheck();
  const timer = setInterval(runCheck, intervalMs);
  if (timer.unref) timer.unref();
  console.log(`[MERCADO_PAGO] Verificador de pagamentos pendentes iniciado a cada ${Math.round(intervalMs / 1000)}s.`);
  return timer;
}

function startWebhookServer(client, config) {
  const port = Number(process.env.WEBHOOK_PORT || 3000);
  const app = express();

  async function handleStripeWebhook(req, res) {
    try {
      const event = constructStripeWebhookEvent(req.body, req.headers["stripe-signature"]);
      res.sendStatus(200);

      const object = event.data?.object;
      const sessionId = object?.object === "checkout.session" ? object.id : null;
      if (!sessionId) {
        console.log(`[STRIPE] Evento ignorado: ${event.type}`);
        return;
      }

      if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
        console.log(`[STRIPE] Evento recebido sem confirmacao final: ${event.type}`);
        return;
      }

      await processStripePayment(client, config, sessionId, "webhook");
    } catch (error) {
      console.error("[STRIPE] Erro no webhook:", error.message);
      if (!res.headersSent) res.sendStatus(400);
    }
  }

  app.post("/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

  app.use(express.json());

  app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!rateLimit(ip)) {
      console.log(`[RATE LIMIT] Bloqueado: ${ip}`);
      return res.sendStatus(429);
    }
    next();
  });

  app.get("/health", (req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  async function handleMercadoPagoWebhook(req, res) {
    console.log("[WEBHOOK] ===========================================");
    console.log("[WEBHOOK] Nova requisiÃ§Ã£o recebida");
    console.log("[WEBHOOK] Headers:", JSON.stringify(req.headers, null, 2));
    console.log("[WEBHOOK] Body:", JSON.stringify(req.body, null, 2));
    console.log("[WEBHOOK] Query:", JSON.stringify(req.query, null, 2));
    console.log("[WEBHOOK] IP:", req.ip);
    res.sendStatus(200);

    try {
      if (!verifyWebhookSignature(req)) {
        console.log("[WEBHOOK] Assinatura invÃ¡lida, ignorando requisiÃ§Ã£o");
        return;
      }

      const paymentId = req.body?.data?.id || req.query?.id || req.query?.["data.id"];
      const topic = req.body?.type || req.query?.topic;
      console.log(`[WEBHOOK] Recebido: paymentId=${paymentId}, topic=${topic}, ip=${req.ip}`);

      if (!paymentId || (topic && topic !== "payment")) {
        console.log("[WEBHOOK] Ignorado: paymentId ou topic invÃ¡lido");
        return;
      }

      await processMercadoPagoPayment(client, config, paymentId, "webhook");
      return;

    } catch (error) {
      console.error("[WEBHOOK] Erro no webhook Mercado Pago:", error);
      console.error("[WEBHOOK] Stack:", error.stack);
    }
    console.log("[WEBHOOK] ===========================================");
  }

  app.post("/mercadopago/webhook", handleMercadoPagoWebhook);
  app.post("/api/pix/webhook", handleMercadoPagoWebhook);

  app.post("/site/venda", async (req, res) => {
    res.sendStatus(200);
    try {
      const { customerName, customerEmail, orderId, total, paymentMethod, items } = req.body;
      await logVendaSite(client, config, { customerName, customerEmail, orderId, total, paymentMethod, items });
    } catch (err) {
      console.error("[SITE VENDA] Erro ao logar venda do site:", err);
    }
  });

  const server = app.listen(port, () => {
    console.log(`Webhook Mercado Pago ativo na porta ${port}`);
  });
  startPendingPaymentWatcher(client, config);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Porta ${port} jÃ¡ estÃ¡ em uso. Feche a outra instÃ¢ncia do bot ou configure outra porta para os webhooks.`);
      return;
    }

    throw error;
  });
}

module.exports = {
  processMercadoPagoPayment,
  startWebhookServer
};

