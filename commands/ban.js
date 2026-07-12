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
    .setName("ban")
    .setDescription("Bane um usuário do servidor com registro profissional.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuário que será banido.").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("motivo").setDescription("Motivo do banimento.").setMaxLength(900)
    )
    .addIntegerOption((option) =>
      option
        .setName("apagar_dias")
        .setDescription("Dias de mensagens para apagar, de 0 a 7.")
        .setMinValue(0)
        .setMaxValue(7)
    ),

  async execute(interaction, config) {
    if (!(await requireModerationPermission(interaction, "ban", config))) return;

    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser("usuario", true);
    const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
    const deleteDays = interaction.options.getInteger("apagar_dias") ?? 0;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const targetError = validateMemberTarget(interaction, member, "banir");

    if (targetError) {
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Banimento bloqueado",
          description: targetError,
          color: config.colors?.danger,
          icon: "⛔"
        })]
      });
    }

    await interaction.guild.members.ban(user.id, {
      reason: `${reason} | Moderador: ${interaction.user.tag}`,
      deleteMessageSeconds: deleteDays * 24 * 60 * 60
    });

    const caseItem = addModerationCase({
      guildId: interaction.guild.id,
      action: "ban",
      targetId: user.id,
      targetTag: user.tag,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason
    });

    const embed = createModerationEmbed(config, {
      title: "Usuário banido",
      description: "Banimento aplicado com sucesso.",
      color: config.colors?.danger,
      icon: "🔨",
      fields: buildCaseFields(caseItem, [
        { name: "🧹 Mensagens apagadas", value: `${deleteDays} dia(s)`, inline: true }
      ])
    });

    await interaction.editReply({ embeds: [embed] });
    await sendModerationLog(interaction, config, embed);
  }
};
