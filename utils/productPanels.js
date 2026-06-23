const { ActionRowBuilder, AttachmentBuilder, StringSelectMenuBuilder } = require("discord.js");
const path = require("path");
const { buildProductEmbed, groupProducts, getProductLabel, formatPrice } = require("./salesFlow");

async function ensureProductPanels(client, config) {
  const grouped = groupProducts(config.products);

  for (const [group, products] of grouped.entries()) {
    const channelId = config.productPanelChannels?.[group] || products[0]?.channelId;
    if (!channelId) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) continue;

    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    let existingMessage = null;
    const groupTitle = group === "site" ? "Sites" : products[0]?.name?.replace(/\s+(Basic|Premium|Platinum|Premium\+|Diamond)$/i, "") || group;

    if (recent) {
      const botMessages = recent.filter((msg) => msg.author?.id === client.user.id);
      existingMessage = botMessages.find((msg) => {
        const title = msg.embeds?.[0]?.title || "";
        const footer = msg.embeds?.[0]?.footer?.text || "";
        return footer.includes(`product-panel:${group}`) || title.includes(groupTitle);
      });

      const duplicates = botMessages.filter((msg) => msg.id !== existingMessage?.id);
      for (const duplicate of duplicates.values()) {
        const title = duplicate.embeds?.[0]?.title || "";
        const footer = duplicate.embeds?.[0]?.footer?.text || "";
        const isSameProductPanel = footer.includes(`product-panel:${group}`) || (groupTitle && title.includes(groupTitle));
        if (isSameProductPanel) {
          await duplicate.delete().catch(() => null);
        }
      }
    }

    const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
    const bannerPath = path.join(__dirname, "..", "public", "banner-bznx.png");
    const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });
    const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });

    const embed = buildProductEmbed(config, group, products)
      .setThumbnail("attachment://logo.png")
      .setImage("attachment://banner.png")
      .setFooter({ text: `${config.botName} • Produtos • product-panel:${group}`, iconURL: "attachment://logo.png" });

    const options = products.map((product) => ({
      label: getProductLabel(product).slice(0, 100),
      description: `💰 ${formatPrice(product.price)} • 📦 Estoque: ${product.stock > 0 ? product.stock : "Esgotado"}`.slice(0, 100),
      value: `cart_start_${product.id}`
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`product_select_${group}`)
        .setPlaceholder("🛒 Selecione uma opção")
        .addOptions(options.slice(0, 25))
    );

    const payload = {
      embeds: [embed],
      components: [row],
      files: [logoAttachment, bannerAttachment]
    };

    if (existingMessage) {
      await existingMessage.edit(payload);
    } else {
      await channel.send(payload);
    }
  }
}

module.exports = {
  ensureProductPanels
};
