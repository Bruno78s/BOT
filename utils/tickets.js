const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const { all, get, run } = require("../database/db");
const { infoEmbed, successEmbed, warningEmbed } = require("./embeds");
const { logTicketCriado, logFeedback } = require("./channelLogger");
const { buildTermsEmbed } = require("./salesFlow");

function formatTicketNumber(number) {
  return String(number).padStart(3, "0");
}

async function ensureCounter(guildId, type) {
  const existing = await get(
    "SELECT last_number FROM counters WHERE guild_id = ? AND type = ?",
    [guildId, type]
  );
  if (!existing) {
    await run(
      "INSERT INTO counters (guild_id, type, last_number) VALUES (?, ?, 0)",
      [guildId, type]
    );
    return 0;
  }
  return existing.last_number;
}

async function nextTicketNumber(guildId, type) {
  const last = await ensureCounter(guildId, type);
  const next = last + 1;
  await run(
    "UPDATE counters SET last_number = ? WHERE guild_id = ? AND type = ?",
    [next, guildId, type]
  );
  return next;
}

async function canCreateTicket(guild, userId, type, config) {
  const guildId = guild.id;
  const openTickets = await get(
    "SELECT COUNT(*) as total FROM tickets WHERE guild_id = ? AND status = 'open'",
    [guildId]
  );
  const totalOpen = openTickets && typeof openTickets.total === "number" ? openTickets.total : 0;
  if (totalOpen >= config.limits.maxOpenTicketsPerGuild) {
    return { ok: false, reason: "Limite de tickets simultaneos atingido." };
  }

  const openSameTypeTicket = await get(
    "SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND type = ? AND status = 'open' LIMIT 1",
    [guildId, userId, type]
  );
  if (openSameTypeTicket) {
    const label = type === "sales" ? "carrinho" : "ticket";
    
    try {
      const channel = await guild.channels.fetch(openSameTypeTicket.channel_id).catch(() => null);
      if (!channel) {
        await run(
          "UPDATE tickets SET status = 'closed', closed_at = ? WHERE channel_id = ?",
          [Date.now(), openSameTypeTicket.channel_id]
        );
        return { ok: true };
      }
      return {
        ok: false,
        reason: `Você já possui um ${label} aberto: <#${openSameTypeTicket.channel_id}>. Encerre ele antes de abrir outro.`
      };
    } catch (error) {
      await run(
        "UPDATE tickets SET status = 'closed', closed_at = ? WHERE channel_id = ?",
        [Date.now(), openSameTypeTicket.channel_id]
      );
      return { ok: true };
    }
  }

  const user = await get(
    "SELECT last_ticket_at FROM users WHERE guild_id = ? AND user_id = ?",
    [guildId, userId]
  );
  
  // Aplicar cooldown apenas se o último ticket foi do MESMO tipo
  const lastSameTypeTicket = await get(
    "SELECT created_at FROM tickets WHERE guild_id = ? AND user_id = ? AND type = ? AND status = 'closed' ORDER BY created_at DESC LIMIT 1",
    [guildId, userId, type]
  );
  
  if (lastSameTypeTicket) {
    const diffMs = Date.now() - lastSameTypeTicket.created_at;
    const cooldownMs = config.limits.ticketCooldownMinutes * 60 * 1000;
    if (diffMs < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - diffMs) / 60000);
      return { ok: false, reason: `Aguarde ${remaining} minuto(s) para abrir novo ${type === "sales" ? "carrinho" : type === "delivery" ? "pedido de entrega" : "ticket de suporte"}.` };
    }
  }

  return { ok: true };
}

async function createTicket({ guild, member, type, config, settings = {}, productId, reason = null, paymentId = null }) {
  const canCreate = await canCreateTicket(guild, member.id, type, config);
  if (!canCreate.ok) {
    return { error: canCreate.reason };
  }

  const number = await nextTicketNumber(guild.id, type);
  const formatted = formatTicketNumber(number);
  const safeUserName = member.user.username.toLowerCase().replace(/[^a-z0-9-]/gi, "-").slice(0, 18);
  const channelName = type === "sales" ? `🛒・${safeUserName}` : type === "delivery" ? `📦・${safeUserName}` : `📩・${reason || "suporte"}・${safeUserName}`;
  const categoryId = type === "sales" ? (settings.sales_category_id || config.salesCategoryId) : type === "delivery" ? (settings.delivery_category_id || config.deliveryCategoryId) : (settings.support_category_id || config.ticketCategoryId);
  const overwrites = [
    {
      id: guild.roles.everyone,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: member.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    }
  ];

  if (settings.support_role_id) {
    overwrites.push({
      id: settings.support_role_id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: overwrites
  });

  await run(
    "INSERT INTO tickets (guild_id, channel_id, user_id, type, product_id, number, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
    [guild.id, channel.id, member.id, type, productId || null, number, Date.now()]
  );

  await run(
    "INSERT INTO users (guild_id, user_id, last_ticket_at) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET last_ticket_at = excluded.last_ticket_at",
    [guild.id, member.id, Date.now()]
  );

  const selectedProduct = productId
    ? config.products.find((p) => p.id === productId)
    : null;

  if (type === "delivery") {
    const payment = await get("SELECT * FROM payments WHERE id = ?", [paymentId]);
    const product = productId ? config.products.find(p => p.id === productId) : null;
    const deliveryEmbed = infoEmbed(
      config,
      `${config.botName} | Ticket de Entrega • #${formatted}`,
      "Ticket de entrega de produto. Aguarde a entrega pela equipe."
    ).addFields([
      {
        name: "ID do Pedido",
        value: `#${payment?.id || "N/A"}`,
        inline: true
      },
      {
        name: "Produto",
        value: product?.name || "N/A",
        inline: true
      },
      {
        name: "Valor",
        value: payment ? formatPrice(payment.amount) : "N/A",
        inline: true
      },
      {
        name: "Pagamento",
        value: payment?.provider_payment_id || payment?.preference_id || "N/A",
        inline: false
      }
    ]).setFooter({ text: `${config.botName} • Entrega` });

    const deliveryRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Assumir")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Finalizar")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [deliveryEmbed],
      components: [deliveryRow]
    });
  } else if (type === "sales") {
    const termsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("cart_accept_terms")
        .setLabel("Aceitar e Continuar")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("ticket_cancel_purchase")
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cart_read_terms")
        .setLabel("Ler Termos")
        .setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [buildTermsEmbed(config, member, selectedProduct)],
      components: [termsRow]
    });
  } else {
    const supportEmbed = infoEmbed(
      config,
      `${config.botName} | Atendimento • #${formatted}`,
      "Atendimento iniciado. Descreva sua solicitação com detalhes."
    ).addFields({
      name: "Instruções",
      value: `Motivo: **${reason || "suporte"}**\nInforme detalhes, anexos e qualquer informação importante para agilizar o atendimento.`,
      inline: false
    }).setFooter({ text: `${config.botName} • Suporte` });

    const supportRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Assumir")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Finalizar")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [supportEmbed],
      components: [supportRow]
    });
  }

  await logTicketCriado(channel.client, config, {
    userId: member.id,
    type,
    channelId: channel.id,
    reason: reason || null,
  }).catch(() => null);

  return { channel };
}

async function closeTicket(channel, userId, config, options = {}) {
  const ticket = await get(
    "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'",
    [channel.id]
  );

  if (!ticket) {
    return { error: "Ticket não encontrado ou já fechado." };
  }

  await run(
    "UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?",
    [Date.now(), ticket.id]
  );

  if (options.requestRating) {
    const ratingRow = new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map((value) =>
        new ButtonBuilder()
          .setCustomId(`ticket_rate_${value}`)
          .setLabel(String(value))
          .setStyle(ButtonStyle.Secondary)
      )
    );

    const closeEmbed = successEmbed(
      config,
      "Ticket encerrado",
      "Avalie o atendimento de 1 a 5 para concluir."
    ).setFooter({ text: `${config.botName} • Feedback` });

    await channel.send({ embeds: [closeEmbed], components: [ratingRow] });
  } else {
    const closeEmbed = successEmbed(
      config,
      "Ticket encerrado",
      "O canal será encerrado em instantes."
    ).setFooter({ text: `${config.botName} • Encerramento` });

    await channel.send({ embeds: [closeEmbed] });

    setTimeout(() => {
      channel.delete("Ticket encerrado").catch(() => null);
    }, 5000);
  }

  return { ticket, requestedBy: userId };
}

async function registerRating(channel, rating, config) {
  const ticket = await get("SELECT * FROM tickets WHERE channel_id = ?", [channel.id]);
  if (!ticket) return { error: "Ticket não encontrado." };

  await run("UPDATE tickets SET rating = ? WHERE id = ?", [rating, ticket.id]);

  await logFeedback(channel.client, config, {
    userId: ticket.user_id,
    rating,
    ticketName: channel.name,
    ticketId: ticket.id,
  }).catch(() => null);

  const ratingEmbed = warningEmbed(
    config,
    "⭐ Obrigado!",
    "Sua avaliação foi registrada. O canal será encerrado em 5 segundos."
  ).setFooter({ text: `${config.botName} • Encerramento` });

  await channel.send({ embeds: [ratingEmbed] });

  setTimeout(() => {
    channel.delete("Ticket encerrado").catch(() => null);
  }, 5000);

  return { ticket };
}

async function countOpenTickets(guildId) {
  const result = await get(
    "SELECT COUNT(*) as total FROM tickets WHERE guild_id = ? AND status = 'open'",
    [guildId]
  );
  return result && typeof result.total === "number" ? result.total : 0;
}

async function listTicketByChannel(channelId) {
  return get("SELECT * FROM tickets WHERE channel_id = ?", [channelId]);
}

async function listTicketByUser(guildId, userId) {
  return all(
    "SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC",
    [guildId, userId]
  );
}

module.exports = {
  createTicket,
  closeTicket,
  registerRating,
  countOpenTickets,
  listTicketByChannel,
  listTicketByUser
};
