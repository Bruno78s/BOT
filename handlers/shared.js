/**
 * Utilidades compartilhadas entre handlers
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder
} = require("discord.js");
const { formatPrice, readConfigFile } = require("../utils/salesFlow");

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function formatStars(rating) {
  return "\u2B50".repeat(rating) + "\u2606".repeat(5 - rating);
}

function parsePriceInput(value) {
  return Number(String(value).trim().replace(/\./g, "").replace(",", "."));
}

function getCurrentProducts(config) {
  return readConfigFile().products || config.products || [];
}

function buildProductAdminView(config, description = "Selecione um produto para gerenciar ou cadastre um novo item.") {
  const products = getCurrentProducts(config);
  const menuOptions = products.map((product) => ({
    label: product.name.slice(0, 100),
    description: `${formatPrice(product.price)} | Est: ${product.stock > 0 ? product.stock : "Esgotado"} | ${product.deliveryUrl ? "\uD83D\uDE80 Auto" : "\uD83D\uDCCB Ticket"}`.slice(0, 100),
    value: `edit_product_${product.id}`
  }));

  menuOptions.push({
    label: "Adicionar Novo Produto",
    description: "Criar um novo produto",
    value: "add_new_product"
  });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Produtos`)
    .setDescription(description)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("product_menu")
      .setPlaceholder("Selecione um produto")
      .addOptions(menuOptions.slice(0, 25))
  );

  return { embed, components: [row, buildMainMenuBackRow()] };
}

function buildProductBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_products_back")
      .setLabel("📦 Voltar para produtos")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildMainMenuBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_main_back")
      .setLabel("⬅️ Voltar ao Menu Principal")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function sendPurchaseAuditLog(interaction, config, ticket, product) {
  const logChannelId = config.logChannels?.comprovantes || process.env.AUDIT_LOG_CHANNEL_ID;
  if (!logChannelId) return;
  const logChannel = await interaction.client.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel?.isTextBased()) return;

  const acceptedAt = ticket.terms_accepted_at ? new Date(ticket.terms_accepted_at).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"}) : "N\u00E3o registrado";
  const content = [
    "BznX Store - Registro de Compra",
    "",
    `Cliente: ${interaction.user.tag} (${interaction.user.id})`,
    `Canal: #${interaction.channel.name} (${interaction.channel.id})`,
    `Produto: ${product?.name || ticket.product_id || "N\u00E3o identificado"}`,
    `Plano: ${product?.tier || "N\u00E3o identificado"}`,
    `Valor: ${product ? formatPrice(product.price) : "N\u00E3o identificado"}`,
    `Termos aceitos em: ${acceptedAt}`,
    "",
    ticket.terms_snapshot || "Termos n\u00E3o registrados no ticket.",
    "",
    `Finalizado em: ${new Date().toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})}`
  ].join("\n");

  const file = new AttachmentBuilder(Buffer.from(content, "utf8"), {
    name: `compra-${interaction.channel.id}.txt`
  });

  await logChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle(`${config.botName} | Registro de Compra`)
        .setDescription([
          `**Cliente:** <@${interaction.user.id}>`,
          `**Produto:** ${product?.name || ticket.product_id || "N\u00E3o identificado"}`,
          `**Canal:** <#${interaction.channel.id}>`,
          `**Termos:** ${ticket.terms_accepted_at ? "Aceitos" : "N\u00E3o registrados"}`
        ].join("\n"))
        .setTimestamp()
    ],
    files: [file]
  });
}

module.exports = {
  formatDuration,
  formatStars,
  parsePriceInput,
  getCurrentProducts,
  buildProductAdminView,
  buildProductBackRow,
  buildMainMenuBackRow,
  sendPurchaseAuditLog
};
