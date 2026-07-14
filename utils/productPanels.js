const { ActionRowBuilder, AttachmentBuilder, StringSelectMenuBuilder } = require("discord.js");
const path = require("path");
const { get, run } = require("../database/db");
const { buildProductEmbed, formatPrice, getProductLabel, groupProducts } = require("./salesFlow");

function getPanelDisplayName(group, products) {
  if (group === "site" || group === "sites") return "Sites";
  if (group === "vps") return "VPS";
  if (group === "dominios") return "Domínios";
  return products[0]?.name?.replace(/\s+(Basic|Premium|Platinum|Premium\+|Diamond)$/i, "") || group;
}

async function findExistingPanel(channel, client, guildId, group, groupTitle) {
  const stored = get("SELECT message_id FROM panel_messages WHERE guild_id = ? AND type = ?", [guildId, `product:${group}`]);
  if (stored?.message_id) {
    const storedMessage = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (storedMessage) return storedMessage;
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return null;

  const botMessages = recent.filter((msg) => msg.author?.id === client.user.id);
  return botMessages.find((msg) => {
    const title = msg.embeds?.[0]?.title || "";
    const footer = msg.embeds?.[0]?.footer?.text || "";
    return footer.includes(`product-panel:${group}`) || title.includes(groupTitle);
  }) || null;
}

async function deleteDuplicatePanels(channel, client, existingMessage, group, groupTitle) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return;

  const botMessages = recent.filter((msg) => msg.author?.id === client.user.id && msg.id !== existingMessage?.id);
  for (const duplicate of botMessages.values()) {
    const title = duplicate.embeds?.[0]?.title || "";
    const footer = duplicate.embeds?.[0]?.footer?.text || "";
    const isSameProductPanel = footer.includes(`product-panel:${group}`) || (groupTitle && title.includes(groupTitle));
    if (isSameProductPanel) {
      await duplicate.delete().catch(() => null);
    }
  }
}

async function ensureProductPanels(client, config) {
  const grouped = groupProducts(config.products);

  for (const [group, products] of grouped.entries()) {
    const channelId = config.productPanelChannels?.[group] || products[0]?.channelId;
    if (!channelId) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) continue;

    const groupTitle = getPanelDisplayName(group, products);
    const existingMessage = await findExistingPanel(channel, client, channel.guild.id, group, groupTitle);

    const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
    const bannerPath = path.join(__dirname, "..", "public", "banner-bznx.png");
    const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });
    const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });

    const embed = buildProductEmbed(config, group, products)
      .setThumbnail("attachment://logo.png")
      .setImage("attachment://banner.png")
      .setFooter({ text: `${config.botName} • ${groupTitle}`, iconURL: "attachment://logo.png" });

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

    const message = existingMessage
      ? await existingMessage.edit(payload)
      : await channel.send(payload);

    run(
      "INSERT INTO panel_messages (guild_id, type, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, type) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at",
      [channel.guild.id, `product:${group}`, channel.id, message.id, Date.now()]
    );

    await deleteDuplicatePanels(channel, client, message, group, groupTitle);
  }
}

module.exports = {
  ensureProductPanels
};
