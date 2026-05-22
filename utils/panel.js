
const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");
const { buildSupportEmbed } = require("./salesFlow");

async function ensureTicketPanel(client, config) {
  const channelId = config.ticketPanelChannelId;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  let existingMessage = null;
  if (recent) {
    const botMessages = recent.filter((msg) => msg.author?.id === client.user.id);
    existingMessage = botMessages.find(
      (msg) =>
        msg.embeds?.[0]?.footer?.text?.includes("ticket") ||
        msg.embeds?.[0]?.title?.includes("Central de Atendimento") ||
        msg.embeds?.[0]?.title?.includes("Central de Suporte")
    );

    const duplicates = botMessages.filter((msg) => msg.id !== existingMessage?.id);
    for (const duplicate of duplicates.values()) {
      const title = duplicate.embeds?.[0]?.title || "";
      const footer = duplicate.embeds?.[0]?.footer?.text || "";
      if (title.includes("Central de Atendimento") || title.includes("Central de Suporte") || footer.includes("ticket")) {
        await duplicate.delete().catch(() => null);
      }
    }
  }

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const bannerPath = path.join(__dirname, "..", "public", "banner-bznx.png");

  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });
  const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });

  const embed = buildSupportEmbed(config)
    .setThumbnail("attachment://logo.png")
    .setImage("attachment://banner.png")
    .setFooter({ 
      text: `${config.botName} • Atendimento`, 
      iconURL: "attachment://logo.png"
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("support_ticket_select")
      .setPlaceholder("Selecione o motivo do atendimento")
      .addOptions([
        {
          label: "Suporte",
          description: "Dúvidas gerais e ajuda técnica",
          value: "support"
        },
        {
          label: "Problema com Serviço",
          description: "Relatar falhas em um serviço comprado",
          value: "service_issue"
        }
      ])
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
  ensureTicketPanel
};
