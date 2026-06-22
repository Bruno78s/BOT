const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { upsertAdminPanel } = require("../utils/adminPanel");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Painel administrativo")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction, config) {
    const result = await upsertAdminPanel(interaction, config);
    if (result.updated) {
      await interaction.reply({
        content: `Painel /admin atualizado em <#${result.message.channel.id}>.`,
        ephemeral: true
      });
    }
  }
};
