const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");

async function clearChannel(channel) {
  let deleted = 0;

  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages?.size) break;

    const bulkable = messages.filter((message) => Date.now() - message.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    if (!bulkable.size) break;

    const removed = await channel.bulkDelete(bulkable, true).catch(() => null);
    if (!removed?.size) break;

    deleted += removed.size;
    if (removed.size < 2) break;
  }

  return deleted;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Limpa todas as mensagens recentes do canal atual.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    if (!interaction.channel?.bulkDelete) {
      return interaction.reply({ content: "Este canal não permite limpeza em massa.", ephemeral: true });
    }

    await interaction.reply({ content: "Limpando mensagens do canal...", ephemeral: true });
    const deleted = await clearChannel(interaction.channel);

    await interaction.followUp({
      content: `Limpeza concluída. Mensagens removidas: ${deleted}. Mensagens com mais de 14 dias não podem ser apagadas em massa pelo Discord.`,
      ephemeral: true
    }).catch(() => null);
  }
};
