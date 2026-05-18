const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");

async function ensureRulesPanel(client, config) {
  const rulesChannelId = "1469735022843134186";
  
  const channel = await client.channels.fetch(rulesChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  let existingMessage = null;
  if (recent) {
    existingMessage = recent.find(
      (msg) =>
        msg.author?.id === client.user.id &&
        msg.embeds?.[0]?.title?.includes("Regras")
    );
  }

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Regras do Servidor`)
    .setDescription([
      "> **1. Respeito e Civilidade**",
      "> Mantenha um ambiente respeitoso e cordial. Insultos, ofensas e linguagem inadequada não serão tolerados.",
      "",
      "> **2. Uso dos Canais**",
      "> Utilize cada canal para sua finalidade designada. Não spam em canais inadequados e siga as instruções da equipe.",
      "",
      "> **3. Sistema de Tickets**",
      "> Abra um ticket apenas quando necessário. Não abuse do sistema abrindo tickets sem motivo. Seja claro e conciso ao descrever seu problema ou solicitação.",
      "",
      "> **4. Conteúdo Proibido**",
      "> É proibido compartilhar conteúdo ilegal, ofensivo, discriminatório ou que viole os Termos de Serviço do Discord.",
      "",
      "> **5. Publicidade**",
      "> Não faça publicidade de servidores, produtos ou serviços não autorizados pela administração.",
      "",
      "> **6. Privacidade**",
      "> Não compartilhe informações privadas de outros usuários sem consentimento. Respeite a privacidade de todos.",
      "",
      "> **7. Comportamento na Voz**",
      "> Nos canais de voz, mantenha o volume adequado e não use sons excessivos que incomodem outros usuários.",
      "",
      "> **8. Interações com a Equipe**",
      "> A equipe de suporte está aqui para ajudar. Seja paciente e respeitoso ao aguardar atendimento. Não mencione staff sem motivo.",
      "",
      "> **9. Reportes**",
      "> Se presenciar uma infração às regras, reporte através do sistema de tickets com evidências quando possível.",
      "",
      "> **10. Consequências**",
      "> O descumprimento das regras pode resultar em advertências, mut temporário ou banimento permanente, dependendo da gravidade da infração."
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ 
      text: "Bzn X • Regras do Servidor", 
      iconURL: "attachment://logo.png"
    })
    .setTimestamp();

  if (existingMessage) {
    await existingMessage.edit({ 
      embeds: [embed],
      files: [logoAttachment]
    });
    return;
  }

  await channel.send({ 
    embeds: [embed],
    files: [logoAttachment]
  });
}

module.exports = {
  ensureRulesPanel
};
