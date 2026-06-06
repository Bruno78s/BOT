/**
 * Handler de Verificacao — botao de verificar membro
 */
const { infoEmbed, successEmbed, dangerEmbed } = require("../utils/embeds");
const { performVerification, formatVerificationResults } = require("../utils/verification");
const { logSecurityEvent } = require("../utils/advancedLogger");
const { logSeguranca } = require("../utils/channelLogger");

async function handleVerification(interaction, config) {
  if (interaction.customId !== "verify_button") return false;

  const { channelId, unverifiedRoleId, verifiedRoleId } = config.verification;

  if (interaction.channelId !== channelId) {
    await interaction.reply({
      embeds: [dangerEmbed(config, "Canal incorreto", "Use este bot\u00E3o apenas no canal de verifica\u00E7\u00E3o.")],
      ephemeral: true
    });
    return true;
  }

  const member = interaction.member;
  const unverifiedRole = await interaction.guild.roles.fetch(unverifiedRoleId).catch(() => null);
  const verifiedRole = await interaction.guild.roles.fetch(verifiedRoleId).catch(() => null);

  if (!unverifiedRole || !verifiedRole) {
    await interaction.reply({
      embeds: [dangerEmbed(config, "Configura\u00E7\u00E3o de erro", "Cargos de verifica\u00E7\u00E3o n\u00E3o configurados corretamente.")],
      ephemeral: true
    });
    return true;
  }

  if (member.roles.cache.has(verifiedRoleId)) {
    await interaction.reply({
      embeds: [infoEmbed(config, "J\u00E1 verificado", "Voc\u00EA j\u00E1 est\u00E1 verificado e tem acesso ao servidor.")],
      ephemeral: true
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  await interaction.editReply({
    embeds: [
      infoEmbed(
        config,
        "\uD83D\uDD0D Verificando...",
        "Por favor, aguarde enquanto verificamos sua conta..."
      )
    ]
  });

  await new Promise(resolve => setTimeout(resolve, 5000));

  const verificationResult = await performVerification(member, config);

  if (!verificationResult.success) {
    await interaction.editReply({
      embeds: [
        dangerEmbed(
          config,
          "\u274C Verifica\u00E7\u00E3o Falhou",
          verificationResult.reason
        )
      ]
    });
    return true;
  }

  try {
    await member.roles.remove(unverifiedRole);
    await member.roles.add(verifiedRole);

    const resultsText = formatVerificationResults(verificationResult.results);

    await interaction.editReply({
      embeds: [
        successEmbed(
          config,
          "\u2705 Verifica\u00E7\u00E3o Conclu\u00EDda com Sucesso",
          [
            "Bem-vindo ao servidor! Voc\u00EA agora tem acesso a todos os canais.",
            "",
            "### \uD83D\uDCCB Resultado da Verifica\u00E7\u00E3o:",
            resultsText,
            "",
            " Aproveite sua estadia!"
          ].join("\n")
        )
      ]
    });

    await logSecurityEvent(
      interaction.client,
      config,
      "Verifica\u00E7\u00E3o Conclu\u00EDda",
      member.id,
      {
        description: `Usu\u00E1rio ${member.user.tag} foi verificado com sucesso via bot\u00E3o.`,
        fields: [
          { name: "Usu\u00E1rio", value: `${member.user.tag}`, inline: true },
          { name: "Cargo", value: `<@&${verifiedRoleId}>`, inline: true },
          { name: "Resultados", value: resultsText.substring(0, 100) + "...", inline: false }
        ]
      }
    );
    await logSeguranca(interaction.client, config, {
      evento: "Usu\u00E1rio Verificado",
      userId: member.id,
      detalhes: `${member.user.tag} passou pela verifica\u00E7\u00E3o com sucesso.`,
    }).catch(() => null);
  } catch (error) {
    console.error("Erro ao verificar usu\u00E1rio:", error);
    await interaction.editReply({
      embeds: [
        dangerEmbed(
          config,
          "Erro na verifica\u00E7\u00E3o",
          "N\u00E3o foi poss\u00EDvel completar a verifica\u00E7\u00E3o. Contate um administrador."
        )
      ]
    });
  }

  return true;
}

module.exports = { handleVerification };
