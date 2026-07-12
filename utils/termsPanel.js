const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");

async function ensureTermsPanel(client, config) {
  const termsChannelId = config.termsChannelId || "1469735016971112448";
  const channel = await client.channels.fetch(termsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const existingMessage = recent?.find((message) =>
    message.author?.id === client.user.id &&
    message.embeds?.[0]?.title?.includes("Termos de Compra")
  );

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} • Termos de Compra e Uso`)
    .setDescription([
      "*Ao comprar ou solicitar qualquer serviço na **BznX Store**, você confirma que leu e concorda com os termos abaixo.*",
      "",
      "**1. Produtos e serviços**",
      "*A BznX Store trabalha com bots Discord, sites, automações, sistemas digitais, configurações e serviços personalizados.*",
      "",
      "**2. Pagamento**",
      "*Os pagamentos podem ser feitos por PIX, cartão ou método manual autorizado pela equipe. O pedido só começa a ser processado após confirmação do pagamento.*",
      "",
      "**3. Entrega**",
      "*A entrega pode ocorrer por ticket, mensagem privada ou canal privado, conforme o produto contratado. Prazos podem variar de acordo com complexidade, fila de atendimento e necessidade de informações do cliente.*",
      "",
      "**4. Responsabilidade do cliente**",
      "*O cliente deve enviar informações corretas, manter contato pelo ticket e não compartilhar arquivos, links ou credenciais recebidas de forma indevida.*",
      "",
      "**5. Suporte e ajustes**",
      "*Ajustes básicos relacionados ao produto contratado podem ser solicitados dentro do prazo de suporte informado pela equipe. Alterações fora do escopo inicial podem gerar novo orçamento.*",
      "",
      "**6. Reembolsos**",
      "*Os reembolsos só são aprovados em caso de erro no produto ou serviço entregue, caso contrário não serão aprovados.*",
      "",
      "**7. Uso permitido**",
      "*É proibido usar produtos da BznX Store para fraude, spam, ataques, roubo de dados, violação de regras do Discord ou qualquer atividade ilegal.*",
      "",
      "**8. Atualizações dos termos**",
      "*Estes termos podem ser atualizados a qualquer momento para proteger a loja, clientes e equipe.*"
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • Termos oficiais`, iconURL: "attachment://logo.png" })
    .setTimestamp();

  const payload = { embeds: [embed], files: [logoAttachment] };
  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  await channel.send(payload);
}

module.exports = {
  ensureTermsPanel
};
