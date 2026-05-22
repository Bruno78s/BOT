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
    const order = ["basic", "premium", "platinum", "premium-plus", "diamond"];
    const tierOrder = order.indexOf(a.tier) - order.indexOf(b.tier);
    if (tierOrder !== 0) return tierOrder;
    return a.name.localeCompare(b.name);
  });

  const titleName = group === "site" ? "Sites" : sorted[0]?.name?.replace(/\s+(Basic|Premium|Platinum|Premium\+|Diamond)$/i, "") || group;
  const tierEmojis = { basic: "\uD83D\uDD35", premium: "\uD83D\uDFE1", platinum: "\u26AA", "premium-plus": "\uD83D\uDFE3", diamond: "\uD83D\uDD37" };

  const lines = sorted.map((product) => {
    const tier = formatTier(product.tier);
    const emoji = tierEmojis[product.tier] || "\uD83D\uDFE2";
    const stockText = product.stock === 0
      ? "\u274C Esgotado"
      : product.stock < 5
      ? `\u26A0\uFE0F ${product.stock} restante(s)`
      : "\u2705 Em estoque";
    return [
      `${emoji} **${tier}** \u2014 ${formatPrice(product.price)}`,
      `> ${product.description || "Sem descri\u00E7\u00E3o."}`,
      `> ${stockText}`,
    ].join("\n");
  });

  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`\uD83D\uDECD\uFE0F ${titleName}`)
    .setDescription([
      "> Escolha o plano ideal para o seu projeto.",
      "",
      ...lines,
      "",
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
      "\uD83D\uDCE6 Selecione um plano abaixo para abrir seu carrinho."
    ].join("\n\n"))
    .setFooter({ text: `${config.botName} \u2022 Produtos` })
    .setTimestamp();
}

function buildCartEmbed(config, user, product) {
  const tierEmojis = { basic: "\uD83D\uDD35", premium: "\uD83D\uDFE1", platinum: "\u26AA", "premium-plus": "\uD83D\uDFE3", diamond: "\uD83D\uDD37" };
  const tierEmoji = tierEmojis[product.tier] || "\uD83D\uDC20";
  return new EmbedBuilder()
    .setColor(0x00b4d8)
    .setTitle("\uD83D\uDED2 Resumo do Carrinho")
    .setDescription("> Revise os dados do pedido e aceite os termos para continuar.")
    .addFields([
      { name: "\uD83D\uDC64 Cliente", value: `${user}`, inline: true },
      { name: `${tierEmoji} Produto`, value: product.name, inline: true },
      { name: "\uD83D\uDCB0 Valor", value: formatPrice(product.price), inline: true },
      { name: "\uD83C\uDFAB Plano", value: formatTier(product.tier), inline: true },
      { name: "\uD83D\uDCE6 Categoria", value: (product.category || "produto").toUpperCase(), inline: true },
      { name: "\uD83D\uDCC5 Data", value: `<t:${Math.floor(Date.now() / 1000)}:d>`, inline: true },
    ])
    .setFooter({ text: `${config.botName} \u2022 Carrinho` })
    .setTimestamp();
}

function buildTermsEmbed(config, user, product) {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("\uD83D\uDCDC Termos de Servi\u00E7o")
    .setDescription(`Ol\u00E1 ${user}! Leia os termos abaixo antes de prosseguir.`)
    .addFields([
      { name: "\uD83D\uDCB3 1. Pagamento", value: "O pedido s\u00F3 ser\u00E1 processado ap\u00F3s a confirma\u00E7\u00E3o do pagamento.", inline: false },
      { name: "\uD83D\uDE9A 2. Entrega", value: "O prazo pode variar conforme o produto e a demanda da equipe.", inline: false },
      { name: "\uD83D\uDEE1\uFE0F 3. Suporte", value: "O suporte cobre d\u00FAvidas e ajustes b\u00E1sicos do servi\u00E7o contratado.", inline: false },
      { name: "\uD83D\uDCE6 Produto Selecionado", value: `**${product.name}** \u2022 ${formatTier(product.tier)} \u2022 **${formatPrice(product.price)}**`, inline: false },
    ])
    .setFooter({ text: `${config.botName} \u2022 Ao aceitar, voc\u00EA concorda com os termos acima.` })
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
    .setFooter({ text: `${config.botName} • Atendimento` })
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
