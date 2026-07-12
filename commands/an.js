const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  addModerationCase,
  buildCaseFields,
  createModerationEmbed,
  normalizeColor,
  requireModerationPermission,
  sendModerationLog
} = require("../utils/moderation");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("an")
    .setDescription("Envia um anúncio profissional em embed.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal onde o anúncio será enviado.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("titulo").setDescription("Título do anúncio.").setRequired(true).setMaxLength(220)
    )
    .addStringOption((option) =>
      option.setName("mensagem").setDescription("Texto principal do anúncio.").setRequired(true).setMaxLength(3000)
    )
    .addStringOption((option) =>
      option.setName("cor").setDescription("Cor do embed em HEX. Ex.: #1e88e5").setMaxLength(7)
    )
    .addStringOption((option) =>
      option.setName("banner").setDescription("URL da imagem/banner do anúncio.").setMaxLength(500)
    )
    .addStringOption((option) =>
      option.setName("icone").setDescription("URL do ícone/thumbnail do anúncio.").setMaxLength(500)
    )
    .addStringOption((option) =>
      option.setName("rodape").setDescription("Texto do rodapé.").setMaxLength(180)
    )
    .addRoleOption((option) =>
      option.setName("mencionar_cargo").setDescription("Cargo que será mencionado junto do anúncio.")
    ),

  async execute(interaction, config) {
    if (!(await requireModerationPermission(interaction, "announce", config))) return;

    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel("canal", true);
    const title = interaction.options.getString("titulo", true);
    const message = interaction.options.getString("mensagem", true);
    const color = normalizeColor(interaction.options.getString("cor"), config.colors?.primary);
    const banner = interaction.options.getString("banner");
    const icon = interaction.options.getString("icone");
    const footer = interaction.options.getString("rodape") || `${config.botName || "BznX Store"} • Anúncio`;
    const role = interaction.options.getRole("mencionar_cargo");

    if (!channel?.send) {
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Canal inválido",
          description: "Não consigo enviar mensagens nesse canal.",
          color: config.colors?.danger,
          icon: "⚠️"
        })]
      });
    }

    const embed = createModerationEmbed(config, {
      title,
      description: message,
      color,
      icon: "📢",
      thumbnail: icon,
      image: banner,
      footer
    });

    await channel.send({
      content: role ? `${role}` : null,
      embeds: [embed],
      allowedMentions: role ? { roles: [role.id] } : { parse: [] }
    });

    const caseItem = addModerationCase({
      guildId: interaction.guild.id,
      action: "announce",
      targetId: channel.id,
      targetTag: `#${channel.name}`,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason: `Anúncio enviado em #${channel.name}`
    });

    const logEmbed = createModerationEmbed(config, {
      title: "Anúncio enviado",
      description: "O anúncio foi publicado com sucesso.",
      color: config.colors?.success,
      icon: "📢",
      fields: buildCaseFields(caseItem, [
        { name: "📍 Canal", value: `${channel}`, inline: true },
        { name: "🏷️ Título", value: title.slice(0, 1024), inline: false }
      ])
    });

    await interaction.editReply({ embeds: [logEmbed] });
    await sendModerationLog(interaction, config, logEmbed);
  }
};
