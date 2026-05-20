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
  return new RegExp(`\\b${tier.replace("+", "\\+")}$`, "i").test(product.name)
    ? product.name
    : `${product.name} • ${tier}`;
}

function buildProductEmbed(config, group, products) {
  const sorted = [...products].sort((a, b) => {
    const order = ["premium", "platinum", "premium-plus", "diamond", "basic"];
    const tierOrder = order.indexOf(a.tier) - order.indexOf(b.tier);
    if (tierOrder !== 0) return tierOrder;
    return a.name.localeCompare(b.name);
  });

  const titleName = group === "site" ? "Sites" : sorted[0]?.name?.replace(/\s+(Basic|Premium|Platinum|Premium\+|Diamond)$/i, "") || group;
  const lines = sorted.map((product) => {
    const tier = formatTier(product.tier);
    const stock = product.stock > 0 ? product.stock : "Esgotado";
    return `**${tier}**\nValor: **${formatPrice(product.price)}**\nEstoque: **${stock}**\n${product.description}`;
  });

  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | ${titleName}`)
    .setDescription([
      "**Soluções prontas para automatizar e profissionalizar seu servidor.**",
      "",
      ...lines,
      "",
      "Selecione um plano abaixo para abrir seu carrinho."
    ].join("\n\n"))
    .setFooter({ text: "BznX Store • Produtos" })
    .setTimestamp();
}

function buildCartEmbed(config, user, product) {
  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Resumo da Compra`)
    .setDescription([
      `**Cliente:** ${user}`,
      `**Produto:** ${product.name}`,
      `**Plano:** ${formatTier(product.tier)}`,
      `**Valor:** ${formatPrice(product.price)}`,
      "",
      "Revise os dados do pedido e aceite os termos para continuar."
    ].join("\n"))
    .setFooter({ text: "BznX Store • Carrinho" })
    .setTimestamp();
}

function buildTermsEmbed(config, user, product) {
  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Termos de Serviço`)
    .setDescription([
      `Olá ${user}, leia os termos antes de continuar.`,
      "",
      "**1. Pagamento**",
      "O pedido só será processado após a confirmação do pagamento.",
      "",
      "**2. Entrega**",
      "O prazo pode variar conforme o produto e a demanda da equipe.",
      "",
      "**3. Suporte**",
      "O suporte cobre dúvidas e ajustes básicos relacionados ao serviço contratado.",
      "",
      "**4. Produto selecionado**",
      `${product.name} • ${formatTier(product.tier)} • ${formatPrice(product.price)}`,
      "",
      "Ao clicar em **Aceitar e Continuar**, você confirma que leu e concorda com estes termos."
    ].join("\n"))
    .setFooter({ text: "BznX Store • Termos" })
    .setTimestamp();
}

function buildSupportEmbed(config) {
  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Central de Atendimento`)
    .setDescription([
      "Utilize este painel para abrir um atendimento com a equipe.",
      "",
      "**Antes de abrir um ticket:**",
      "• informe o motivo com clareza",
      "• aguarde o retorno da equipe",
      "",
      "Selecione abaixo o tipo de atendimento desejado."
    ].join("\n"))
    .setFooter({ text: "BznX Store • Suporte" })
    .setTimestamp();
}

/**
 * Cria snapshot dos termos aceitos para registro
 */
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
