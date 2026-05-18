const express = require("express");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { fetchPayment, attachProviderPaymentIdByReference, getPaymentByProviderPaymentId, updatePaymentStatusByProviderId } = require("./mercadoPago");
const { getPayment: getAsaasPayment, updatePaymentStatusByProviderId: updateAsaasPaymentStatus, getPaymentByProviderPaymentId: getAsaasPaymentByProviderId } = require("./asaas");
const { formatPrice } = require("./salesFlow");
const { logTicketEvent } = require("./advancedLogger");

async function confirmApprovedPayment(client, config, paymentData, localPayment) {
  const channel = await client.channels.fetch(localPayment.channel_id).catch(() => null);
  if (!channel?.send) return;

  const product = config.products.find((item) => item.id === localPayment.product_id);
  const orderId = localPayment.id;
  const paymentId = paymentData.id;
  const checkoutUrl = localPayment.checkout_url;
  const deliveryChannelId = product?.category === "sites" ? config.deliveryChannels?.sites : config.deliveryChannels?.bots;
  const deliveryChannel = deliveryChannelId ? await client.channels.fetch(deliveryChannelId).catch(() => null) : null;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages) {
    const botMessages = messages.filter(m => m.author.id === client.user.id);
    await channel.bulkDelete(botMessages).catch(() => null);
  }

  const summaryEmbed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle(`${config.botName} | Pedido Confirmado`)
    .setDescription([
      `> **ID do Pedido:** #${orderId}`,
      `> **Produto:** ${product?.name || localPayment.product_id}`,
      `> **Valor:** ${formatPrice(localPayment.amount)}`,
      `> **Pagamento:** ${paymentId}`,
      "",
      "> Seu pagamento foi aprovado automaticamente.",
      "> Abra um ticket de entrega para receber o produto.",
      "> Use o botão abaixo para copiar os dados do pedido."
    ].join("\n"))
    .setFooter({ text: "Bzn X • Pedido" })
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

  await channel.send({
    embeds: [
      summaryEmbed
    ],
    components: [row]
  });

  if (deliveryChannel?.send) {
    await deliveryChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle(`${config.botName} | Compra Aprovada`)
          .setDescription([
            `> **Cliente:** <@${localPayment.user_id}>`,
            `> **Produto:** ${product?.name || localPayment.product_id}`,
            `> **Valor:** ${formatPrice(localPayment.amount)}`,
            `> **Canal:** <#${localPayment.channel_id}>`,
            `> **Pagamento:** ${paymentId}`,
            `> **ID do Pedido:** #${orderId}`
          ].join("\n"))
          .setTimestamp()
      ]
    });
  }

  await logTicketEvent(client, config, "Pagamento Aprovado", localPayment.channel_id, {
    description: `Pagamento aprovado automaticamente via ${localPayment.provider === "asaas" ? "Asaas" : "Mercado Pago"}.`,
    fields: [
      { name: "Cliente", value: `<@${localPayment.user_id}>`, inline: true },
      { name: "Produto", value: product?.name || localPayment.product_id, inline: true },
      { name: "Valor", value: formatPrice(localPayment.amount), inline: true },
      { name: "ID do Pedido", value: `#${orderId}`, inline: true }
    ]
  });
}

function startWebhookServer(client, config) {
  const port = Number(process.env.WEBHOOK_PORT || 3000);
  const app = express();

  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.post("/mercadopago/webhook", async (req, res) => {
    res.sendStatus(200);

    try {
      const paymentId = req.body?.data?.id || req.query?.id || req.query?.["data.id"];
      const topic = req.body?.type || req.query?.topic;
      if (!paymentId || (topic && topic !== "payment")) return;

      const paymentData = await fetchPayment(paymentId);
      const channelId = paymentData.external_reference || paymentData.metadata?.channel_id;
      if (!channelId) return;

      await attachProviderPaymentIdByReference(channelId, paymentData.id, paymentData.status);
      let localPayment = await getPaymentByProviderPaymentId(paymentData.id);
      if (!localPayment) return;

      await updatePaymentStatusByProviderId(paymentData.id, paymentData.status);
      localPayment = await getPaymentByProviderPaymentId(paymentData.id);

      if (paymentData.status === "approved") {
        await confirmApprovedPayment(client, config, paymentData, localPayment);
      }
    } catch (error) {
      console.error("Erro no webhook Mercado Pago:", error);
    }
  });

  app.post("/asaas/webhook", async (req, res) => {
    res.sendStatus(200);

    try {
      const paymentId = req.body?.payment?.id;
      const paymentStatus = req.body?.payment?.status;
      if (!paymentId || !paymentStatus) return;

      const paymentData = await getAsaasPayment(paymentId);
      const channelId = paymentData?.externalReference;
      if (!channelId) return;

      let localPayment = await getAsaasPaymentByProviderId(paymentId);
      if (!localPayment) return;

      await updateAsaasPaymentStatus(paymentId, paymentStatus);
      localPayment = await getAsaasPaymentByProviderId(paymentId);

      if (paymentStatus === "CONFIRMED" || paymentStatus === "RECEIVED") {
        await confirmApprovedPayment(client, config, paymentData, localPayment);
      }
    } catch (error) {
      console.error("Erro no webhook Asaas:", error);
    }
  });

  const server = app.listen(port, () => {
    console.log(`Webhook Mercado Pago e Asaas ativos na porta ${port}`);
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
