const crypto = require("crypto");
const path = require("path");
const PDFDocument = require("pdfkit");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

const DEFAULT_RECEIPT_CHANNEL_ID = "1469735330511851732";
const PAGE = { width: 595.28, height: 841.89 };
const COLORS = {
  ink: "#111827",
  muted: "#64748B",
  faint: "#94A3B8",
  line: "#D7DEE8",
  soft: "#F6F8FB",
  panel: "#FFFFFF",
  brand: "#0B1120",
  blue: "#2563EB",
  green: "#16A34A",
  amber: "#F59E0B",
  danger: "#DC2626"
};

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

function normalizeText(value, fallback = "N/A") {
  const text = String(value || "").trim();
  return text || fallback;
}

function shorten(value, max = 58) {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function statusMeta(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAGO" || normalized === "APROVADO") {
    return {
      label: "PAGAMENTO APROVADO",
      color: COLORS.green,
      chipBg: "#DCFCE7",
      chipText: "#166534"
    };
  }
  if (normalized.includes("CANCEL") || normalized.includes("RECUS")) {
    return {
      label: normalized,
      color: COLORS.danger,
      chipBg: "#FEE2E2",
      chipText: "#991B1B"
    };
  }
  return {
    label: normalized || "AGUARDANDO PAGAMENTO",
    color: COLORS.amber,
    chipBg: "#FEF3C7",
    chipText: "#92400E"
  };
}

function paymentProviderName(paymentMethod) {
  const method = String(paymentMethod || "").toLowerCase();
  if (method.includes("pix")) return "Mercado Pago / PIX";
  if (method.includes("cart") || method.includes("stripe")) return "Stripe / Cartão";
  return normalizeText(paymentMethod, "Provedor automático");
}

function createVerificationCode(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.filter(Boolean).join(":"))
    .digest("hex")
    .slice(0, 24)
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function createNumericReceiptId(parts) {
  const raw = crypto
    .createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex");
  const number = BigInt(`0x${raw.slice(0, 15)}`).toString().slice(0, 14);
  return number.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function drawText(doc, text, x, y, options = {}) {
  const {
    width,
    size = 10,
    font = "Helvetica",
    color = COLORS.ink,
    align = "left",
    lineGap = 2
  } = options;
  doc.fillColor(color).font(font).fontSize(size).text(text, x, y, { width, align, lineGap });
}

function drawRule(doc, x, y, width, color = COLORS.line) {
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor(color).lineWidth(1).stroke();
}

function drawLabelValue(doc, label, value, x, y, width, options = {}) {
  drawText(doc, label.toUpperCase(), x, y, {
    width,
    size: 7.5,
    font: "Helvetica-Bold",
    color: options.labelColor || COLORS.muted,
    align: options.align || "left"
  });
  drawText(doc, value, x, y + 13, {
    width,
    size: options.valueSize || 10.2,
    font: options.valueFont || "Helvetica",
    color: options.valueColor || COLORS.ink,
    align: options.align || "left",
    lineGap: 1.5
  });
}

function drawReceiptBackground(doc) {
  doc.rect(0, 0, PAGE.width, PAGE.height).fill("#EEF2F7");
  doc.roundedRect(34, 28, 527, 782, 18).fillAndStroke(COLORS.panel, "#CBD5E1");

  doc.save();
  doc.rotate(-28, { origin: [PAGE.width / 2, PAGE.height / 2] });
  doc
    .fillColor("#F1F5F9")
    .font("Helvetica-Bold")
    .fontSize(42)
    .text("BZNX STORE", 60, 420, { width: 520, align: "center" });
  doc.restore();
}

function drawBrandHeader(doc, botName, meta, issuedAt) {
  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");

  doc.roundedRect(34, 28, 527, 118, 18).fill(COLORS.brand);
  doc.rect(34, 128, 527, 18).fill(meta.color);

  try {
    doc.image(logoPath, 58, 54, { width: 58, height: 58 });
  } catch {
    doc.circle(87, 83, 29).fill("#1E293B");
    drawText(doc, "BX", 70, 74, { width: 34, align: "center", color: "#FFFFFF", font: "Helvetica-Bold", size: 16 });
  }

  drawText(doc, botName || "BznX Store", 132, 54, {
    width: 250,
    size: 22,
    font: "Helvetica-Bold",
    color: "#FFFFFF"
  });
  drawText(doc, "Comprovante de pagamento digital", 132, 82, {
    width: 250,
    size: 10.5,
    color: "#CBD5E1"
  });
  drawText(doc, "Bots, sites, automações e serviços digitais", 132, 100, {
    width: 260,
    size: 8.5,
    color: "#94A3B8"
  });

  doc.roundedRect(397, 54, 124, 34, 8).fill(meta.chipBg);
  drawText(doc, meta.label, 405, 65, {
    width: 108,
    align: "center",
    size: 8.8,
    font: "Helvetica-Bold",
    color: meta.chipText
  });

  drawText(doc, "Emitido em", 397, 98, { width: 124, size: 7.5, font: "Helvetica-Bold", color: "#CBD5E1" });
  drawText(doc, formatDate(issuedAt), 397, 110, { width: 124, size: 8.5, color: "#FFFFFF" });
}

function drawSectionTitle(doc, title, x, y) {
  drawText(doc, title, x, y, {
    width: 440,
    size: 11,
    font: "Helvetica-Bold",
    color: COLORS.ink
  });
  drawRule(doc, x, y + 19, 483);
}

function drawAmountPanel(doc, amount, orderId, meta) {
  doc.roundedRect(58, 166, 479, 86, 14).fillAndStroke("#F8FAFC", COLORS.line);
  drawText(doc, "Valor pago", 80, 184, {
    width: 180,
    size: 9,
    font: "Helvetica-Bold",
    color: COLORS.muted
  });
  drawText(doc, formatMoney(amount), 80, 202, {
    width: 220,
    size: 28,
    font: "Helvetica-Bold",
    color: COLORS.ink
  });

  doc.roundedRect(350, 183, 156, 42, 10).fill(meta.chipBg);
  drawText(doc, "Pedido", 365, 193, { width: 126, size: 7.5, font: "Helvetica-Bold", color: meta.chipText });
  drawText(doc, `#${orderId || "N/A"}`, 365, 206, {
    width: 126,
    size: 10.5,
    font: "Helvetica-Bold",
    color: meta.chipText
  });
}

function drawParticipantBlock(doc, title, rows, x, y, width) {
  doc.roundedRect(x, y, width, 126, 12).fillAndStroke(COLORS.panel, COLORS.line);
  drawText(doc, title, x + 16, y + 15, {
    width: width - 32,
    size: 10.5,
    font: "Helvetica-Bold",
    color: COLORS.ink
  });
  drawRule(doc, x + 16, y + 35, width - 32, "#E5E7EB");

  let cursor = y + 50;
  rows.forEach((row) => {
    drawLabelValue(doc, row.label, row.value, x + 16, cursor, width - 32, {
      valueSize: row.valueSize || 9.5,
      valueFont: row.bold ? "Helvetica-Bold" : "Helvetica"
    });
    cursor += 35;
  });
}

function drawTransactionTable(doc, data, x, y) {
  doc.roundedRect(x, y, 479, 168, 12).fillAndStroke(COLORS.panel, COLORS.line);
  doc.rect(x, y, 479, 32).fill("#F8FAFC");

  drawText(doc, "Detalhes da transação", x + 16, y + 11, {
    width: 210,
    size: 10,
    font: "Helvetica-Bold",
    color: COLORS.ink
  });

  const rows = [
    ["Produto/serviço", data.productName],
    ["Código do produto", data.productId],
    ["Forma de pagamento", data.paymentMethod],
    ["Intermediador", data.provider],
    ["ID do pagamento", data.providerPaymentId],
    ["Canal/carrinho", data.channelId]
  ];

  let cursor = y + 44;
  rows.forEach(([label, value], index) => {
    if (index > 0) drawRule(doc, x + 16, cursor - 8, 447, "#EEF2F7");
    drawText(doc, label, x + 16, cursor, {
      width: 145,
      size: 8.2,
      font: "Helvetica-Bold",
      color: COLORS.muted
    });
    drawText(doc, shorten(value, 70), x + 176, cursor, {
      width: 287,
      size: 9.4,
      font: index === 0 ? "Helvetica-Bold" : "Helvetica",
      color: COLORS.ink
    });
    cursor += 20;
  });
}

function drawFinancialSummary(doc, amount, coupon, x, y) {
  doc.roundedRect(x, y, 230, 104, 12).fillAndStroke("#F8FAFC", COLORS.line);
  drawText(doc, "Resumo financeiro", x + 16, y + 15, {
    width: 198,
    size: 10.5,
    font: "Helvetica-Bold",
    color: COLORS.ink
  });

  const couponText = coupon?.code ? coupon.code.toUpperCase() : "Não aplicado";
  drawLabelValue(doc, "Cupom", couponText, x + 16, y + 42, 90);
  drawLabelValue(doc, "Total confirmado", formatMoney(amount), x + 118, y + 42, 96, {
    align: "right",
    valueSize: 13,
    valueFont: "Helvetica-Bold",
    valueColor: COLORS.green
  });

  drawRule(doc, x + 16, y + 83, 198, "#E5E7EB");
  drawText(doc, "Operação confirmada automaticamente pelo provedor de pagamento.", x + 16, y + 90, {
    width: 198,
    size: 7.4,
    color: COLORS.muted
  });
}

function drawVerificationMatrix(doc, code, x, y) {
  doc.roundedRect(x, y, 230, 104, 12).fillAndStroke(COLORS.panel, COLORS.line);
  drawText(doc, "Autenticação", x + 16, y + 15, {
    width: 120,
    size: 10.5,
    font: "Helvetica-Bold",
    color: COLORS.ink
  });

  const compact = code.replace(/\s/g, "");
  const hash = crypto.createHash("sha256").update(compact).digest();
  const startX = x + 166;
  const startY = y + 18;
  const cell = 4;

  doc.rect(startX - 5, startY - 5, 45, 45).fill("#FFFFFF").strokeColor("#CBD5E1").stroke();
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const bit = hash[(row * 9 + col) % hash.length] + row + col;
      if (bit % 3 !== 0) {
        doc.rect(startX + col * cell, startY + row * cell, cell, cell).fill(bit % 2 ? COLORS.ink : COLORS.blue);
      }
    }
  }

  drawText(doc, code, x + 16, y + 40, {
    width: 135,
    size: 12,
    font: "Courier-Bold",
    color: COLORS.ink,
    lineGap: 4
  });
  drawText(doc, "Código interno para conferência do pedido e do pagamento.", x + 16, y + 78, {
    width: 198,
    size: 7.5,
    color: COLORS.muted
  });
}

function drawMechanicalAuth(doc, receiptId, verificationCode, checkoutUrl) {
  drawRule(doc, 58, 742, 479, COLORS.line);
  drawText(doc, "AUTENTICAÇÃO MECÂNICA", 58, 758, {
    width: 180,
    size: 8,
    font: "Helvetica-Bold",
    color: COLORS.muted
  });
  drawText(doc, `${receiptId}  ${verificationCode.replace(/\s/g, "")}`, 58, 773, {
    width: 479,
    size: 11,
    font: "Courier-Bold",
    color: COLORS.ink
  });

  drawText(doc, [
    "Documento interno de confirmação da BznX Store. Não é nota fiscal, boleto, extrato bancário ou documento tributário.",
    `Link de pagamento: ${shorten(checkoutUrl, 84)}`
  ].join(" "), 58, 795, {
    width: 479,
    size: 7.3,
    color: COLORS.faint,
    align: "center"
  });
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
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    info: {
      Title: `Comprovante ${orderId || "BznX"}`,
      Author: botName || "BznX Store",
      Subject: "Comprovante de pagamento digital"
    }
  });

  const meta = statusMeta(status);
  const productName = normalizeText(product?.name, "Produto digital");
  const productId = normalizeText(product?.id, "produto");
  const customerName = normalizeText(user?.tag || user?.username || user?.id, "Cliente Discord");
  const verificationCode = createVerificationCode([
    botName,
    guildId,
    channelId,
    user?.id,
    productId,
    amount,
    providerPaymentId,
    orderId
  ]);
  const receiptId = createNumericReceiptId([verificationCode, issuedAt, providerPaymentId, orderId]);

  drawReceiptBackground(doc);
  drawBrandHeader(doc, botName, meta, issuedAt);
  drawAmountPanel(doc, amount, orderId, meta);

  drawSectionTitle(doc, "Dados do comprovante", 58, 276);
  drawParticipantBlock(doc, "Pagador", [
    { label: "Cliente", value: customerName, bold: true },
    { label: "ID Discord", value: normalizeText(user?.id) }
  ], 58, 312, 230);
  drawParticipantBlock(doc, "Recebedor", [
    { label: "Nome", value: botName || "BznX Store", bold: true },
    { label: "Tipo", value: "Loja digital / serviços online" }
  ], 307, 312, 230);

  drawTransactionTable(doc, {
    productName,
    productId,
    paymentMethod: normalizeText(paymentMethod),
    provider: paymentProviderName(paymentMethod),
    providerPaymentId: normalizeText(providerPaymentId),
    channelId: normalizeText(channelId)
  }, 58, 468);

  drawFinancialSummary(doc, amount, coupon, 58, 658);
  drawVerificationMatrix(doc, verificationCode, 307, 658);
  drawMechanicalAuth(doc, receiptId, verificationCode, checkoutUrl);

  const pdfBuffer = await buildPdfBuffer(doc);
  const safeOrderId = String(orderId || Date.now()).replace(/[^\w-]/g, "");
  const safeStatus = String(status || "status").toLowerCase().replace(/[^\w-]+/g, "-");

  return new AttachmentBuilder(pdfBuffer, {
    name: `comprovante-bznx-${safeOrderId}-${safeStatus}.pdf`
  });
}

async function sendReceiptToPrivateChannel(client, config, receiptData, status) {
  const channelId = process.env.RECEIPT_CHANNEL_ID || config.logChannels?.comprovantes || DEFAULT_RECEIPT_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const attachment = await createReceiptAttachment({ ...receiptData, botName: config.botName, status });
  const paid = status === "PAGO";
  const embed = new EmbedBuilder()
    .setColor(paid ? (config.colors?.success || 0x16A34A) : (config.colors?.warning || 0xF59E0B))
    .setTitle(paid ? "📄 Comprovante final emitido" : "🧾 Pré-comprovante emitido")
    .setDescription([
      `Cliente: <@${receiptData.user?.id || receiptData.userId}>`,
      `Produto: **${receiptData.product?.name || "N/A"}**`,
      `Valor: **${formatMoney(receiptData.amount)}**`,
      `Pedido: **#${receiptData.orderId || "N/A"}**`,
      `Status: **${paid ? "pagamento aprovado" : status}**`,
      "",
      "O PDF foi gerado com autenticação interna, resumo financeiro e dados do pagamento."
    ].join("\n"))
    .setFooter({ text: `${config.botName} • Comprovantes` })
    .setTimestamp();

  await channel.send({ embeds: [embed], files: [attachment] });
  return true;
}

async function sendReceiptDM(client, config, receiptData, status) {
  if (process.env.SEND_RECEIPT_DM !== "true") return false;
  const user = receiptData.user || await client.users.fetch(receiptData.userId).catch(() => null);
  if (!user?.send) return false;

  const paid = status === "PAGO";
  const attachment = await createReceiptAttachment({ ...receiptData, botName: config.botName, status });
  await user.send({
    content: paid
      ? "📄 Seu comprovante final da BznX Store foi emitido. O arquivo PDF está anexado abaixo."
      : "🧾 Seu pré-comprovante da BznX Store foi emitido. O arquivo PDF está anexado abaixo.",
    files: [attachment]
  }).catch(() => null);
  return true;
}

module.exports = {
  createReceiptAttachment,
  sendReceiptDM,
  sendReceiptToPrivateChannel
};
