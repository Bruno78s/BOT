const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");

async function ensureVerifyPanel(client, config) {
  const { channelId, unverifiedRoleId, verifiedRoleId } = config.verification;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  let existingMessage = null;
  if (recent) {
    existingMessage = recent.find(
      (msg) =>
        msg.author?.id === client.user.id &&
        msg.embeds?.[0]?.title?.includes("Verificação")
    );
  }

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const bannerPath = path.join(__dirname, "..", "public", "banner-bznx.png");

  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });
  const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`Portal de Verificação`)
    .setDescription([
      `Bem-vindo ao **${config.botName}**.`,
      "",
      "Para liberar seu acesso ao servidor, confirme sua conta no botão abaixo.",
      "",
      "**A verificação analisa:**",
      "• validade básica da conta Discord",
      "• tempo mínimo de criação da conta",
      "• sinais de automação ou conta suspeita",
      "",
      "**Requisitos:**",
      "• Conta Discord ativa",
      "• Tempo de criação superior a 7 dias",
      "",
      "Após a aprovação, seus canais serão liberados automaticamente."
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setImage("attachment://banner.png")
    .setFooter({
      text: `${config.botName} • Verificação`,
      iconURL: "attachment://logo.png"
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_button")
      .setLabel("Iniciar Verificação")
      .setStyle(ButtonStyle.Success)
  );

  if (existingMessage) {
    await existingMessage.edit({ 
      embeds: [embed], 
      components: [row],
      files: [logoAttachment, bannerAttachment]
    });
    return;
  }

  await channel.send({ 
    embeds: [embed], 
    components: [row],
    files: [logoAttachment, bannerAttachment]
  });
}

module.exports = {
  ensureVerifyPanel
};
