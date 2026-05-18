const { SlashCommandBuilder } = require("discord.js");
const { getInviteStats, buildInviteStatsEmbed } = require("../utils/invites");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Veja seus convites ou os convites de outro usuário")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuário para consultar")
        .setRequired(false)
    ),
  async execute(interaction, config) {
    const target = interaction.options.getMember("usuario") || interaction.member;
    const stats = await getInviteStats(interaction.guild.id, target.id);

    return interaction.reply({
      embeds: [buildInviteStatsEmbed(config, target, stats)],
      ephemeral: true
    });
  }
};
