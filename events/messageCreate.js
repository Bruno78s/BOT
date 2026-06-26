const { touchTicketActivity } = require("../utils/ticketAutomation");

module.exports = {
  name: "messageCreate",
  async execute(message) {
    if (!message.guild || message.author?.bot) return;
    touchTicketActivity(message.channel.id);
  }
};
