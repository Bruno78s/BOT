/**
 * Handler de Tickets — fechar, avaliar, assumir
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");
const { infoEmbed, successEmbed, dangerEmbed } = require("../utils/embeds");
const { closeTicket, registerRating, listTicketByChannel } = require("../utils/tickets");
const { logToDb, logToChannel } = require("../utils/logger");
const { logTicketEvent, logFeedbackEvent } = require("../utils/advancedLogger");
const { getSettings } = require("../utils/settings");
const { formatDuration, formatStars } = require("./shared");

async function handleTicketButtons(interaction, config) {
  const { customId } = interaction;

  if (customId === "ticket_claim") {
    const settings = await getSettings(interaction.guild.id) || {};
    const member = interaction.member;
    const hasSupportRole = settings.support_role_id && member.roles.cache.has(settings.support_role_id);
    if (!hasSupportRole && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [dangerEmbed(config, "Sem permiss\u00E3o", "Apenas staff pode assumir tickets.")],
        ephemeral: true
      });
    }

    const channel = interaction.channel;
    await channel.send({
      content: `\uD83C\uDFAB **Ticket assumido por ${member.user.tag}**`
    });

    await interaction.reply({
      embeds: [successEmbed(config, "Ticket assumido", "Voc\u00EA assumiu este ticket com sucesso.")],
      ephemeral: true
    });
    return true;
  }

  if (customId === "ticket_close") {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close_confirm")
        .setLabel("Confirmar fechamento")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [infoEmbed(config, "<a:atencaocc:1472985634678505603> Confirma\u00E7\u00E3o <a:atencaocc:1472985634678505603>", "Deseja realmente fechar este ticket?")],
      components: [row],
      ephemeral: true
    });
    return true;
  }

  if (customId === "ticket_close_confirm") {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const ticketData = await listTicketByChannel(interaction.channel.id);
    if (!ticketData) {
      await interaction.editReply({
        embeds: [dangerEmbed(config, "Aviso", "Este ticket não está registrado ou já foi fechado. O canal será removido em 5 segundos.")]
      });
      await interaction.channel.send({
        embeds: [successEmbed(config, "🔴 Fechamento", "Este canal será encerrado em 5 segundos...")]
      });
      setTimeout(() => {
        interaction.channel.delete("Ticket não encontrado no registro").catch(() => null);
      }, 5000);
      return true;
    }

    const shouldRequestRating = ticketData?.type === "support";
    const result = await closeTicket(interaction.channel, interaction.user.id, config, {
      requestRating: shouldRequestRating
    });
    if (result.error) {
      await interaction.channel.send({
        embeds: [successEmbed(config, "🔴 Fechamento", "Este canal será encerrado em 5 segundos...")]
      });
      setTimeout(() => {
        interaction.channel.delete("Ticket fechado manualmente").catch(() => null);
      }, 5000);
      return interaction.editReply({
        embeds: [infoEmbed(config, "Aviso", "Ticket sendo encerrado. O canal será removido em 5 segundos.")]
      });
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          config,
          "Fechamento iniciado",
          shouldRequestRating
            ? "Ticket encerrado. Aguarde a avaliação."
            : "Ticket encerrado sem solicitação de avaliação."
        )
      ]
    });

    const settings = await getSettings(interaction.guild.id);
    const logChannel = settings ? interaction.guild.channels.cache.get(settings.log_channel_id) : null;
    await logToDb(interaction.guild.id, "info", "Ticket fechado", {
      channelId: interaction.channel.id,
      userId: interaction.user.id
    });
    const durationText = formatDuration(Date.now() - result.ticket.created_at);
    await logToChannel(logChannel, config, "info", "Ticket encerrado.", {
      title: `${config.botName} | Ticket fechado`,
      fields: [
        { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true },
        { name: "Usuario", value: `<@${result.ticket.user_id}>`, inline: true },
        { name: "Staff", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Dura\u00E7\u00E3o", value: durationText, inline: true },
        { name: "Avalia\u00E7\u00E3o", value: shouldRequestRating ? "Aguardando usu\u00E1rio" : "N\u00E3o solicitada", inline: true },
        { name: "Transcri\u00E7\u00E3o", value: "N\u00E3o dispon\u00EDvel", inline: true }
      ],
      footer: "BznX Store \u2022 Logs"
    });

    await logTicketEvent(
      interaction.client,
      config,
      "Ticket Fechado",
      interaction.channel.id,
      {
        description: `Ticket fechado por ${interaction.user.tag}.`,
        fields: [
          { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true },
          { name: "Usu\u00E1rio", value: `<@${result.ticket.user_id}>`, inline: true },
          { name: "Staff", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Dura\u00E7\u00E3o", value: durationText, inline: true }
        ]
      }
    );
    return true;
  }

  if (customId.startsWith("ticket_rate_")) {
    const rating = Number(customId.split("_").pop());
    const result = await registerRating(interaction.channel, rating, config);
    if (result.error) {
      return interaction.reply({
        embeds: [dangerEmbed(config, "Erro", result.error)],
        ephemeral: true
      });
    }

    await interaction.reply({
      embeds: [successEmbed(config, "Avalia\u00E7\u00E3o recebida", `Nota registrada: ${rating} estrelas.`)],
      ephemeral: true
    });

    const settings = await getSettings(interaction.guild.id);
    const logChannel = settings ? interaction.guild.channels.cache.get(settings.log_channel_id) : null;
    await logToDb(interaction.guild.id, "info", "Avalia\u00E7\u00E3o registrada", {
      channelId: interaction.channel.id,
      userId: result.ticket.user_id,
      rating
    });
    await logToChannel(logChannel, config, "info", "Avalia\u00E7\u00E3o recebida.", {
      title: `${config.botName} | Feedback`,
      fields: [
        { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true },
        { name: "Usu\u00E1rio", value: `<@${result.ticket.user_id}>`, inline: true },
        { name: "Nota", value: formatStars(rating), inline: true }
      ],
      footer: "BznX Store \u2022 Logs"
    });

    await logFeedbackEvent(
      interaction.client,
      config,
      rating,
      interaction.channel.id,
      result.ticket.user_id
    );
    return true;
  }

  return false;
}

module.exports = { handleTicketButtons };
