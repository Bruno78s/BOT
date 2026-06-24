const { ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");

function buildSupportEmbed(config) {
  return new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`🎫 ${config.botName} | Central de Atendimento`)
    .setDescription([
      "👋 Utilize este painel para abrir um atendimento com a equipe.",
      "",
      "**Antes de abrir um ticket:**",
      "• informe o motivo com clareza",
      "• envie prints, links ou IDs quando necessário",
      "• aguarde o retorno da equipe",
      "",
      "📨 Selecione abaixo o tipo de atendimento desejado."
    ].join("\n"))
    .setFooter({ text: `${config.botName} • Atendimento` })
    .setTimestamp();
}

async function ensureTicketPanel(client, config) {
  const channelId = config.ticketPanelChannelId;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  let existingMessage = null;
  if (recent) {
    const botMessages = recent.filter((msg) => msg.author?.id === client.user.id);
    existingMessage = botMessages.find((msg) => {
      const title = msg.embeds?.[0]?.title || "";
      const footer = msg.embeds?.[0]?.footer?.text || "";
      return title.includes("Central de Atendimento") || title.includes("Central de Suporte") || footer.includes("Atendimento") || footer.includes("ticket");
    });

    const duplicates = botMessages.filter((msg) => msg.id !== existingMessage?.id);
    for (const duplicate of duplicates.values()) {
      const title = duplicate.embeds?.[0]?.title || "";
      const footer = duplicate.embeds?.[0]?.footer?.text || "";
      if (title.includes("Central de Atendimento") || title.includes("Central de Suporte") || footer.includes("Atendimento") || footer.includes("ticket")) {
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
    });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("support_ticket_select")
      .setPlaceholder("Selecione o motivo do atendimento")
      .addOptions([
        {
          label: "Suporte",
          description: "Dúvidas gerais e ajuda técnica",
          value: "support",
          emoji: "🛠️"
        },
        {
          label: "Problema com Serviço",
          description: "Relatar falhas em um serviço comprado",
          value: "service_issue",
          emoji: "⚠️"
        },
        {
          label: "Financeiro",
          description: "Ajuda com pagamento, cupom ou cobrança",
          value: "billing",
          emoji: "💳"
        },
        {
          label: "Parceria",
          description: "Propostas, divulgação e oportunidades",
          value: "partnership",
          emoji: "🤝"
        }
      ])
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

module.exports = { ensureTicketPanel };
