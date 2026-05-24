const express = require("express");
const crypto = require("crypto");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { fetchPayment, attachProviderPaymentIdByReference, getPaymentByProviderPaymentId, updatePaymentStatusByProviderId } = require("./mercadoPago");
const { formatPrice, readConfigFile, writeConfigFile } = require("./salesFlow");
const { logTicketEvent } = require("./advancedLogger");
const { logVenda, logComprovante, logPedido, logVendaSite } = require("./channelLogger");

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
    if (!user) return;
    const dmEmbed = new EmbedBuilder()
      .setColor(0x00c853)
      .setAuthor({ name: `${config.botName} • Compra Confirmada`, iconURL: client.user.displayAvatarURL() })
      .setTitle("✅ Seu pagamento foi aprovado!")
      .setDescription([
        `> 📦 **Produto:** ${product?.name || localPayment.product_id}`,
        `> 💰 **Valor:** ${formatPrice(localPayment.amount)}`,
        `> 🔖 **Pedido:** #${orderId}`,
        "",
        "> Volte ao servidor e clique em **Abrir Ticket de Entrega** para receber seu produto.",
      ].join("\n"))
      .setFooter({ text: `${config.botName} • Obrigado pela compra!` })
      .setTimestamp();
    await user.send({ embeds: [dmEmbed] }).catch(() => null);
    console.log(`[DM] Notificação enviada para ${user.tag}`);
  } catch (err) {
    console.log(`[DM] Falha ao enviar DM para ${localPayment.user_id}:`, err.message);
  }
}

async function confirmApprovedPayment(client, config, paymentData, localPayment) {
  console.log("[WEBHOOK] confirmApprovedPayment chamado para canal:", localPayment.channel_id);
  const channel = await client.channels.fetch(localPayment.channel_id).catch(() => null);
  if (!channel?.send) {
    console.log("[WEBHOOK] Erro: canal não encontrado ou não pode enviar mensagens");
    return;
  }

  const product = config.products.find((item) => item.id === localPayment.product_id);
  const orderId = localPayment.id;
  const paymentId = paymentData.id;
  const deliveryChannelId = product?.category === "sites" ? config.deliveryChannels?.sites : config.deliveryChannels?.bots;
  const deliveryChannel = deliveryChannelId ? await client.channels.fetch(deliveryChannelId).catch(() => null) : null;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages) {
    const botMessages = messages.filter(m => m.author.id === client.user.id);
    await channel.bulkDelete(botMessages).catch(() => null);
  }

  const remainingStock = decrementStock(config, localPayment.product_id);

  const summaryEmbed = new EmbedBuilder()
    .setColor(0x00c853)
    .setAuthor({ name: `${config.botName} • Pagamento`, iconURL: client.user.displayAvatarURL() })
    .setTitle("✅ Pagamento Confirmado!")
    .setDescription([
      `> 👤 **Cliente:** <@${localPayment.user_id}>`,
      `> 📦 **Produto:** ${product?.name || localPayment.product_id}`,
      `> 💰 **Valor:** ${formatPrice(localPayment.amount)}`,
      `> 🔖 **Pedido:** #${orderId}`,
      `> 🆔 **Pagamento:** \`${paymentId}\``,
      "",
      "─────────────────────────────",
      "",
      "> ✅ Seu pagamento foi **aprovado automaticamente**.",
      "> 📦 Clique em **Abrir Ticket de Entrega** para receber seu produto.",
    ].join("\n"))
    .setFooter({ text: `${config.botName} • Pedido Confirmado`, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("order_open_delivery_ticket")
      .setLabel("Abrir Ticket de Entrega")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("order_copy_summary")
      .setLabel("Copiar Resumo")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("order_close_cart")
      .setLabel("Fechar Carrinho")
      .setStyle(ButtonStyle.Danger)
  );

  console.log("[WEBHOOK] Enviando mensagem de pagamento aprovado para canal:", channel.id);
  await channel.send({
    content: `<@${localPayment.user_id}>`,
    embeds: [summaryEmbed],
    components: [row]
  });
  console.log("[WEBHOOK] Mensagem enviada com sucesso");

  await sendClientDM(client, config, localPayment, product, orderId, paymentId);

  if (deliveryChannel?.send) {
    await deliveryChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c853)
          .setAuthor({ name: `${config.botName} • Entrega`, iconURL: client.user.displayAvatarURL() })
          .setTitle("🚀 Nova Entrega Pendente")
          .addFields([
            { name: "👤 Cliente", value: `<@${localPayment.user_id}>`, inline: true },
            { name: "📦 Produto", value: product?.name || localPayment.product_id, inline: true },
            { name: "💰 Valor", value: formatPrice(localPayment.amount), inline: true },
            { name: "🛒 Canal", value: `<#${localPayment.channel_id}>`, inline: true },
            { name: "🔖 Pedido", value: `#${orderId}`, inline: true },
            { name: "📦 Estoque", value: `${remainingStock >= 0 ? remainingStock : "?"} restantes`, inline: true },
          ])
          .setFooter({ text: `${config.botName} • Entrega`, iconURL: client.user.displayAvatarURL() })
          .setTimestamp()
      ]
    });
  }

  await logVenda(client, config, {
    userId: localPayment.user_id,
    productName: product?.name || localPayment.product_id,
    amount: localPayment.amount,
    orderId,
    paymentId,
    channelId: localPayment.channel_id,
  });

  await logComprovante(client, config, {
    userId: localPayment.user_id,
    productName: product?.name || localPayment.product_id,
    amount: localPayment.amount,
    orderId,
    paymentId,
    channelId: localPayment.channel_id,
  });

  await logTicketEvent(client, config, "Pagamento Aprovado", localPayment.channel_id, {
    description: `Pagamento aprovado automaticamente via PIX.`,
    fields: [
      { name: "Cliente", value: `<@${localPayment.user_id}>`, inline: true },
      { name: "Produto", value: product?.name || localPayment.product_id, inline: true },
      { name: "Valor", value: formatPrice(localPayment.amount), inline: true },
      { name: "ID do Pedido", value: `#${orderId}`, inline: true }
    ]
  });
}

function verifyWebhookSignature(req) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
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
    return expected === v1;
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

function startWebhookServer(client, config) {
  const port = Number(process.env.WEBHOOK_PORT || 3000);
  const app = express();

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
    res.sendStatus(200);

    try {
      if (!verifyWebhookSignature(req)) {
        console.log("[WEBHOOK] Assinatura inválida, ignorando requisição");
        return;
      }

      const paymentId = req.body?.data?.id || req.query?.id || req.query?.["data.id"];
      const topic = req.body?.type || req.query?.topic;
      console.log(`[WEBHOOK] Recebido: paymentId=${paymentId}, topic=${topic}, ip=${req.ip}`);

      if (!paymentId || (topic && topic !== "payment")) {
        console.log("[WEBHOOK] Ignorado: paymentId ou topic inválido");
        return;
      }

      const paymentData = await fetchPayment(paymentId);
      console.log(`[WEBHOOK] Status MP: ${paymentData.status}, ref: ${paymentData.external_reference}`);

      const channelId = paymentData.external_reference || paymentData.metadata?.channel_id;
      if (!channelId) {
        console.log("[WEBHOOK] Sem channelId/external_reference, ignorando");
        return;
      }

      await attachProviderPaymentIdByReference(channelId, paymentData.id, paymentData.status);
      let localPayment = await getPaymentByProviderPaymentId(paymentData.id);
      if (!localPayment) {
        console.log(`[WEBHOOK] Pagamento ${paymentData.id} não encontrado no DB local`);
        return;
      }

      if (paymentData.status === "approved" && localPayment.status === "approved") {
        console.log("[WEBHOOK] Pagamento já confirmado anteriormente, ignorando duplicata:", paymentData.id);
        return;
      }

      await updatePaymentStatusByProviderId(paymentData.id, paymentData.status);
      localPayment = await getPaymentByProviderPaymentId(paymentData.id);

      if (paymentData.status === "approved") {
        let retries = 0;
        const maxRetries = 3;
        while (retries < maxRetries) {
          try {
            await confirmApprovedPayment(client, config, paymentData, localPayment);
            break;
          } catch (err) {
            retries++;
            console.error(`[WEBHOOK] Tentativa ${retries}/${maxRetries} falhou:`, err.message);
            if (retries < maxRetries) await new Promise(r => setTimeout(r, 2000 * retries));
          }
        }
        if (retries >= maxRetries) {
          console.error(`[WEBHOOK] FALHA CRÍTICA: não foi possível confirmar pagamento ${paymentData.id} após ${maxRetries} tentativas`);
        }
      }
    } catch (error) {
      console.error("[WEBHOOK] Erro no webhook Mercado Pago:", error);
    }
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

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Porta ${port} já está em uso. Feche a outra instância do bot ou configure outra porta para os webhooks.`);
      return;
    }

    throw error;
  });
}

module.exports = {
  startWebhookServer
};
