const crypto = require("crypto");

function normalizeOrderPart(value, fallback = "PROD") {
  const clean = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(BASIC|PREMIUM|PLATINUM|DIAMOND|PLUS|PRO)\b/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (clean || fallback).split("-").filter(Boolean).slice(0, 2).join("-").slice(0, 16) || fallback;
}

function createShortOrderHash(payment) {
  const source = [
    payment?.id,
    payment?.user_id,
    payment?.product_id,
    payment?.provider_payment_id,
    payment?.preference_id,
    payment?.created_at
  ].filter(Boolean).join(":");

  return crypto
    .createHash("sha256")
    .update(source || String(Date.now()))
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
}

function getOrderCode(payment, product = null) {
  if (!payment) return "BZNX-PEDIDO-000000";
  if (payment.order_code) return payment.order_code;

  const productPart = normalizeOrderPart(product?.name || payment.product_id, "PEDIDO");
  const shortCode = createShortOrderHash(payment);
  return `BZNX-${productPart}-${shortCode}`;
}

function getFulfillmentStatusLabel(status) {
  const labels = {
    awaiting_payment: "Aguardando pagamento",
    paid: "Pagamento aprovado",
    preparing: "Pedido em separação",
    delivered: "Entregue",
    finalized: "Finalizado",
    refunded: "Reembolsado",
    cancelled: "Cancelado",
    problem: "Problema com pagamento"
  };
  return labels[status] || labels.awaiting_payment;
}

module.exports = {
  getFulfillmentStatusLabel,
  getOrderCode,
  normalizeOrderPart
};
