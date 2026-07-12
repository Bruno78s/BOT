const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const path = require("path");

function getMinAccountAgeDays(config) {
  return Number(process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS || config.verification?.minAccountAgeDays || 7);
}

async function ensureVerifyPanel(client, config) {
  const { channelId } = config.verification;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

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
  const minAccountAgeDays = getMinAccountAgeDays(config);

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle("🛡️ Portal de Verificação")
    .setDescription([
      `Bem-vindo ao **${config.botName}**.`,
      "",
      "Para liberar seu acesso ao servidor, confirme sua conta no botão abaixo.",
      "",
      "**A verificação analisa:**",
      "• Idade da conta",
      "• Presença de banimentos ou restrições",
      "• Atividade suspeita",
      "",
      "**Requisitos:**",
      `• Conta com pelo menos **${minAccountAgeDays} dias** de idade`,
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
      .setLabel("Verificar conta")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  const payload = {
    embeds: [embed],
    components: [row],
    files: [logoAttachment, bannerAttachment]
  };

  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
}

module.exports = {
  ensureVerifyPanel
};
