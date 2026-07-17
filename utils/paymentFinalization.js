const { db } = require("../database/db");
const { getOrderCode } = require("./orders");
const { updateRuntimeStock } = require("./inventory");

const FULFILLMENT_PROCESSING = "processing";
const FULFILLMENT_PENDING = "pending";
const FULFILLMENT_COMPLETED = "completed";
const FULFILLMENT_FAILED = "failed";

function finalizePaymentLocally(config, paymentId) {
  const finalize = db.transaction(() => {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
    if (!payment) throw new Error(`Pagamento local ${paymentId} não encontrado.`);

    const product = config.products.find((item) => item.id === payment.product_id);
    if (!product) throw new Error(`Produto ${payment.product_id} não encontrado.`);

    if (payment.local_finalized_at) {
      const inventory = db.prepare("SELECT stock FROM product_inventory WHERE product_id = ?").get(payment.product_id);
      return { payment, product, remainingStock: Number(inventory?.stock ?? product.stock ?? 0), newlyFinalized: false };
    }

    const now = Date.now();
    db.prepare(
      "INSERT OR IGNORE INTO product_inventory (product_id, stock, updated_at) VALUES (?, ?, ?)"
    ).run(payment.product_id, Number(product.initialStock ?? product.stock ?? 0), now);

    const stockResult = db.prepare(
      "UPDATE product_inventory SET stock = stock - 1, updated_at = ? WHERE product_id = ? AND stock > 0"
    ).run(now, payment.product_id);
    const inventory = db.prepare("SELECT stock FROM product_inventory WHERE product_id = ?").get(payment.product_id);
    const remainingStock = Number(inventory?.stock ?? 0);
    const oversold = stockResult.changes !== 1;

    if (payment.coupon_id) {
      db.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?").run(payment.coupon_id);
    }

    db.prepare(
      `INSERT OR IGNORE INTO customer_profiles
       (guild_id, user_id, total_spent, total_orders, total_tickets, failed_payments, created_at, updated_at)
       VALUES (?, ?, 0, 0, 0, 0, ?, ?)`
    ).run(payment.guild_id, payment.user_id, now, now);
    db.prepare(
      `UPDATE customer_profiles
       SET total_spent = total_spent + ?, total_orders = total_orders + 1,
           last_order_at = ?, updated_at = ?
       WHERE guild_id = ? AND user_id = ?`
    ).run(Number(payment.amount || 0), now, now, payment.guild_id, payment.user_id);

    const orderCode = getOrderCode(payment, product);
    const initialFulfillment = product.deliveryUrl ? "delivered" : "preparing";
    db.prepare(
      `UPDATE payments
       SET status = 'approved', order_code = ?, fulfillment_status = ?,
           delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
           approved_at = COALESCE(approved_at, ?), local_finalized_at = ?,
           issue_reason = CASE WHEN ? THEN 'approved_without_stock' ELSE issue_reason END,
           updated_at = ?
       WHERE id = ? AND local_finalized_at IS NULL`
    ).run(orderCode, initialFulfillment, initialFulfillment, now, now, now, oversold ? 1 : 0, now, payment.id);

    db.prepare(
      `INSERT OR IGNORE INTO payment_fulfillment_jobs
       (payment_id, status, attempts, created_at, updated_at)
       VALUES (?, 'pending', 0, ?, ?)`
    ).run(payment.id, now, now);

    const updated = db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id);
    return { payment: updated, product, remainingStock, newlyFinalized: true, oversold };
  });

  const result = finalize();
  updateRuntimeStock(config, result.payment.product_id, result.remainingStock);
  return result;
}

function claimPaymentFulfillment(paymentId) {
  const now = Date.now();
  const result = db.prepare(
    `UPDATE payment_fulfillment_jobs
     SET status = ?, attempts = attempts + 1, claimed_at = ?, updated_at = ?, last_error = NULL
     WHERE payment_id = ? AND status = ?`
  ).run(FULFILLMENT_PROCESSING, now, now, paymentId, FULFILLMENT_PENDING);
  const job = db.prepare("SELECT * FROM payment_fulfillment_jobs WHERE payment_id = ?").get(paymentId);
  return { claimed: result.changes === 1, job };
}

function completePaymentFulfillment(paymentId) {
  const now = Date.now();
  db.prepare(
    "UPDATE payment_fulfillment_jobs SET status = ?, completed_at = ?, updated_at = ? WHERE payment_id = ?"
  ).run(FULFILLMENT_COMPLETED, now, now, paymentId);
}

function failPaymentFulfillment(paymentId, error) {
  const now = Date.now();
  db.prepare(
    "UPDATE payment_fulfillment_jobs SET status = ?, last_error = ?, updated_at = ? WHERE payment_id = ?"
  ).run(FULFILLMENT_FAILED, String(error?.message || error || "erro desconhecido").slice(0, 1000), now, paymentId);
  db.prepare(
    "UPDATE payments SET fulfillment_status = 'problem', issue_reason = ?, updated_at = ? WHERE id = ?"
  ).run(String(error?.message || error || "falha na entrega").slice(0, 500), now, paymentId);
}

function listPendingFulfillments(limit = 25) {
  return db.prepare(
    `SELECT p.* FROM payments p
     JOIN payment_fulfillment_jobs j ON j.payment_id = p.id
     WHERE p.status = 'approved' AND j.status = 'pending'
     ORDER BY j.created_at ASC LIMIT ?`
  ).all(limit);
}

module.exports = {
  claimPaymentFulfillment,
  completePaymentFulfillment,
  failPaymentFulfillment,
  finalizePaymentLocally,
  listPendingFulfillments
};