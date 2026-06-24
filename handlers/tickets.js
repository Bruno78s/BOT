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
    await interaction.deferReply({ ephemeral: true });
    const settings = await getSettings(interaction.guild.id) || {};
    const member = interaction.member;
    const hasSupportRole = settings.support_role_id && member.roles.cache.has(settings.support_role_id);
    if (!hasSupportRole && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Sem permissão", "Apenas staff pode assumir tickets.")]
      });
    }

    await interaction.channel.send({
      content: `🙋 **Ticket assumido por ${member.user.tag}**`
    });

    await interaction.editReply({
      embeds: [successEmbed(config, "Ticket assumido", "Você assumiu este ticket com sucesso.")]
    });
    return true;
  }

  if (customId === "ticket_close") {
    await interaction.deferReply({ ephemeral: true });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close_confirm")
        .setLabel("Confirmar fechamento")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({
      embeds: [infoEmbed(config, "🔒 Confirmação", "Deseja realmente fechar este ticket?")],
      components: [row]
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
        embeds: [successEmbed(config, "🔒 Fechamento", "Este canal será encerrado em 5 segundos...")]
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
        embeds: [successEmbed(config, "🔒 Fechamento", "Este canal será encerrado em 5 segundos...")]
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
        { name: "Usuário", value: `<@${result.ticket.user_id}>`, inline: true },
        { name: "Staff", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Duração", value: durationText, inline: true },
        { name: "Avaliação", value: shouldRequestRating ? "Aguardando usuário" : "Não solicitada", inline: true },
        { name: "Transcrição", value: "Não disponível", inline: true }
      ],
      footer: "BznX Store • Logs"
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
          { name: "Usuário", value: `<@${result.ticket.user_id}>`, inline: true },
          { name: "Staff", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Duração", value: durationText, inline: true }
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
      embeds: [successEmbed(config, "Avaliação recebida", `Nota registrada: ${rating} estrelas.`)],
      ephemeral: true
    });

    const settings = await getSettings(interaction.guild.id);
    const logChannel = settings ? interaction.guild.channels.cache.get(settings.log_channel_id) : null;
    await logToDb(interaction.guild.id, "info", "Avaliação registrada", {
      channelId: interaction.channel.id,
      userId: result.ticket.user_id,
      rating
    });
    await logToChannel(logChannel, config, "info", "Avaliação recebida.", {
      title: `${config.botName} | Feedback`,
      fields: [
        { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true },
        { name: "Usuário", value: `<@${result.ticket.user_id}>`, inline: true },
        { name: "Nota", value: formatStars(rating), inline: true }
      ],
      footer: "BznX Store • Logs"
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
