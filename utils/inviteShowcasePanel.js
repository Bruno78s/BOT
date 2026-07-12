const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");

const DEFAULT_CHANNEL_ID = "1469735012265099345";

function getShowcaseChannelId(config) {
  return config.inviteShowcaseChannelId || config.serverInviteChannelId || DEFAULT_CHANNEL_ID;
}

function getCategoryStats(config) {
  const products = config.products || [];
  const bots = products.filter((product) => product.category === "bots");
  const sites = products.filter((product) => product.category === "sites");
  const lowestBot = bots.reduce((min, product) => Math.min(min, Number(product.price || Infinity)), Infinity);
  const lowestSite = sites.reduce((min, product) => Math.min(min, Number(product.price || Infinity)), Infinity);

  return {
    bots: bots.length,
    sites: sites.length,
    lowestBot: Number.isFinite(lowestBot) ? lowestBot : 0,
    lowestSite: Number.isFinite(lowestSite) ? lowestSite : 0
  };
}

function money(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}

function buildInviteShowcaseEmbed(config) {
  const stats = getCategoryStats(config);

  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setAuthor({ name: `${config.botName} • Loja de Bots e Sites` })
    .setTitle("🚀 Transforme seu servidor ou projeto digital")
    .setDescription([
      "A **BznX Store** desenvolve soluções prontas e personalizadas para Discord, lojas, comunidades e projetos profissionais.",
      "",
      "Escolha o produto ideal nos canais da loja, abra seu carrinho e acompanhe tudo pelo Discord com atendimento organizado.",
      "",
      "💡 **Dica:** Se você não encontrar o que procura, abra um ticket e solicite um orçamento personalizado."
    ].join("\n"))
    .addFields(
      {
        name: "🤖 Bots Discord",
        value: [
          `Planos disponíveis: **${stats.bots}**`,
          `A partir de **${money(stats.lowestBot)}**`,
        ].join("\n"),
        inline: true
      },
      {
        name: "🌐 Sites Profissionais",
        value: [
          `Planos disponíveis: **${stats.sites}**`,
          `A partir de **${money(stats.lowestSite)}**`,
        ].join("\n"),
        inline: true
      },
      {
        name: "✅ Por que escolher a BznX?",
        value: [
          "**• Atendimento via ticket**",
          "**• Pagamento por PIX ou cartão**",
          "**• Comprovante e logs automáticos**",
          "**• Entrega acompanhada pela equipe**",
          "**• Soluções com visual profissional**"
        ].join("\n"),
        inline: false
      },
      {
        name: "📌 Como comprar",
        value: "Acesse os canais de produtos, selecione um plano, aceite os termos e escolha a forma de pagamento.",
        inline: false
      }
    )
    .setImage("attachment://banner.png")
    .setFooter({ text: `${config.botName} • Bots, sites e automações` })
    .setTimestamp();
}

async function ensureInviteShowcasePanel(client, config) {
  const channelId = getShowcaseChannelId(config);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const existingMessage = recent?.find((message) =>
    message.author?.id === client.user.id &&
    message.embeds?.[0]?.title?.includes("Transforme seu servidor")
  );

  const bannerPath = path.join(__dirname, "..", "public", "banner-bznx.png");
  const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });
  const payload = {
    embeds: [buildInviteShowcaseEmbed(config)],
    files: [bannerAttachment]
  };

  if (existingMessage) {
    await existingMessage.edit(payload).catch(() => null);
    return;
  }

  await channel.send(payload).catch(() => null);
}

module.exports = {
  buildInviteShowcaseEmbed,
  ensureInviteShowcasePanel
};
