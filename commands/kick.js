const { SlashCommandBuilder } = require("discord.js");
const {
  addModerationCase,
  buildCaseFields,
  createModerationEmbed,
  requireModerationPermission,
  sendModerationLog,
  validateMemberTarget
} = require("../utils/moderation");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa um membro do servidor com log de moderação.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro que será expulso.").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("motivo").setDescription("Motivo da expulsão.").setMaxLength(900)
    ),

  async execute(interaction, config) {
    if (!(await requireModerationPermission(interaction, "kick", config))) return;

    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser("usuario", true);
    const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Membro não encontrado",
          description: "Esse usuário não está no servidor.",
          color: config.colors?.danger,
          icon: "⚠️"
        })]
      });
    }

    const targetError = validateMemberTarget(interaction, member, "expulsar");
    if (targetError) {
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Expulsão bloqueada",
          description: targetError,
          color: config.colors?.danger,
          icon: "⛔"
        })]
      });
    }

    await member.kick(`${reason} | Moderador: ${interaction.user.tag}`);

    const caseItem = addModerationCase({
      guildId: interaction.guild.id,
      action: "kick",
      targetId: user.id,
      targetTag: user.tag,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason
    });

    const embed = createModerationEmbed(config, {
      title: "Membro expulso",
      description: "Expulsão aplicada com sucesso.",
      color: config.colors?.warning,
      icon: "👢",
      fields: buildCaseFields(caseItem)
    });

    await interaction.editReply({ embeds: [embed] });
    await sendModerationLog(interaction, config, embed);
  }
};
