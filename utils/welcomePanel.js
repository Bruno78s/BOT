const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");

async function ensureWelcomePanel(client, config) {
  const { welcomeChannelId, channelId } = config.verification;
  if (!welcomeChannelId) return;

  const channel = await client.channels.fetch(welcomeChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  let existingMessage = null;
  if (recent) {
    existingMessage = recent.find(
      (msg) =>
        msg.author?.id === client.user.id &&
        msg.embeds?.[0]?.footer?.text?.includes("Boas-vindas")
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
    .setTitle(`👋 Bem-vindo(a) à ${config.botName}`)
    .setDescription([
      `Você está no servidor oficial da **${config.botName}**.`,
      "",
      "Aqui você encontra atendimento, novidades, compras, entregas e suporte dos produtos da loja.",
      "",
      "**Para liberar seu acesso:**",
      `1. Acesse ${verifyChannelMention}`,
      "2. Clique no botão de verificação",
      "3. Aguarde a aprovação automática",
      "",
      "**O que temos por aqui:**",
      "• bots Discord e sistemas personalizados",
      "• sites profissionais e responsivos",
      "• atendimento por ticket",
      "• entregas e suporte pós-venda",
      "",
      "Depois da verificação, os canais principais serão liberados automaticamente."
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setImage("attachment://banner.png")
    .setFooter({
      text: `${config.botName} • Boas-vindas`,
      iconURL: "attachment://logo.png"
    })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    files: [logoAttachment, bannerAttachment]
  };

  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
}

module.exports = {
  ensureWelcomePanel
};
