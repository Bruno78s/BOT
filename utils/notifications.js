const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");

async function notifySale(client, config, product, guild, userId) {
  const { botSalesChannelId, siteSalesChannelId } = config.notifications;
  
  const channelTarget = product.category === "sites" ? siteSalesChannelId : botSalesChannelId;
  if (!channelTarget) return;

  const channel = await client.channels.fetch(channelTarget).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Nova Venda`)
    .setDescription([
      `**Produto:** ${product.name}`,
      `**Categoria:** ${product.category.toUpperCase()}`,
      `**Tier:** ${product.tier.toUpperCase()}`,
      `**Valor:** R$ ${product.price.toFixed(2)}`,
      `**Comprador:** <@${userId}>`,
      "",
      "Um ticket de vendas foi criado para processar esta compra."
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: "BznX Store • Sistema de Vendas", iconURL: "attachment://logo.png" })
    .setTimestamp();

  await channel.send({ embeds: [embed], files: [logoAttachment] });
}

module.exports = {
  notifySale
};
