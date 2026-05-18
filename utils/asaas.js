const axios = require("axios");

function getClient() {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) {
    throw new Error("ASAAS_API_KEY não configurado no .env.");
  }
  
  const isProduction = apiKey.length > 50;
  const baseURL = isProduction 
    ? "https://www.asaas.com/api/v3" 
    : "https://sandbox.asaas.com/api/v3";
  
  console.log(`[Asaas] Chave API length: ${apiKey.length}, Ambiente: ${isProduction ? "PRODUÇÃO" : "SANDBOX"}, URL: ${baseURL}`);
  
  return axios.create({
    baseURL,
    headers: {
      access_token: apiKey,
      "Content-Type": "application/json"
    }
  });
}

async function createPixPayment({ guildId, channelId, userId, product, user }) {
  const client = getClient();
  
  try {
    const customerId = await getOrCreateCustomer({ userId, user });
    console.log("[Asaas] Customer ID:", customerId);
    
    const response = await client.post("/payments", {
      billingType: "PIX",
      customer: customerId,
      value: Number(product.price),
      description: product.name,
      externalReference: channelId,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      postalService: false
    });

    const payment = response.data;
    console.log("[Asaas] Payment created:", payment.id);
    
    const { run } = require("../database/db");
    await run(
      "INSERT INTO payments (guild_id, channel_id, user_id, product_id, provider, provider_payment_id, preference_id, status, amount, checkout_url, created_at) VALUES (?, ?, ?, ?, 'asaas', ?, ?, 'pending', ?, ?, ?)",
      [guildId, channelId, userId, product.id, payment.id, payment.id, Number(product.price), payment.invoiceUrl, Date.now()]
    );

    const qrCodeResponse = await client.get(`/payments/${payment.id}/pixQrCode`);
    const qrCodeData = qrCodeResponse.data;

    return {
      method: "pix",
      paymentId: payment.id,
      checkoutUrl: payment.invoiceUrl,
      qrCode: qrCodeData?.encodedImage || null,
      qrCodeBase64: qrCodeData?.payload || null,
      copyPasteCode: qrCodeData?.payload || null
    };
  } catch (error) {
    console.error("[Asaas] Erro ao criar pagamento:", error.response?.data || error.message);
    throw error;
  }
}

async function getOrCreateCustomer({ userId, user }) {
  const client = getClient();
  console.log("[Asaas] Creating customer for user:", userId);
  const configuredCpfCnpj = String(process.env.ASAAS_CUSTOMER_CPF_CNPJ || "").replace(/\D/g, "");
  
  try {
    const response = await client.get("/customers", {
      params: {
        email: `${userId}@asaas-temp.com`,
        limit: 1
      }
    });

    if (response.data.data && response.data.data.length > 0) {
      const existingCustomer = response.data.data[0];
      console.log("[Asaas] Customer found:", existingCustomer.id);
      
      if (!existingCustomer.cpfCnpj) {
        if (!configuredCpfCnpj) {
          throw new Error("Cliente Asaas sem CPF/CNPJ. Configure ASAAS_CUSTOMER_CPF_CNPJ no .env com um CPF/CNPJ válido para cobranças PIX.");
        }

        console.log("[Asaas] Customer has no CPF, updating...");
        await client.put(`/customers/${existingCustomer.id}`, {
          cpfCnpj: configuredCpfCnpj
        });
        console.log("[Asaas] Customer CPF updated");
      }
      
      return existingCustomer.id;
    }
  } catch (error) {
    console.error("[Asaas] Erro ao buscar cliente:", error.response?.data || error.message);
    if (error.message?.includes("CPF/CNPJ")) {
      throw error;
    }
  }

  console.log("[Asaas] Creating new customer...");
  if (!configuredCpfCnpj) {
    throw new Error("Configure ASAAS_CUSTOMER_CPF_CNPJ no .env com um CPF/CNPJ válido para criar cobranças PIX no Asaas.");
  }

  try {
    const createResponse = await client.post("/customers", {
      name: user?.username || `Cliente ${userId}`,
      email: `${userId}@asaas-temp.com`,
      phone: "21983589822",
      mobilePhone: "21983589822",
      cpfCnpj: configuredCpfCnpj
    });
    console.log("[Asaas] Customer created:", createResponse.data.id);
    return createResponse.data.id;
  } catch (error) {
    console.error("[Asaas] Erro ao criar cliente:", error.response?.data || error.message);
    throw new Error("Erro ao criar cliente Asaas: " + (error.response?.data?.errors?.[0]?.description || error.message));
  }
}

async function getPayment(paymentId) {
  const client = getClient();
  const response = await client.get(`/payments/${paymentId}`);
  return response.data;
}

async function updatePaymentStatusByProviderId(providerPaymentId, status) {
  const { run } = require("../database/db");
  await run("UPDATE payments SET status = ? WHERE provider_payment_id = ?", [status, String(providerPaymentId)]);
}

async function getPaymentByProviderPaymentId(providerPaymentId) {
  const { get } = require("../database/db");
  return get("SELECT * FROM payments WHERE provider_payment_id = ?", [String(providerPaymentId)]);
}

async function getPendingPaymentByChannel(channelId) {
  const { get } = require("../database/db");
  return get("SELECT * FROM payments WHERE channel_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [channelId]);
}

module.exports = {
  createPixPayment,
  getPayment,
  updatePaymentStatusByProviderId,
  getPaymentByProviderPaymentId,
  getPendingPaymentByChannel
};
