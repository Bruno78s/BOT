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
const { getTicketStatusLabel, setTicketInternalStatus } = require("../utils/ticketAutomation");

function canManageTicket(member, settings) {
  const hasSupportRole = settings.support_role_id && member.roles.cache.has(settings.support_role_id);
  return hasSupportRole || member.permissions.has(PermissionFlagsBits.Administrator);
}

function buildStatusNotification(status, ticket, actor) {
  const userMention = `<@${ticket.user_id}>`;
  const staffMention = `${actor}`;
  const map = {
    claimed: {
      content: userMention,
      title: "🙋 Ticket assumido",
      description: `${staffMention} assumiu seu atendimento. A equipe já está acompanhando este ticket.`
    },
    waiting_customer: {
      content: userMention,
      title: "👤 Aguardando cliente",
      description: `${userMention}, precisamos do seu retorno para continuar o atendimento.`
    },
    waiting_staff: {
      content: null,
      title: "🛠️ Aguardando staff",
      description: `Ticket marcado por ${staffMention}. A equipe precisa dar continuidade.`
    },
    reviewing: {
      content: userMention,
      title: "🔎 Em análise",
      description: `${userMention}, seu caso está em análise pela equipe.`
    },
    resolved: {
      content: userMention,
      title: "✅ Atendimento resolvido",
      description: `${userMention}, este atendimento foi marcado como resolvido. Se ainda precisar de algo, responda aqui antes do fechamento.`
    }
  };

  return map[status] || {
    content: userMention,
    title: `📌 Status atualizado: ${getTicketStatusLabel(status)}`,
    description: `Alterado por ${staffMention}.`
  };
}

async function handleTicketButtons(interaction, config) {
  const { customId } = interaction;

  if (customId === "ticket_claim") {
    await interaction.deferReply({ ephemeral: true });
    const settings = await getSettings(interaction.guild.id) || {};
    const member = interaction.member;
    if (!canManageTicket(member, settings)) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Sem permissão", "Apenas staff pode assumir tickets.")]
      });
    }

    const updated = setTicketInternalStatus(interaction.channel.id, "claimed", member.id);
    if (!updated) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Ticket não encontrado", "Este canal não está registrado como ticket aberto.")]
      });
    }

    const notification = buildStatusNotification("claimed", updated, interaction.user);
    await interaction.channel.send({
      content: notification.content || undefined,
      embeds: [infoEmbed(config, notification.title, notification.description)]
    });

    await interaction.editReply({
      embeds: [successEmbed(config, "Ticket assumido", "Você assumiu este ticket com sucesso.")]
    });
    return true;
  }

  if (customId.startsWith("ticket_status_")) {
    await interaction.deferReply({ ephemeral: true });
    const settings = await getSettings(interaction.guild.id) || {};
    if (!canManageTicket(interaction.member, settings)) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Sem permissão", "Apenas staff pode alterar o status do ticket.")]
      });
    }

    const status = customId.replace("ticket_status_", "");
    const updated = setTicketInternalStatus(interaction.channel.id, status, interaction.user.id);
    if (!updated) {
      return interaction.editReply({
        embeds: [dangerEmbed(config, "Ticket não encontrado", "Este canal não está registrado como ticket aberto.")]
      });
    }

    const label = getTicketStatusLabel(status);
    const notification = buildStatusNotification(status, updated, interaction.user);
    await interaction.channel.send({
      content: notification.content || undefined,
      embeds: [infoEmbed(config, notification.title, notification.description)]
    });

    await interaction.editReply({
      embeds: [successEmbed(config, "Status atualizado", `Ticket marcado como **${label}**.`)]
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
