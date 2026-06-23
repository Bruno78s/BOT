const axios = require("axios");
const crypto = require("crypto");
const { all, get, run } = require("../database/db");

const STRIPE_API_URL = "https://api.stripe.com/v1";

function getStripeSecretKey() {
  const secretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY nao configurado no .env.");
  }
  return secretKey;
}

function encodeForm(data, prefix = "") {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const formKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          const nested = encodeForm(item, `${formKey}[${index}]`);
          nested.forEach((nestedValue, nestedKey) => params.append(nestedKey, nestedValue));
        } else {
          params.append(`${formKey}[]`, String(item));
        }
      });
      continue;
    }

    if (typeof value === "object") {
      const nested = encodeForm(value, formKey);
      nested.forEach((nestedValue, nestedKey) => params.append(nestedKey, nestedValue));
      continue;
    }

    params.append(formKey, String(value));
  }

  return params;
}

async function stripeRequest(method, path, body = null) {
  const secretKey = getStripeSecretKey();
  const payload = body ? encodeForm(body) : undefined;
  const response = await axios({
    method,
    url: `${STRIPE_API_URL}${path}`,
    data: payload,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    timeout: 20000
  });
  return response.data;
}

function getCheckoutUrls(channelId) {
  const baseUrl = (process.env.BZNX_SITE_URL || process.env.CLIENT_URL || "https://bznx-store.duckdns.org").replace(/\/+$/, "");
  return {
    successUrl: process.env.STRIPE_SUCCESS_URL || `${baseUrl}/pagamento/sucesso?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: process.env.STRIPE_CANCEL_URL || `${baseUrl}/pagamento/cancelado?channel_id=${channelId}`
  };
}

async function createCardCheckoutSession({ guildId, channelId, userId, product, user, couponId = null }) {
  const amountCents = Math.max(50, Math.round(Number(product.price) * 100));
  const { successUrl, cancelUrl } = getCheckoutUrls(channelId);

  const session = await stripeRequest("post", "/checkout/sessions", {
    mode: "payment",
    client_reference_id: channelId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_method_types: ["card"],
    customer_email: user?.email,
    metadata: {
      guild_id: guildId,
      channel_id: channelId,
      user_id: userId,
      product_id: product.id
    },
    payment_intent_data: {
      metadata: {
        guild_id: guildId,
        channel_id: channelId,
        user_id: userId,
        product_id: product.id
      }
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: amountCents,
          product_data: {
            name: product.name,
            description: product.description || product.name
          }
        }
      }
    ]
  });

  await run(
    "INSERT INTO payments (guild_id, channel_id, user_id, product_id, provider, provider_payment_id, preference_id, coupon_id, status, amount, checkout_url, created_at) VALUES (?, ?, ?, ?, 'stripe', ?, ?, ?, 'pending', ?, ?, ?)",
    [guildId, channelId, userId, product.id, session.id, session.payment_intent || null, couponId, Number(product.price), session.url, Date.now()]
  );

  return {
    method: "card",
    paymentId: session.id,
    checkoutUrl: session.url
  };
}

async function fetchCardCheckoutSession(sessionId) {
  const params = new URLSearchParams();
  params.append("expand[]", "payment_intent");
  return stripeRequest("get", `/checkout/sessions/${sessionId}?${params.toString()}`);
}

async function getStripePaymentBySessionId(sessionId) {
  return get("SELECT * FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?", [String(sessionId)]);
}

async function listPendingStripePayments(limit = 25) {
  const retryAfter = Date.now() - (48 * 60 * 60 * 1000);
  return all(
    "SELECT * FROM payments WHERE provider = 'stripe' AND provider_payment_id IS NOT NULL AND (status = 'pending' OR (status = 'expired' AND created_at >= ?)) ORDER BY created_at ASC LIMIT ?",
    [retryAfter, limit]
  );
}

async function updateStripePaymentStatus(sessionId, status, paymentIntentId = null) {
  await run(
    "UPDATE payments SET status = ?, preference_id = COALESCE(?, preference_id), updated_at = ? WHERE provider = 'stripe' AND provider_payment_id = ?",
    [status, paymentIntentId, Date.now(), String(sessionId)]
  );
}

function constructStripeWebhookEvent(rawBody, signatureHeader) {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) return JSON.parse(rawBody.toString("utf8"));
  if (!signatureHeader) throw new Error("Stripe signature ausente.");

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    })
  );
  if (!parts.t || !parts.v1) throw new Error("Stripe signature invalida.");

  const signedPayload = `${parts.t}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");

  const received = Buffer.from(parts.v1, "hex");
  const calculated = Buffer.from(expected, "hex");
  if (received.length !== calculated.length || !crypto.timingSafeEqual(received, calculated)) {
    throw new Error("Stripe signature nao confere.");
  }

  return JSON.parse(rawBody.toString("utf8"));
}

module.exports = {
  constructStripeWebhookEvent,
  createCardCheckoutSession,
  fetchCardCheckoutSession,
  getStripePaymentBySessionId,
  listPendingStripePayments,
  updateStripePaymentStatus
};
