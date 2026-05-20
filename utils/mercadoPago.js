const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");
const { get, run } = require("../database/db");

function getClient() {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN não configurado no .env.");
  }

  return new MercadoPagoConfig({ accessToken });
}

function getCredentialMode() {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || "";
  if (accessToken.startsWith("TEST-")) return "test";
  if (accessToken.startsWith("APP_USR-")) return "production";
  return "unknown";
}

function getPayerEmail(userId) {
  return (process.env.MERCADO_PAGO_PAYER_EMAIL || `cliente.${userId}@bznxstore.com`).trim();
}

async function createCheckoutPayment({ guildId, channelId, userId, product, user }) {
  try {
    return await createPixPayment({ guildId, channelId, userId, product, user });
  } catch (error) {
    const description = error?.message || error?.error || error?.cause?.[0]?.description || "";
    if (!String(description).toLowerCase().includes("unauthorized use of live credentials")) {
      throw error;
    }

    return createPreferencePayment({ guildId, channelId, userId, product, user, fallbackReason: description });
  }
}

async function createPixPayment({ guildId, channelId, userId, product, user }) {
  const client = getClient();
  const payment = new Payment(client);

  const response = await payment.create({
    body: {
      transaction_amount: Number(product.price),
      description: product.name,
      payment_method_id: "pix",
      external_reference: channelId,
      notification_url: process.env.MERCADO_PAGO_WEBHOOK_URL,
      payer: {
        email: getPayerEmail(userId),
        first_name: user?.username || "Cliente"
      },
      metadata: {
        guild_id: guildId,
        channel_id: channelId,
        user_id: userId,
        product_id: product.id
      }
    }
  });

  const qrCode = response.point_of_interaction?.transaction_data?.qr_code || null;
  const qrCodeBase64 = response.point_of_interaction?.transaction_data?.qr_code_base64 || null;
  const checkoutUrl = response.point_of_interaction?.transaction_data?.ticket_url || null;
  const copyPasteCode = response.point_of_interaction?.transaction_data?.qr_code || null;

  await run(
    "INSERT INTO payments (guild_id, channel_id, user_id, product_id, provider, provider_payment_id, preference_id, status, amount, checkout_url, created_at) VALUES (?, ?, ?, ?, 'mercadopago', ?, ?, 'pending', ?, ?, ?)",
    [guildId, channelId, userId, product.id, String(response.id), String(response.id), Number(product.price), checkoutUrl, Date.now()]
  );

  return {
    method: "pix",
    paymentId: response.id,
    checkoutUrl,
    qrCode,
    qrCodeBase64,
    copyPasteCode
  };
}

async function createPreferencePayment({ guildId, channelId, userId, product, user, fallbackReason }) {
  const client = getClient();
  const preference = new Preference(client);

  const response = await preference.create({
    body: {
      external_reference: channelId,
      notification_url: process.env.MERCADO_PAGO_WEBHOOK_URL,
      items: [
        {
          id: product.id,
          title: product.name,
          description: product.description || product.name,
          quantity: 1,
          currency_id: "BRL",
          unit_price: Number(product.price)
        }
      ],
      payer: {
        email: getPayerEmail(userId),
        name: user?.username || "Cliente"
      },
      metadata: {
        guild_id: guildId,
        channel_id: channelId,
        user_id: userId,
        product_id: product.id
      }
    }
  });

  const checkoutUrl = response.init_point || response.sandbox_init_point;

  await run(
    "INSERT INTO payments (guild_id, channel_id, user_id, product_id, provider, preference_id, status, amount, checkout_url, created_at) VALUES (?, ?, ?, ?, 'mercadopago', ?, 'pending', ?, ?, ?)",
    [guildId, channelId, userId, product.id, response.id, Number(product.price), checkoutUrl, Date.now()]
  );

  return {
    method: "checkout_pro",
    preferenceId: response.id,
    checkoutUrl,
    qrCode: null,
    qrCodeBase64: null,
    fallbackReason
  };
}

async function getPendingPaymentByChannel(channelId) {
  return get(
    "SELECT * FROM payments WHERE channel_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [channelId]
  );
}

async function getPaymentByProviderPaymentId(providerPaymentId) {
  return get("SELECT * FROM payments WHERE provider_payment_id = ?", [String(providerPaymentId)]);
}

async function updatePaymentStatusByProviderId(providerPaymentId, status) {
  await run(
    "UPDATE payments SET status = ?, updated_at = ? WHERE provider_payment_id = ?",
    [status, Date.now(), String(providerPaymentId)]
  );
}

async function attachProviderPaymentIdByReference(channelId, providerPaymentId, status) {
  await run(
    "UPDATE payments SET provider_payment_id = ?, status = ?, updated_at = ? WHERE channel_id = ? AND status = 'pending'",
    [String(providerPaymentId), status, Date.now(), channelId]
  );
}

async function fetchPayment(providerPaymentId) {
  const client = getClient();
  const payment = new Payment(client);
  return payment.get({ id: providerPaymentId });
}

module.exports = {
  createCheckoutPayment,
  getPendingPaymentByChannel,
  getPaymentByProviderPaymentId,
  updatePaymentStatusByProviderId,
  attachProviderPaymentIdByReference,
  fetchPayment,
  getCredentialMode
};
