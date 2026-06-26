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
    .slice(0, 18)
    .toUpperCase()
    .replace(/(.{6})/g, "$1-")
    .replace(/-$/, "");
}

function shorten(value, max = 54) {
  const text = String(value || "N/A");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function drawTopBar(doc, botName, status) {
  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const paid = status === "PAGO";

  doc.rect(0, 0, 595.28, 132).fill("#0B1120");
  doc.rect(0, 122, 595.28, 10).fill(paid ? "#22C55E" : "#F59E0B");

  try {
    doc.image(logoPath, 44, 31, { width: 66, height: 66 });
  } catch {
    // Logo opcional.
  }

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(23)
    .text(botName || "BznX Store", 126, 35)
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#CBD5E1")
    .text("Comprovante administrativo de pedido digital", 126, 66)
    .fillColor("#94A3B8")
    .text("Bots, sites, automações e serviços digitais", 126, 84);

  doc
    .roundedRect(410, 38, 116, 34, 8)
    .fill(paid ? "#16A34A" : "#F59E0B")
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(status, 410, 48, { width: 116, align: "center" });
}

function drawCard(doc, x, y, width, height, title) {
  doc
    .roundedRect(x, y, width, height, 10)
    .fillAndStroke("#FFFFFF", "#E5E7EB");

  if (title) {
    doc
      .fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(title, x + 18, y + 16);
  }
}

function drawField(doc, label, value, x, y, width = 210) {
  doc
    .fillColor("#64748B")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(label.toUpperCase(), x, y, { width });

  doc
    .fillColor("#0F172A")
    .font("Helvetica")
    .fontSize(10.5)
    .text(value || "N/A", x, y + 13, { width, lineGap: 2 });
}

function drawVerificationSeal(doc, code, x, y) {
  doc.roundedRect(x, y, 150, 92, 10).fillAndStroke("#F8FAFC", "#CBD5E1");
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("VERIFICAÇÃO", x + 14, y + 14);

  doc
    .font("Courier-Bold")
    .fontSize(12)
    .fillColor("#111827")
    .text(code, x + 14, y + 36, { width: 122, align: "center" });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#64748B")
    .text("Use este código para conferir o pedido nos registros internos da loja.", x + 14, y + 68, {
      width: 122,
      align: "center"
    });
}

function drawItemTable(doc, product, amount, coupon, x, y) {
  doc.roundedRect(x, y, 499, 92, 8).strokeColor("#E5E7EB").stroke();
  doc.rect(x, y, 499, 28).fill("#F8FAFC");
  doc
    .fillColor("#475569")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("ITEM", x + 16, y + 10)
    .text("CUPOM", x + 296, y + 10, { width: 80, align: "center" })
    .text("VALOR", x + 390, y + 10, { width: 90, align: "right" });

  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(shorten(product?.name || "Produto digital", 42), x + 16, y + 45, { width: 250 })
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#64748B")
    .text(product?.id || "produto", x + 16, y + 62, { width: 250 });

  doc
    .fillColor("#0F172A")
    .font("Helvetica")
    .fontSize(10)
    .text(coupon?.code ? coupon.code.toUpperCase() : "Nenhum", x + 296, y + 50, { width: 80, align: "center" })
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(formatMoney(amount), x + 390, y + 48, { width: 90, align: "right" });
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
  const doc = new PDFDocument({ size: "A4", margin: 0, info: {
    Title: `Comprovante ${orderId || "BznX"}`,
    Author: botName || "BznX Store",
    Subject: "Comprovante administrativo de pedido"
  }});

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

  drawTopBar(doc, botName, status);

  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("Comprovante de Pedido", 48, 158)
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#64748B")
    .text("Documento gerado automaticamente após confirmação ou abertura de pagamento.", 48, 184);

  doc
    .roundedRect(382, 152, 165, 44, 8)
    .fillAndStroke("#F8FAFC", "#E2E8F0")
    .fillColor("#64748B")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("PEDIDO", 398, 162)
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`#${orderId || "N/A"}`, 398, 176, { width: 130 });

  drawCard(doc, 48, 220, 499, 118, "Resumo");
  drawField(doc, "Status", status, 70, 252, 140);
  drawField(doc, "Emitido em", formatDate(issuedAt), 230, 252, 140);
  drawField(doc, "Forma de pagamento", paymentMethod || "N/A", 390, 252, 130);
  drawField(doc, "ID do pagamento", shorten(providerPaymentId, 34), 70, 296, 210);
  drawField(doc, "Carrinho/Canal", channelId || "N/A", 310, 296, 210);

  drawCard(doc, 48, 362, 499, 126, "Cliente");
  drawField(doc, "Discord", user?.tag || user?.username || "N/A", 70, 394, 210);
  drawField(doc, "ID Discord", user?.id || "N/A", 310, 394, 210);
  drawField(doc, "Servidor", guildId || "N/A", 70, 438, 210);
  drawField(doc, "Referência", `#${orderId || "N/A"}`, 310, 438, 210);

  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Itens do pedido", 48, 518);
  drawItemTable(doc, product, amount, coupon, 48, 540);

  drawCard(doc, 48, 654, 320, 92, "Observações");
  doc
    .fillColor("#334155")
    .font("Helvetica")
    .fontSize(9)
    .text([
      "Este comprovante registra a operação na BznX Store.",
      "Ele não substitui nota fiscal, recibo fiscal ou documento tributário.",
      "A validade depende da confirmação final pelo provedor de pagamento."
    ].join("\n"), 68, 684, { width: 280, lineGap: 4 });

  drawVerificationSeal(doc, verificationCode, 397, 654);

  doc
    .moveTo(48, 774)
    .lineTo(547, 774)
    .strokeColor("#E5E7EB")
    .stroke();

  doc
    .fillColor("#94A3B8")
    .font("Helvetica")
    .fontSize(8)
    .text(`BznX Store • Documento interno • Link de pagamento: ${shorten(checkoutUrl, 82)}`, 48, 790, {
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
