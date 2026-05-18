const { detectIntent, detectFaq, detectProduct } = require("../utils/keywords");
const { createTicket, listTicketByChannel } = require("../utils/tickets");
const { getSettings } = require("../utils/settings");
const { infoEmbed, warningEmbed } = require("../utils/embeds");
const { logToDb, logToChannel } = require("../utils/logger");
const { findAutoResponse, initializeAutoResponses } = require("../utils/autoResponses");

function isTicketChannel(channel) {
  return channel.name?.startsWith("🛒・") || channel.name?.startsWith("📩・") || channel.name?.startsWith("📦・");
}

module.exports = {
  name: "messageCreate",
  async execute(message, config) {
    if (!message.guild || message.author.bot) return;

    const settings = await getSettings(message.guild.id);
    if (!settings) return;

    await initializeAutoResponses(message.guild.id);

    if (isTicketChannel(message.channel)) {
      const autoResponse = await findAutoResponse(message.guild.id, message.content);
      if (autoResponse) {
        await message.reply({
          embeds: [infoEmbed(config, `🤖 Resposta Automática (${autoResponse.category})`, autoResponse.response).setFooter({ text: "Bzn X • Auto-resposta" })]
        });
      }
      return;
    }

    const faq = detectFaq(message.content, config);
    if (faq) {
      await message.reply({
        embeds: [infoEmbed(config, "📚 FAQ", faq).setFooter({ text: "BznX Store • Resposta rapida" })]
      });
      return;
    }

    const intent = detectIntent(message.content, config);
    if (!intent) return;

    const productId = intent === "sales" ? detectProduct(message.content, config) : null;

    const result = await createTicket({
      guild: message.guild,
      member: message.member,
      type: intent,
      config,
      settings,
      productId
    });

    if (result.error) {
      await message.reply({
        embeds: [warningEmbed(config, "⚠️ Ticket nao criado", result.error)]
      });
      return;
    }

      await message.reply({
        embeds: [
          infoEmbed(
            config,
            "✅ Ticket criado",
            `Canal criado: ${result.channel}\nEm breve nossa equipe responde aqui.`
          ).setFooter({ text: "BznX Store" })
        ]
      });

    const logChannel = message.guild.channels.cache.get(settings.log_channel_id);
    await logToDb(message.guild.id, "info", "Ticket criado via mensagem", {
      channelId: result.channel.id,
      userId: message.author.id,
      type: intent
    });
    await logToChannel(logChannel, config, "info", "Novo ticket criado.", {
      title: `${config.botName} | Ticket criado`,
      fields: [
        { name: "Canal", value: `<#${result.channel.id}>`, inline: true },
        { name: "Usuario", value: `<@${message.author.id}>`, inline: true },
        { name: "Tipo", value: intent === "support" ? "Suporte" : "Vendas", inline: true },
        { name: "Produto", value: productId || "Nao informado", inline: true },
        { name: "Status", value: "Aberto", inline: true }
      ],
      footer: "BznX Store • Logs"
    });
  }
};
