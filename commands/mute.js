const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  addModerationCase,
  buildCaseFields,
  createModerationEmbed,
  formatDuration,
  parseDuration,
  requireModerationPermission,
  sendModerationLog,
  validateMemberTarget
} = require("../utils/moderation");

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Silencia um membro por tempo determinado.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro que será silenciado.").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("duracao")
        .setDescription("Tempo do mute. Ex.: 10m, 2h, 1d, 7d.")
        .setRequired(true)
        .setMaxLength(40)
    )
    .addStringOption((option) =>
      option.setName("motivo").setDescription("Motivo do mute.").setMaxLength(900)
    ),

  async execute(interaction, config) {
    if (!(await requireModerationPermission(interaction, "mute", config))) return;

    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser("usuario", true);
    const durationInput = interaction.options.getString("duracao", true);
    const durationMs = parseDuration(durationInput);
    const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!durationMs || durationMs < 1000 || durationMs > MAX_TIMEOUT_MS) {
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Duração inválida",
          description: "Use uma duração entre **1 segundo** e **28 dias**. Exemplos: `10m`, `2h`, `7d`.",
          color: config.colors?.danger,
          icon: "⏱️"
        })]
      });
    }

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

    const targetError = validateMemberTarget(interaction, member, "silenciar");
    if (targetError) {
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Mute bloqueado",
          description: targetError,
          color: config.colors?.danger,
          icon: "⛔"
        })]
      });
    }

    await member.timeout(durationMs, `${reason} | Moderador: ${interaction.user.tag}`);

    const caseItem = addModerationCase({
      guildId: interaction.guild.id,
      action: "mute",
      targetId: user.id,
      targetTag: user.tag,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason
    });

    const embed = createModerationEmbed(config, {
      title: "Membro silenciado",
      description: "Timeout aplicado com sucesso.",
      color: config.colors?.warning,
      icon: "🔇",
      fields: buildCaseFields(caseItem, [
        { name: "⏱️ Duração", value: formatDuration(durationMs), inline: true }
      ])
    });

    await interaction.editReply({ embeds: [embed] });
    await sendModerationLog(interaction, config, embed);
  }
};
