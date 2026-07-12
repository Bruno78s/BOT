const { get, all, run } = require("../database/db");
const { formatPrice } = require("./salesFlow");

function ensureCustomer(guildId, userId) {
  run(
    `INSERT OR IGNORE INTO customer_profiles
      (guild_id, user_id, total_spent, total_orders, total_tickets, failed_payments, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, ?, ?)`,
    [guildId, userId, Date.now(), Date.now()]
  );
}

function recordCustomerOrder(payment) {
  if (!payment?.guild_id || !payment?.user_id || payment.status !== "approved") return;
  ensureCustomer(payment.guild_id, payment.user_id);
  run(
    `UPDATE customer_profiles
     SET total_spent = total_spent + ?,
         total_orders = total_orders + 1,
         last_order_at = ?,
         updated_at = ?
     WHERE guild_id = ? AND user_id = ?`,
    [Number(payment.amount || 0), Date.now(), Date.now(), payment.guild_id, payment.user_id]
  );
}

function recordCustomerTicket(ticket) {
  if (!ticket?.guild_id || !ticket?.user_id) return;
  ensureCustomer(ticket.guild_id, ticket.user_id);
  run(
    `UPDATE customer_profiles
     SET total_tickets = total_tickets + 1,
         updated_at = ?
     WHERE guild_id = ? AND user_id = ?`,
    [Date.now(), ticket.guild_id, ticket.user_id]
  );
}

function recordFailedPayment(payment) {
  if (!payment?.guild_id || !payment?.user_id) return;
  ensureCustomer(payment.guild_id, payment.user_id);
  run(
    `UPDATE customer_profiles
     SET failed_payments = failed_payments + 1,
         updated_at = ?
     WHERE guild_id = ? AND user_id = ?`,
    [Date.now(), payment.guild_id, payment.user_id]
  );
}

function getCustomerProfile(guildId, userId) {
  ensureCustomer(guildId, userId);
  return get("SELECT * FROM customer_profiles WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
}

function listTopCustomers(guildId, limit = 10) {
  return all(
    `SELECT * FROM customer_profiles
     WHERE guild_id = ?
     ORDER BY total_spent DESC, total_orders DESC
     LIMIT ?`,
    [guildId, limit]
  );
}

function buildCustomerSummary(profile) {
  if (!profile) return "Cliente não encontrado.";
  return [
    `Total gasto: **${formatPrice(profile.total_spent || 0)}**`,
    `Pedidos: **${profile.total_orders || 0}**`,
    `Tickets: **${profile.total_tickets || 0}**`,
    `Falhas de pagamento: **${profile.failed_payments || 0}**`,
    `Última compra: **${profile.last_order_at ? `<t:${Math.floor(profile.last_order_at / 1000)}:R>` : "nunca"}**`,
    profile.vip_until ? `VIP até: **<t:${Math.floor(profile.vip_until / 1000)}:f>**` : null,
    profile.blacklisted ? "Status: **blacklist**" : "Status: **normal**",
    profile.notes ? `Notas internas: ${String(profile.notes).slice(0, 400)}` : null
  ].filter(Boolean).join("\n");
}

module.exports = {
  buildCustomerSummary,
  ensureCustomer,
  getCustomerProfile,
  listTopCustomers,
  recordCustomerOrder,
  recordCustomerTicket,
  recordFailedPayment
};
