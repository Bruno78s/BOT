const { AttachmentBuilder, ChannelType, SlashCommandBuilder } = require("discord.js");
const path = require("path");
const {
  addModerationCase,
  buildCaseFields,
  createModerationEmbed,
  requireModerationPermission,
  sendModerationLog
} = require("../utils/moderation");

const ANNOUNCEMENT_COLORS = {
  azul: "#1e88e5",
  verde: "#2e7d32",
  amarelo: "#f9a825",
  vermelho: "#c62828",
  roxo: "#7c3aed",
  rosa: "#db2777",
  ciano: "#0891b2",
  grafite: "#111827"
};

function buildOfficialFiles() {
  return [
    new AttachmentBuilder(path.join(__dirname, "..", "public", "LOGO2.png"), { name: "logo.png" }),
    new AttachmentBuilder(path.join(__dirname, "..", "public", "banner-bznx.png"), { name: "banner.png" })
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("an")
    .setDescription("Envia um anúncio profissional em embed.")
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
      option
        .setName("cor")
        .setDescription("Cor visual do anúncio.")
        .setRequired(true)
        .addChoices(
          { name: "Azul BznX", value: "azul" },
          { name: "Verde aprovado", value: "verde" },
          { name: "Amarelo aviso", value: "amarelo" },
          { name: "Vermelho importante", value: "vermelho" },
          { name: "Roxo premium", value: "roxo" },
          { name: "Rosa destaque", value: "rosa" },
          { name: "Ciano tecnologia", value: "ciano" },
          { name: "Grafite institucional", value: "grafite" }
        )
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
    const colorKey = interaction.options.getString("cor", true);
    const footer = interaction.options.getString("rodape") || `${config.botName || "BznX Store"} • Anúncio oficial`;
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
      color: ANNOUNCEMENT_COLORS[colorKey] || config.colors?.primary,
      icon: "📢",
      thumbnail: "attachment://logo.png",
      image: "attachment://banner.png",
      footer
    });

    await channel.send({
      content: role ? `${role}` : null,
      embeds: [embed],
      files: buildOfficialFiles(),
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
      description: "O anúncio foi publicado com a identidade oficial da loja.",
      color: config.colors?.success,
      icon: "📢",
      fields: buildCaseFields(caseItem, [
        { name: "Canal", value: `${channel}`, inline: true },
        { name: "Cor", value: colorKey, inline: true },
        { name: "Título", value: title.slice(0, 1024), inline: false }
      ])
    });

    await interaction.editReply({ embeds: [logEmbed] });
    await sendModerationLog(interaction, config, logEmbed);
  }
};
