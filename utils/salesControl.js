const { EmbedBuilder } = require("discord.js");

function isSalesEnabled(config) {
  if (config?.sales?.enabled !== undefined) {
    return config.sales.enabled !== false;
  }
  if (process.env.SALES_ENABLED !== undefined) {
    return String(process.env.SALES_ENABLED).toLowerCase() !== "false";
  }
  return true;
}

function getSalesStatusLabel(config) {
  return isSalesEnabled(config) ? "ON" : "OFF";
}

function buildSalesClosedEmbed(config) {
  return new EmbedBuilder()
    .setColor(config.colors?.warning || 0xf9a825)
    .setTitle("🛒 Vendas temporariamente pausadas")
    .setDescription([
      "No momento a loja está com as compras automáticas desativadas.",
      "",
      "Você ainda pode navegar pelos produtos e abrir atendimento, mas novos carrinhos e pagamentos ficam bloqueados até a equipe reabrir as vendas.",
      "",
      "Acompanhe os canais de aviso para saber quando as compras voltarem."
    ].join("\n"))
    .setFooter({ text: `${config.botName || "BznX Store"} • Vendas OFF` })
    .setTimestamp();
}

module.exports = {
  buildSalesClosedEmbed,
  getSalesStatusLabel,
  isSalesEnabled
};
