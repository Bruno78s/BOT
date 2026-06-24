function getOrderCode(payment) {
  if (!payment) return "BZNX-0000-00000";
  if (payment.order_code) return payment.order_code;
  const year = new Date(payment.created_at || Date.now()).getFullYear();
  return `BZNX-${year}-${String(payment.id || 0).padStart(5, "0")}`;
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
  getOrderCode
};
