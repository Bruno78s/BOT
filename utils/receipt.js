const crypto = require("crypto");
const path = require("path");
const PDFDocument = require("pdfkit");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

const DEFAULT_RECEIPT_CHANNEL_ID = "1469735330511851732";

function buildPdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function formatMoney(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}

function formatDate(value = Date.now()) {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium"
  });
}

function createVerificationCode(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.filter(Boolean).join(":"))
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function drawHeader(doc, botName, status) {
  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  doc.rect(0, 0, 595.28, 120).fill("#111827");

  try {
    doc.image(logoPath, 48, 30, { width: 64, height: 64 });
  } catch {
    // Logo opcional.
  }

  doc
    .fillColor("#FFFFFF")
    .fontSize(22)
    .text(botName || "BznX Store", 130, 36)
    .fontSize(11)
    .fillColor("#CBD5E1")
    .text("Loja digital de bots e sites", 130, 66);

  doc
    .roundedRect(410, 38, 120, 32, 6)
    .fill(status === "PAGO" ? "#16A34A" : "#F59E0B")
    .fillColor("#FFFFFF")
    .fontSize(13)
    .text(status, 410, 47, { width: 120, align: "center" });
}

function drawRow(doc, label, value, x, y, width = 230) {
  doc.fillColor("#64748B").fontSize(9).text(label.toUpperCase(), x, y);
  doc.fillColor("#111827").fontSize(11).text(value || "N/A", x, y + 14, { width });
}

async function createReceiptAttachment({
  botName,
  guildId,
  channelId,
  user,
  product,
  amount,
  paymentMethod,
  checkoutUrl,
  providerPaymentId,
  coupon,
  orderId,
  status = "AGUARDANDO PAGAMENTO",
  issuedAt = Date.now()
}) {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const verificationCode = createVerificationCode([
    botName,
    guildId,
    channelId,
    user?.id,
    product?.id || product?.name,
    amount,
    providerPaymentId,
    orderId
  ]);

  drawHeader(doc, botName, status);

  doc
    .fillColor("#111827")
    .fontSize(18)
    .text("Comprovante de Pedido", 48, 150)
    .fontSize(10)
    .fillColor("#64748B")
    .text("Documento administrativo gerado automaticamente pela BznX Store.", 48, 174);

  doc.roundedRect(48, 210, 499, 118, 8).strokeColor("#E5E7EB").stroke();
  drawRow(doc, "Pedido", `#${orderId || "N/A"}`, 70, 230);
  drawRow(doc, "Status", status, 310, 230);
  drawRow(doc, "Emitido em", formatDate(issuedAt), 70, 280);
  drawRow(doc, "Código de verificação", verificationCode, 310, 280);

  doc.roundedRect(48, 350, 499, 152, 8).strokeColor("#E5E7EB").stroke();
  drawRow(doc, "Cliente Discord", `${user?.tag || "N/A"} (${user?.id || "N/A"})`, 70, 372, 440);
  drawRow(doc, "Produto", product?.name || "N/A", 70, 422);
  drawRow(doc, "Valor", formatMoney(amount), 310, 422);
  drawRow(doc, "Forma de pagamento", paymentMethod || "N/A", 70, 472);
  drawRow(doc, "ID do pagamento", providerPaymentId || "N/A", 310, 472);

  doc.roundedRect(48, 524, 499, 92, 8).strokeColor("#E5E7EB").stroke();
  drawRow(doc, "Servidor", guildId || "N/A", 70, 546);
  drawRow(doc, "Carrinho", channelId || "N/A", 310, 546);
  drawRow(doc, "Cupom", coupon ? `${coupon.code?.toUpperCase?.() || coupon.code} aplicado` : "Nenhum", 70, 586);
  drawRow(doc, "Link de pagamento", checkoutUrl || "N/A", 310, 586);

  doc
    .moveTo(48, 660)
    .lineTo(547, 660)
    .strokeColor("#E5E7EB")
    .stroke();

  doc
    .fillColor("#64748B")
    .fontSize(9)
    .text("Este comprovante é destinado à conferência interna da equipe BznX Store. Não é nota fiscal. A validade depende da confirmação do provedor de pagamento.", 48, 680, {
      width: 499,
      align: "center"
    });

  const pdfBuffer = await buildPdfBuffer(doc);
  const safeOrderId = String(orderId || Date.now()).replace(/[^\w-]/g, "");

  return new AttachmentBuilder(pdfBuffer, {
    name: `comprovante-bznx-${safeOrderId}-${status.toLowerCase().replace(/\s+/g, "-")}.pdf`
  });
}

async function sendReceiptToPrivateChannel(client, config, receiptData, status) {
  const channelId = process.env.RECEIPT_CHANNEL_ID || config.logChannels?.comprovantes || DEFAULT_RECEIPT_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const attachment = await createReceiptAttachment({ ...receiptData, botName: config.botName, status });
  const embed = new EmbedBuilder()
    .setColor(status === "PAGO" ? (config.colors?.success || 0x16A34A) : (config.colors?.warning || 0xF59E0B))
    .setTitle(status === "PAGO" ? "📄 Comprovante final gerado" : "🧾 Pré-comprovante gerado")
    .setDescription([
      `Cliente: <@${receiptData.user?.id || receiptData.userId}>`,
      `Produto: **${receiptData.product?.name || "N/A"}**`,
      `Valor: **${formatMoney(receiptData.amount)}**`,
      `Pedido: **#${receiptData.orderId || "N/A"}**`,
      `Status: **${status}**`
    ].join("\n"))
    .setTimestamp();

  await channel.send({ embeds: [embed], files: [attachment] });
  return true;
}

async function sendReceiptDM(client, config, receiptData, status) {
  if (process.env.SEND_RECEIPT_DM !== "true") return false;
  const user = receiptData.user || await client.users.fetch(receiptData.userId).catch(() => null);
  if (!user?.send) return false;

  const attachment = await createReceiptAttachment({ ...receiptData, botName: config.botName, status });
  await user.send({
    content: status === "PAGO"
      ? "📄 Seu comprovante final da BznX Store foi gerado."
      : "🧾 Seu pré-comprovante da BznX Store foi gerado.",
    files: [attachment]
  }).catch(() => null);
  return true;
}

module.exports = {
  createReceiptAttachment,
  sendReceiptDM,
  sendReceiptToPrivateChannel
};
