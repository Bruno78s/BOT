const { get, run, all } = require("../database/db");

const defaultAutoResponses = [
  {
    keywords: ["preço", "valor", "quanto", "custa"],
    response: "💰 **Informações de Preço**\n\nOs preços dos produtos estão disponíveis no canal de vendas. Para ver os produtos e preços, use o comando `/comprar` ou visite nosso canal de vendas.",
    category: "pricing"
  },
  {
    keywords: ["pagamento", "pix", "mercado pago", "asaas"],
    response: "💳 **Formas de Pagamento**\n\nAceitamos PIX via Mercado Pago e Asaas. O pagamento é processado automaticamente e assim que aprovado, você pode abrir um ticket de entrega para receber o produto.",
    category: "payment"
  },
  {
    keywords: ["entrega", "receber", "quando", "demora"],
    response: "📦 **Entrega**\n\nA entrega é feita manualmente pela equipe após confirmação do pagamento. Após o pagamento ser aprovado, abra um ticket de entrega e aguarde um staff assumir.",
    category: "delivery"
  },
  {
    keywords: ["reembolso", "devolução", "dinheiro"],
    response: "↩️ **Reembolso**\n\nNão fazemos reembolsos após a entrega do produto. Caso haja problemas com o produto, abra um ticket de suporte para análise.",
    category: "refund"
  },
  {
    keywords: ["suporte", "ajuda", "problema", "erro"],
    response: "🆘 **Suporte**\n\nPara problemas técnicos ou dúvidas, abra um ticket de suporte usando o comando `/ticket`. Nossa equipe vai te ajudar o mais rápido possível.",
    category: "support"
  },
  {
    keywords: ["comprar", "produto", "bot"],
    response: "🛒 **Como Comprar**\n\nPara comprar, use o comando `/comprar` e selecione o produto desejado. Siga as instruções para pagamento e, após aprovação, abra um ticket de entrega.",
    category: "purchase"
  }
];

async function initializeAutoResponses(guildId) {
  const existing = await get("SELECT COUNT(*) as count FROM auto_responses WHERE guild_id = ?", [guildId]);
  if (existing.count > 0) return;

  for (const ar of defaultAutoResponses) {
    await run(
      "INSERT INTO auto_responses (guild_id, keywords, response, category, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
      [guildId, JSON.stringify(ar.keywords), ar.response, ar.category, Date.now()]
    );
  }
}

async function getAutoResponses(guildId) {
  const responses = await all("SELECT * FROM auto_responses WHERE guild_id = ? AND enabled = 1", [guildId]);
  return responses.map(r => ({
    ...r,
    keywords: JSON.parse(r.keywords)
  }));
}

async function findAutoResponse(guildId, message) {
  const responses = await getAutoResponses(guildId);
  const lowerMessage = message.toLowerCase();

  for (const response of responses) {
    const matchedKeywords = response.keywords.filter(keyword => 
      lowerMessage.includes(keyword.toLowerCase())
    );

    if (matchedKeywords.length > 0) {
      return response;
    }
  }

  return null;
}

async function addAutoResponse(guildId, keywords, response, category) {
  await run(
    "INSERT INTO auto_responses (guild_id, keywords, response, category, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
    [guildId, JSON.stringify(keywords), response, category, Date.now()]
  );
}

async function updateAutoResponse(id, keywords, response, category, enabled) {
  await run(
    "UPDATE auto_responses SET keywords = ?, response = ?, category = ?, enabled = ? WHERE id = ?",
    [JSON.stringify(keywords), response, category, enabled ? 1 : 0, id]
  );
}

async function deleteAutoResponse(id) {
  await run("DELETE FROM auto_responses WHERE id = ?", [id]);
}

module.exports = {
  initializeAutoResponses,
  getAutoResponses,
  findAutoResponse,
  addAutoResponse,
  updateAutoResponse,
  deleteAutoResponse
};
