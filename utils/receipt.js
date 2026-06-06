const PDFDocument = require("pdfkit");
const { AttachmentBuilder } = require("discord.js");

function buildPdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

async function createReceiptAttachment({ botName, guildId, channelId, user, product, amount, paymentMethod, checkoutUrl, providerPaymentId, coupon, orderId }) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  doc.fontSize(18).text(`${botName} - Comprovante de Pagamento`, { align: "center" });
  doc.moveDown();

  doc.fontSize(12);
  doc.text(`Pedido: ${orderId}`);
  doc.text(`Guild: ${guildId}`);
  doc.text(`Canal: ${channelId}`);
  doc.text(`Cliente: ${user.tag} (${user.id})`);
  doc.moveDown();

  doc.text(`Produto: ${product.name}`);
  doc.text(`Valor: R$ ${Number(amount).toFixed(2)}`);
  doc.text(`Método: ${paymentMethod}`);
  doc.text(`Identificador de pagamento: ${providerPaymentId || "N/A"}`);
  if (coupon) {
    doc.text(`Cupom: ${coupon.code.toUpperCase()} (desconto aplicado)`);
  }
  doc.text(`URL de pagamento: ${checkoutUrl || "N/A"}`);
  doc.moveDown();

  doc.text(`Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  doc.moveDown();

  doc.fontSize(10).fillColor("gray");
  doc.text("Este documento é o comprovante gerado automaticamente pelo bot.", { align: "left" });
  doc.text("Use o link de pagamento acima para concluir a transação.", { align: "left" });

  const pdfBuffer = await buildPdfBuffer(doc);

  return new AttachmentBuilder(pdfBuffer, {
    name: `comprovante-${orderId || Date.now()}.pdf`
  });
}

module.exports = {
  createReceiptAttachment
};
