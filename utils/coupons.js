const { get, run, all } = require("../database/db");

async function createCoupon(guildId, code, discountType, discountValue, options = {}) {
  const { maxUses, minAmount, expiresAt, productId, paymentMethod, roleId, firstPurchaseOnly, perUserLimit } = options;
  
  run(
    "INSERT INTO coupons (guild_id, code, discount_type, discount_value, max_uses, min_amount, payment_method, role_id, first_purchase_only, per_user_limit, product_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [guildId, code.toUpperCase(), discountType, discountValue, maxUses || null, minAmount || null, paymentMethod || null, roleId || null, firstPurchaseOnly ? 1 : 0, perUserLimit || null, productId || null, expiresAt || null, Date.now()]
  );
  
  return { success: true };
}

async function getCoupon(guildId, code) {
  return get("SELECT * FROM coupons WHERE guild_id = ? AND code = ? AND enabled = 1", [guildId, code.toUpperCase()]);
}

async function listCoupons(guildId) {
  return all("SELECT * FROM coupons WHERE guild_id = ? ORDER BY created_at DESC", [guildId]);
}

async function updateCoupon(id, updates) {
  const fields = [];
  const values = [];
  
  if (updates.discount_type !== undefined) {
    fields.push("discount_type = ?");
    values.push(updates.discount_type);
  }
  if (updates.discount_value !== undefined) {
    fields.push("discount_value = ?");
    values.push(updates.discount_value);
  }
  if (updates.max_uses !== undefined) {
    fields.push("max_uses = ?");
    values.push(updates.max_uses);
  }
  if (updates.min_amount !== undefined) {
    fields.push("min_amount = ?");
    values.push(updates.min_amount);
  }
  if (updates.expires_at !== undefined) {
    fields.push("expires_at = ?");
    values.push(updates.expires_at);
  }
  if (updates.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(updates.enabled);
  }
  
  if (fields.length === 0) return { success: false };
  
  values.push(id);
  run(`UPDATE coupons SET ${fields.join(", ")} WHERE id = ?`, values);
  
  return { success: true };
}

async function deleteCoupon(id) {
  run("DELETE FROM coupons WHERE id = ?", [id]);
  return { success: true };
}

async function validateCoupon(guildId, code, amount, productId = null) {
  const coupon = await getCoupon(guildId, code);
  
  if (!coupon) {
    return { valid: false, reason: "Cupom não encontrado" };
  }
  
  if (!coupon.enabled) {
    return { valid: false, reason: "Cupom desativado" };
  }
  
  if (coupon.expires_at && coupon.expires_at < Date.now()) {
    return { valid: false, reason: "Cupom expirado" };
  }
  
  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    return { valid: false, reason: "Cupom esgotado" };
  }
  
  if (coupon.min_amount && amount < coupon.min_amount) {
    return { valid: false, reason: `Valor mínimo: R$ ${coupon.min_amount.toFixed(2)}` };
  }
  
  if (coupon.product_id && productId !== coupon.product_id) {
    return { valid: false, reason: "Cupom não válido para este produto" };
  }
  
  return { valid: true, coupon };
}

async function validateCouponForCheckout(guildId, code, amount, productId, member, method) {
  const result = await validateCoupon(guildId, code, amount, productId);
  if (!result.valid) return result;

  const coupon = result.coupon;
  if (coupon.payment_method && coupon.payment_method !== "any" && coupon.payment_method !== method) {
    return { valid: false, reason: `Cupom válido apenas para ${coupon.payment_method === "card" ? "cartão" : "PIX"}` };
  }

  if (coupon.role_id && !member?.roles?.cache?.has(coupon.role_id)) {
    return { valid: false, reason: "Cupom disponível apenas para um cargo específico" };
  }

  if (coupon.first_purchase_only) {
    const previous = get("SELECT COUNT(*) as total FROM payments WHERE guild_id = ? AND user_id = ? AND status = 'approved'", [guildId, member.id]);
    if ((previous?.total || 0) > 0) {
      return { valid: false, reason: "Cupom válido apenas para primeira compra" };
    }
  }

  if (coupon.per_user_limit) {
    const usage = get("SELECT COUNT(*) as total FROM payments WHERE guild_id = ? AND user_id = ? AND coupon_id = ? AND status = 'approved'", [guildId, member.id, coupon.id]);
    if ((usage?.total || 0) >= coupon.per_user_limit) {
      return { valid: false, reason: "Você já atingiu o limite de uso deste cupom" };
    }
  }

  return { valid: true, coupon };
}

async function useCoupon(couponId) {
  run("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?", [couponId]);
}

function calculateDiscount(amount, coupon) {
  if (!coupon) return 0;
  
  let discount = 0;
  if (coupon.discount_type === "percentage") {
    discount = amount * (coupon.discount_value / 100);
  } else if (coupon.discount_type === "fixed") {
    discount = Math.min(coupon.discount_value, amount);
  }
  
  return Math.round(discount * 100) / 100;
}

module.exports = {
  createCoupon,
  getCoupon,
  listCoupons,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  validateCouponForCheckout,
  useCoupon,
  calculateDiscount
};
