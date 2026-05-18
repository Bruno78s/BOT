const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");

async function ensureWelcomePanel(client, config) {
  const { welcomeChannelId, channelId } = config.verification;
  if (!welcomeChannelId) return;

  const channel = await client.channels.fetch(welcomeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  let existingMessage = null;
  if (recent) {
    existingMessage = recent.find(
      (msg) =>
        msg.author?.id === client.user.id &&
        msg.embeds?.[0]?.title?.includes("Bem-vindo")
    );
  }

  const verifyChannel = await client.channels.fetch(channelId).catch(() => null);
  const verifyChannelMention = verifyChannel ? `<#${channelId}>` : "canal de verificação";

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const bannerPath = path.join(__dirname, "..", "public", "banner-bznx.png");

  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });
  const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`Bem-vindos(as)!`)
    .setDescription([
      `Bem-vindo ao **${config.botName}**.`,
      "",
      "Este servidor reúne suporte, vendas e informações oficiais dos nossos produtos.",
      "",
      "**O que você encontra aqui:**",
      "• bots Discord e sistemas personalizados",
      "• sites responsivos e profissionais",
      "• atendimento via ticket",
      "• suporte pós-venda",
      "",
      "**Primeiro acesso**",
      `Para liberar os canais, conclua a verificação em ${verifyChannelMention}.`,
      "",
      "Após a verificação, você poderá acessar as áreas de atendimento e produtos."
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setImage("attachment://banner.png")
    .setFooter({ 
      text: "BznX Store • Bem-vindo", 
      iconURL: "attachment://logo.png"
    })
    .setTimestamp();

  if (existingMessage) {
    await existingMessage.edit({ 
      embeds: [embed],
      files: [logoAttachment, bannerAttachment]
    });
    return;
  }

  await channel.send({ 
    embeds: [embed],
    files: [logoAttachment, bannerAttachment]
  });
}

module.exports = {
  ensureWelcomePanel
};
