const { routeInteraction } = require("../handlers");
const { patchInteractionResponses } = require("../utils/interactionCompatibility");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, config) {
    try {
      patchInteractionResponses(interaction);
      await routeInteraction(interaction, config);
    } catch (error) {
      console.error('[INTERACTION ERROR]', error);
      if (error && error.stack) {
        console.error('[INTERACTION ERROR STACK]', error.stack);
      }
      
      // Tentar responder ao usuario sobre o erro
      const reply = { content: "Ocorreu um erro ao processar esta interacao.", ephemeral: true };
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply(reply);
        } else if (interaction.deferred) {
          await interaction.editReply(reply);
        }
      } catch (_) {
        // Ignora se nao conseguir responder
      }
    }
  }
};
