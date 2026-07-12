const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  addModerationCase,
  buildCaseFields,
  createModerationEmbed,
  requireModerationPermission,
  sendModerationLog
} = require("../utils/moderation");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("desbanir")
    .setDescription("Remove o banimento de um usuário pelo ID.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((option) =>
      option
        .setName("usuario_id")
        .setDescription("ID do usuário que será desbanido.")
        .setRequired(true)
        .setMinLength(15)
        .setMaxLength(25)
    )
    .addStringOption((option) =>
      option.setName("motivo").setDescription("Motivo do desbanimento.").setMaxLength(900)
    ),

  async execute(interaction, config) {
    if (!(await requireModerationPermission(interaction, "ban", config))) return;

    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString("usuario_id", true).replace(/\D/g, "");
    const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);

    if (!ban) {
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Banimento não encontrado",
          description: "Não encontrei esse ID na lista de banidos do servidor.",
          color: config.colors?.danger,
          icon: "⚠️"
        })]
      });
    }

    await interaction.guild.bans.remove(userId, `${reason} | Moderador: ${interaction.user.tag}`);

    const caseItem = addModerationCase({
      guildId: interaction.guild.id,
      action: "unban",
      targetId: userId,
      targetTag: ban.user?.tag,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason
    });

    const embed = createModerationEmbed(config, {
      title: "Usuário desbanido",
      description: "Banimento removido com sucesso.",
      color: config.colors?.success,
      icon: "✅",
      fields: buildCaseFields(caseItem)
    });

    await interaction.editReply({ embeds: [embed] });
    await sendModerationLog(interaction, config, embed);
  }
};
