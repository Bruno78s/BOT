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
const { formatPrice } = require("./salesFlow");
const { logTicketEvent } = require("./advancedLogger");
const { logVenda, logComprovante, logPedido, logVendaSite } = require("./channelLogger");
const { ensureProductPanels } = require("./productPanels");
const { sendReceiptDM, sendReceiptToPrivateChannel } = require("./receipt");
const {
  claimPaymentFulfillment,
  completePaymentFulfillment,
  failPaymentFulfillment,
  finalizePaymentLocally,
  listPendingFulfillments
} = require("./paymentFinalization");
const { get, run } = require("../database/db");
const { getOrderCode } = require("./orders");
const { recordFailedPayment } = require("./customers");
const {
  constructStripeWebhookEvent,
  fetchCardCheckoutSession,
  getStripePaymentBySessionId,
  listPendingStripePayments,
  updateStripePaymentStatus
} = require("./stripePayments");

const processingPayments = new Set();

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
  const finalization = finalizePaymentLocally(config, localPayment.id);
  localPayment = finalization.payment;
  const fulfillmentClaim = claimPaymentFulfillment(localPayment.id);
  if (!fulfillmentClaim.claimed) {
    return fulfillmentClaim.job?.status === "completed";
  }

  try {
    console.log("[WEBHOOK] confirmApprovedPayment chamado para canal:", localPayment.channel_id);
    const channel = await client.channels.fetch(localPayment.channel_id).catch(() => null);
    if (!channel?.send) throw new Error("Canal do carrinho não encontrado ou sem permissão de envio.");

  const product = config.products.find((item) => item.id === localPayment.product_id);
  const coupon = localPayment.coupon_id ? get("SELECT * FROM coupons WHERE id = ?", [localPayment.coupon_id]) : null;
  const orderCode = getOrderCode(localPayment, product);
  const paymentId = paymentData.id;
  const paymentMethodLabel = localPayment.provider === "stripe" ? "Cartão" : "PIX Mercado Pago";
  const deliveryChannelId = product?.category === "sites" ? config.deliveryChannels?.sites : config.deliveryChannels?.bots;
  const deliveryChannel = deliveryChannelId ? await client.channels.fetch(deliveryChannelId).catch(() => null) : null;
  const hasAutoDelivery = !!product?.deliveryUrl;

  const remainingStock = finalization.remainingStock;
  ensureProductPanels(client, config).catch((err) =>
    console.log("[WEBHOOK] Erro ao atualizar painéis:", err.message)
  );

  const dmResult = await sendClientDM(client, config, localPayment, product, orderCode, paymentId);
  const dmDelivered = dmResult.sent;
  const dmUrl = dmResult.dmChannelId
    ? `https://discord.com/channels/@me/${dmResult.dmChannelId}`
    : "https://discord.com/channels/@me";

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
    } else if (member && !member.roles.cache.has(clientRoleId)) {
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

  completePaymentFulfillment(localPayment.id);
  return true;
  } catch (error) {
    failPaymentFulfillment(localPayment.id, error);
    throw error;
  }
}
function timingSafeTextEqual(received, expected) {
  const receivedBuffer = Buffer.from(String(received || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function verifyWebhookSignature(req) {
  const secret = (process.env.MERCADO_PAGO_WEBHOOK_SECRET || "").trim();
  const xSignature = req.headers["x-signature"];
  const xRequestId = req.headers["x-request-id"];
  if (!secret || !xSignature || !xRequestId) return false;

  try {
    const dataId = req.query?.["data.id"] || req.query?.id || req.body?.data?.id;
    if (!dataId) return false;

    const parts = xSignature.split(",").reduce((acc, part) => {
      const [key, value] = part.trim().split("=", 2);
      if (key && value) acc[key] = value;
      return acc;
    }, {});
    const ts = parts.ts;
    const signature = parts.v1;
    if (!ts || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;


    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    return timingSafeTextEqual(signature.toLowerCase(), expected);
  } catch (error) {
    console.error("[WEBHOOK] Falha ao validar assinatura Mercado Pago:", error.message);
    return false;
  }
}

function verifyIntegrationApiKey(req) {
  const expected = (process.env.BZNX_INTEGRATION_API_KEY || "").trim();
  const received = req.headers["x-api-key"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(expected) && timingSafeTextEqual(received, expected);
}

function parseSiteSalePayload(body) {
  const customerName = String(body?.customerName || "").trim();
  const customerEmail = String(body?.customerEmail || "").trim();
  const orderId = String(body?.orderId || "").trim();
  const paymentMethod = String(body?.paymentMethod || "").trim();
  const total = Number(body?.total);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];

  if (!customerName || customerName.length > 150) throw new Error("customerName inválido");
  if (!customerEmail || customerEmail.length > 254 || !customerEmail.includes("@")) throw new Error("customerEmail inválido");
  if (!orderId || orderId.length > 100) throw new Error("orderId inválido");
  if (!paymentMethod || paymentMethod.length > 50) throw new Error("paymentMethod inválido");
  if (!Number.isFinite(total) || total < 0) throw new Error("total inválido");
  if (!items.length) throw new Error("items inválido");

  return { customerName, customerEmail, orderId, total, paymentMethod, items };
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

const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now - record.start > 120000) rateLimitMap.delete(ip);
  }
}, 60000);
if (rateLimitCleanupTimer.unref) rateLimitCleanupTimer.unref();

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
      console.log(`[MERCADO_PAGO] ${source}: pagamento ${paymentData.id} já finalizado localmente; verificando entrega pendente.`);
      return confirmApprovedPayment(client, config, paymentData, localPayment);
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

    try {
      const confirmed = await confirmApprovedPayment(client, config, paymentData, localPayment);
      if (!confirmed) return false;
      await updatePaymentStatusByProviderId(paymentData.id, "approved");
      return true;
    } catch (error) {
      console.error(`[MERCADO_PAGO] ${source}: falha ao finalizar pagamento ${paymentData.id}:`, error.message);
      return false;
    }
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
      console.log(`[STRIPE] ${source}: pagamento ${session.id} já finalizado localmente; verificando entrega pendente.`);
      return confirmApprovedPayment(client, config, { id: session.id, status: "approved" }, localPayment);
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

    try {
      const confirmed = await confirmApprovedPayment(
        client,
        config,
        { id: session.id, status: "approved", payment_intent: paymentIntentId },
        localPayment
      );
      if (!confirmed) return false;
      await updateStripePaymentStatus(session.id, "approved", paymentIntentId);
      return true;
    } catch (error) {
      console.error(`[STRIPE] ${source}: falha ao finalizar pagamento ${session.id}:`, error.message);
      return false;
    }
  } finally {
    processingPayments.delete(paymentKey);
  }
}

function startPendingPaymentWatcher(client, config) {
  const intervalMs = Math.max(Number(process.env.MERCADO_PAGO_PENDING_CHECK_INTERVAL_MS || 30000), 15000);

  let checkRunning = false;
  const runCheck = async () => {
    if (checkRunning) return;
    checkRunning = true;
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

      for (const payment of listPendingFulfillments(25)) {
        await confirmApprovedPayment(
          client,
          config,
          { id: payment.provider_payment_id || payment.preference_id || payment.id, status: "approved" },
          payment
        ).catch((error) => console.error(`[FULFILLMENT] Pagamento ${payment.id}:`, error.message));
      }
    } catch (error) {
      console.error("[PAYMENTS] Erro ao verificar pagamentos pendentes:", error.message);
    } finally {
      checkRunning = false;
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
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

  app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!rateLimit(ip)) {
      console.warn(`[RATE LIMIT] Bloqueado: ${ip}`);
      return res.sendStatus(429);
    }
    next();
  });

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

  app.post("/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), handleStripeWebhook);

  app.use(express.json({ limit: "64kb", strict: true }));

  app.get("/health", (req, res) => {
    let database = false;
    let failedFulfillments = 0;
    try {
      database = get("SELECT 1 AS ok")?.ok === 1;
      failedFulfillments = get("SELECT COUNT(*) AS total FROM payment_fulfillment_jobs WHERE status = 'failed'")?.total || 0;
    } catch (error) {
      console.error("[HEALTH] Falha ao consultar banco:", error.message);
    }
    const discord = client.isReady();
    const ok = database && discord;
    res.status(ok ? 200 : 503).json({ ok, uptime: process.uptime(), checks: { database, discord, failedFulfillments } });
  });

  async function handleMercadoPagoWebhook(req, res) {
    try {
      if (!verifyWebhookSignature(req)) {
        console.warn(`[WEBHOOK] Assinatura Mercado Pago rejeitada (ip=${req.ip}).`);
        return res.sendStatus(401);
      }

      const paymentId = req.query?.["data.id"] || req.query?.id || req.body?.data?.id;
      const topic = req.body?.type || req.query?.topic;
      if (!paymentId || (topic && topic !== "payment")) {
        return res.status(400).json({ error: "payload inválido" });
      }

      res.sendStatus(200);
      console.log(`[WEBHOOK] Mercado Pago autenticado: paymentId=${paymentId}, topic=${topic || "payment"}.`);
      await processMercadoPagoPayment(client, config, paymentId, "webhook");
    } catch (error) {
      console.error("[WEBHOOK] Erro no webhook Mercado Pago:", error.message);
      if (!res.headersSent) res.sendStatus(500);
    }
  }

  app.post("/mercadopago/webhook", handleMercadoPagoWebhook);
  app.post("/api/pix/webhook", handleMercadoPagoWebhook);

  app.post("/site/venda", async (req, res) => {
    if (!verifyIntegrationApiKey(req)) return res.sendStatus(401);
    try {
      const payload = parseSiteSalePayload(req.body);
      await logVendaSite(client, config, payload);
      return res.sendStatus(202);
    } catch (error) {
      console.error("[SITE VENDA] Requisição rejeitada:", error.message);
      return res.status(400).json({ error: "payload inválido" });
    }
  });

  const server = app.listen(port, () => {
    console.log(`Webhook Mercado Pago ativo na porta ${port}`);
  });
  startPendingPaymentWatcher(client, config);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Porta ${port} já está em uso. Feche a outra instância do bot ou configure outra porta para os webhooks.`);
      return;
    }

    throw error;
  });
}

module.exports = {
  processMercadoPagoPayment,
  startWebhookServer
};

