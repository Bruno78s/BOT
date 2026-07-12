const { touchTicketActivity } = require("../utils/ticketAutomation");
const { handleAutomodMessage } = require("../utils/automod");

module.exports = {
  name: "messageCreate",
  async execute(message, config) {
    if (!message.guild || message.author?.bot) return;
    touchTicketActivity(message.channel.id);
    await handleAutomodMessage(message, config).catch((error) => {
      console.error("[AUTOMOD] Erro ao processar mensagem:", error);
    });
  }
};
