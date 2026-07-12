const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");

async function ensureRulesPanel(client, config) {
  const rulesChannelId = config.rulesChannelId || "1469735022843134186";
  const channel = await client.channels.fetch(rulesChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const existingMessage = recent?.find((message) =>
    message.author?.id === client.user.id &&
    message.embeds?.[0]?.title?.includes("Regras do Servidor")
  );

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} • Regras do Servidor`)
    .setDescription([
      "Para manter a comunidade organizada, segura e agradável, siga as regras abaixo.",
      "",
      "**1. Respeito acima de tudo**",
      "Ofensas, preconceito, humilhação, assédio, ameaças ou provocações excessivas não serão tolerados.",
      "",
      "**2. Use os canais corretamente**",
      "Cada canal tem uma finalidade. Evite conversas fora de contexto, spam, flood ou mensagens repetitivas.",
      "",
      "**3. Tickets e suporte**",
      "Abra tickets apenas quando necessário. Explique o problema com clareza, envie prints quando possível e aguarde a equipe responder.",
      "",
      "**4. Divulgação e convites**",
      "Não divulgue servidores, links, produtos ou serviços sem autorização da administração.",
      "",
      "**5. Segurança**",
      "Não compartilhe dados pessoais, tokens, senhas, arquivos suspeitos ou qualquer conteúdo que coloque outros membros em risco.",
      "",
      "**6. Compras e atendimento**",
      "Pagamentos, entregas e dúvidas sobre produtos devem ser tratados pelos canais oficiais da BznX Store.",
      "",
      "**7. Conteúdo proibido**",
      "É proibido qualquer conteúdo ilegal, NSFW fora de local permitido, golpe, ameaça, vazamento, roubo de dados ou violação dos Termos do Discord.",
      "",
      "**8. Punições**",
      "A equipe pode aplicar aviso, mute, kick, ban ou bloqueio de atendimento dependendo da gravidade da situação.",
      "",
      "**9. Decisão da equipe**",
      "A administração pode intervir para proteger a comunidade, mesmo em casos não descritos explicitamente nestas regras."
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • Regras oficiais`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  const payload = { embeds: [embed], files: [logoAttachment] };
  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
}

module.exports = {
  ensureRulesPanel
};
