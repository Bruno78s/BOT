const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");

async function logToChannel(client, config, channelType, title, description, fields = []) {
  const logChannels = config.logChannels;
  if (!logChannels || !logChannels[channelType]) return;

  const channelId = logChannels[channelType];
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | ${title}`)
    .setDescription(description)
    .setThumbnail("attachment://logo.png")
    .setFooter({ 
      text: `Bzn X • ${channelType}`, 
      iconURL: "attachment://logo.png"
    })
    .setTimestamp();

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  await channel.send({ 
    embeds: [embed],
    files: [logoAttachment]
  });
}

async function logSystemEvent(client, config, event, details) {
  await logToChannel(
    client,
    config,
    "sistema",
    `Sistema: ${event}`,
    details.description || details,
    details.fields || []
  );
}

async function logSecurityEvent(client, config, event, userId, details) {
  await logToChannel(
    client,
    config,
    "logs-seguranca",
    `Segurança: ${event}`,
    `Usuário: <@${userId}>\n${details.description || details}`,
    details.fields || []
  );
}

async function logTicketEvent(client, config, event, ticketId, details) {
  await logToChannel(
    client,
    config,
    "ticket",
    `Ticket: ${event}`,
    `ID: ${ticketId}\n${details.description || details}`,
    details.fields || []
  );
}

async function logPurchaseEvent(client, config, event, productId, userId, details) {
  await logToChannel(
    client,
    config,
    "compra",
    `Compra: ${event}`,
    `Produto: ${productId}\nUsuário: <@${userId}>\n${details.description || details}`,
    details.fields || []
  );
}

async function logOrderEvent(client, config, event, orderId, details) {
  await logToChannel(
    client,
    config,
    "pedidos",
    `Pedido: ${event}`,
    `ID: ${orderId}\n${details.description || details}`,
    details.fields || []
  );
}

async function logProofEvent(client, config, event, userId, details) {
  await logToChannel(
    client,
    config,
    "comprovante",
    `Comprovante: ${event}`,
    `Usuário: <@${userId}>\n${details.description || details}`,
    details.fields || []
  );
}

async function logFeedbackEvent(client, config, rating, ticketId, userId) {
  await logToChannel(
    client,
    config,
    "feedback-ticket",
    "Feedback Recebido",
    `Ticket ID: ${ticketId}\nUsuário: <@${userId}>\nNota: ${rating}/5`,
    []
  );
}

async function logMessageEvent(client, config, event, channelId, userId, details) {
  await logToChannel(
    client,
    config,
    "logs-mensagem",
    `Mensagem: ${event}`,
    `Canal: <#${channelId}>\nUsuário: <@${userId}>\n${details.description || details}`,
    details.fields || []
  );
}

async function logTicketDetail(client, config, ticketId, details) {
  await logToChannel(
    client,
    config,
    "logs-ticket",
    `Log Ticket: ${ticketId}`,
    details.description || details,
    details.fields || []
  );
}

async function logProductEvent(client, config, event, productId, details) {
  await logToChannel(
    client,
    config,
    "pronts",
    `Produto: ${event}`,
    `ID: ${productId}\n${details.description || details}`,
    details.fields || []
  );
}

module.exports = {
  logToChannel,
  logSystemEvent,
  logSecurityEvent,
  logTicketEvent,
  logPurchaseEvent,
  logOrderEvent,
  logProofEvent,
  logFeedbackEvent,
  logMessageEvent,
  logTicketDetail,
  logProductEvent
};
