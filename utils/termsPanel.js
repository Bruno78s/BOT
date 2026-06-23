const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");

async function ensureTermsPanel(client, config) {
  const termsChannelId = "1469735016971112448";
  
  const channel = await client.channels.fetch(termsChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  let existingMessage = null;
  if (recent) {
    existingMessage = recent.find(
      (msg) =>
        msg.author?.id === client.user.id &&
        msg.embeds?.[0]?.title?.includes("Termos")
    );
  }

  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Termos de Uso`)
    .setDescription([
      "> **1. Aceitação dos Termos**",
      "> Ao utilizar este servidor Discord e os serviços oferecidos pela Bzn X Store, você concorda com estes termos de uso na íntegra.",
      "",
      "> **2. Serviços Oferecidos**",
      "> A Bzn X Store oferece desenvolvimento de bots Discord e sites personalizados, bem como suporte técnico relacionado aos serviços contratados.",
      "",
      "> **3. Pagamentos**",
      "> Os pagamentos podem ser processados por PIX ou cartão. Os preços estão em Reais (BRL) e estão sujeitos a alteração mediante aviso prévio.",
      "",
      "> **4. Entrega e Prazos**",
      "> O prazo médio de entrega dos serviços é de até 24 horas úteis após a confirmação do pagamento. Atrasos podem ocorrer devido à complexidade do projeto ou fatores externos.",
      "",
      "> **5. Garantia**",
      "> Oferecemos suporte para ajustes básicos por 7 dias após a entrega. Problemas decorrentes de mau uso ou modificações não autorizadas não estão cobertos pela garantia.",
      "",
      "> **6. Reembolsos**",
      "> Reembolsos serão analisados caso a caso e concedidos se o serviço não for entregue conforme o acordado ou apresentar defeitos técnicos que impeçam seu funcionamento.",
      "",
      "> **7. Propriedade Intelectual**",
      "> Todo o código desenvolvido pela Bzn X Store permanece sendo propriedade da empresa até que o pagamento integral seja efetuado. Após o pagamento, o cliente adquire direito de uso, não de redistribuição.",
      "",
      "> **8. Comportamento do Usuário**",
      "> O usuário compromete-se a não utilizar os serviços para fins ilegais, fraudulentos ou que violem os Termos de Serviço do Discord. O descumprimento pode resultar em banimento imediato.",
      "",
      "> **9. Privacidade**",
      "> Respeitamos sua privacidade. Seus dados serão utilizados apenas para prestação dos serviços contratados e não serão compartilhados com terceiros sem seu consentimento.",
      "",
      "> **10. Alterações nos Termos**",
      "> A Bzn X Store reserva-se o direito de alterar estes termos a qualquer momento. As alterações entrarão em vigor imediatamente após sua publicação."
    ].join("\n"))
    .setThumbnail("attachment://logo.png")
    .setFooter({ 
      text: `${config.botName} • Termos de Uso`, 
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
  ensureTermsPanel
};
