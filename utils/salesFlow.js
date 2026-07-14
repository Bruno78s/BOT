const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function readConfigFile() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfigFile(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getProductGroup(product) {
  return product.group || product.id.replace(/-(basic|premium)$/i, "");
}

function groupProducts(products) {
  const grouped = new Map();
  for (const product of products) {
    const group = getProductGroup(product);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(product);
  }
  return grouped;
}

function formatPrice(value) {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

function formatTier(tier) {
  const labels = {
    basic: "Basic",
    premium: "Premium",
    platinum: "Platinum",
    "premium-plus": "Premium+",
    diamond: "Diamond"
  };

  return labels[tier] || String(tier).replace(/(^|-)(\w)/g, (_, separator, letter) => `${separator ? " " : ""}${letter.toUpperCase()}`);
}

function getProductLabel(product) {
  const tier = formatTier(product.tier);
  return new RegExp(`\b${tier.replace("+", "\\+")}$`, "i").test(product.name)
    ? product.name
    : `${product.name} • ${tier}`;
}

function buildProductEmbed(config, group, products) {
  const sorted = [...products].sort((a, b) => {
    const order = ["basic", "standard", "premium", "registro", "livre", "platinum", "premium-plus", "diamond"];
    const tierOrder = order.indexOf(a.tier) - order.indexOf(b.tier);
    if (tierOrder !== 0) return tierOrder;
    return a.name.localeCompare(b.name);
  });

  const titleLabels = {
    site: "Sites",
    sites: "Sites",
    vps: "VPS",
    dominios: "Domínios"
  };
  const titleName = titleLabels[group] || sorted[0]?.name?.replace(/\s+(Basic|Premium|Platinum|Premium\+|Diamond)$/i, "") || group;
  const tierEmojis = {
    basic: "🔵",
    standard: "🟢",
    premium: "🟡",
    registro: "🌐",
    livre: "🌐",
    platinum: "⚪",
    "premium-plus": "🟣",
    diamond: "🔷"
  };

  const lines = sorted.map((product) => {
    const tier = formatTier(product.tier);
    const emoji = tierEmojis[product.tier] || "🟢";
    const stockText = product.stock === 0
      ? "❌ Esgotado"
      : product.stock < 5
      ? `⚠️ ${product.stock} restante(s)`
      : "✅ Em estoque";
    return [
      `${emoji} **${tier}** — ${formatPrice(product.price)}`,
      `> ${product.description || "Sem descrição."}`,
      `> ${stockText}`,
    ].join("\n");
  });

  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`🛍️ ${titleName}`)
    .setDescription([
      "> Escolha o plano ideal para o seu projeto.",
      "",
      ...lines,
      "",
      "─────────────────────────────",
      "📦 Selecione um plano abaixo para abrir seu carrinho."
    ].join("\n\n"))
    .setFooter({ text: `${config.botName} • Produtos` })
    .setTimestamp();
}

function buildCartEmbed(config, user, product) {
  const tierEmojis = { basic: "🔵", premium: "🟡", platinum: "⚪", "premium-plus": "🟣", diamond: "🔷" };
  const tierEmoji = tierEmojis[product.tier] || "🟢";
  return new EmbedBuilder()
    .setColor(0x00b4d8)
    .setTitle("🛒 Resumo do Carrinho")
    .setDescription("> Revise os dados do pedido e aceite os termos para continuar.")
    .addFields([
      { name: "👤 Cliente", value: `${user}`, inline: true },
      { name: `${tierEmoji} Produto`, value: product.name, inline: true },
      { name: "💰 Valor", value: formatPrice(product.price), inline: true },
      { name: "🎫 Plano", value: formatTier(product.tier), inline: true },
      { name: "📦 Categoria", value: (product.category || "produto").toUpperCase(), inline: true },
      { name: "📅 Data", value: `<t:${Math.floor(Date.now() / 1000)}:d>`, inline: true },
    ])
    .setFooter({ text: `${config.botName} • Carrinho` })
    .setTimestamp();
}

function buildTermsEmbed(config, user, product) {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("📜 Termos de Serviço")
    .setDescription(`Olá ${user}! Leia os termos abaixo antes de prosseguir.`)
    .addFields([
      { name: "💳 1. Pagamento", value: "O pedido só será processado após a confirmação do pagamento.", inline: false },
      { name: "🚚 2. Entrega", value: "O prazo pode variar conforme o produto e a demanda da equipe.", inline: false },
      { name: "🛡️ 3. Suporte", value: "O suporte cobre dúvidas e ajustes básicos do serviço contratado.", inline: false },
      { name: "📦 Produto Selecionado", value: `**${product.name}** • ${formatTier(product.tier)} • **${formatPrice(product.price)}**`, inline: false },
    ])
    .setFooter({ text: `${config.botName} • Ao aceitar, você concorda com os termos acima.` })
    .setTimestamp();
}

function buildSupportEmbed(config) {
  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Central de Atendimento`)
    .setDescription([
      "👋 Utilize este painel para abrir um atendimento com a equipe.",
      "",
      "**Antes de abrir um ticket:**",
      "• informe o motivo com clareza",
      "• aguarde o retorno da equipe",
      "",
      "🎫 Selecione abaixo o tipo de atendimento desejado."
    ].join("\n"))
    .setFooter({ text: `${config.botName} • Atendimento` })
    .setTimestamp();
}

function buildTermsSnapshot(user, product) {
  return JSON.stringify({
    userId: user.id,
    userTag: user.tag,
    productId: product.id,
    productName: product.name,
    productPrice: product.price,
    acceptedAt: Date.now()
  });
}

module.exports = {
  readConfigFile,
  writeConfigFile,
  getProductGroup,
  groupProducts,
  formatPrice,
  getProductLabel,
  buildProductEmbed,
  buildCartEmbed,
  buildTermsEmbed,
  buildSupportEmbed,
  buildTermsSnapshot
};
