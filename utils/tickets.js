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
const { buildTermsEmbed, formatPrice } = require("./salesFlow");
const { recordCustomerTicket } = require("./customers");

function formatTicketNumber(number) {
  return String(number).padStart(3, "0");
}

function slugifyChannelPart(value, fallback = "ticket") {
  return String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || fallback;
}

function getTicketTypeLabel(type, reason) {
  if (type === "sales") return "Carrinho";
  if (type === "delivery") return "Entrega";
  const labels = {
    suporte: "Suporte",
    "problema-servico": "Problema com Serviço",
    financeiro: "Financeiro",
    parceria: "Parceria"
  };
  return labels[reason] || "Atendimento";
}

function getTicketChannelEmoji(type, reason) {
  if (type === "sales") return "🛒";
  if (type === "delivery") return "📦";

  const emojis = {
    suporte: "🎫",
    "problema-servico": "⚠️",
    financeiro: "💳",
    parceria: "🤝"
  };

  return emojis[reason] || "🎫";
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

  const userOpenTickets = await get(
    "SELECT COUNT(*) as total FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'",
    [guildId, userId]
  );
  const maxOpenPerUser = Math.max(Number(process.env.MAX_OPEN_TICKETS_PER_USER || 2), 1);
  if (Number(userOpenTickets?.total || 0) >= maxOpenPerUser) {
    return { ok: false, reason: `Você já possui ${maxOpenPerUser} ticket(s)/carrinho(s) aberto(s). Encerre um deles antes de abrir outro.` };
  }

  if (type === "sales") {
    const pendingPayment = await get(
      "SELECT channel_id FROM payments WHERE guild_id = ? AND user_id = ? AND status = 'pending' LIMIT 1",
      [guildId, userId]
    );
    if (pendingPayment) {
      return { ok: false, reason: `Você já possui um pagamento pendente em <#${pendingPayment.channel_id}>. Finalize ou cancele antes de criar outro carrinho.` };
    }
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
  
  // Aplicar cooldown apenas se o último ticket foi do mesmo tipo.
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
  const safeUserName = slugifyChannelPart(member.user.username, "usuario");
  const ticketEmoji = getTicketChannelEmoji(type, reason);
  const channelName = `${ticketEmoji}・${safeUserName}`;
  const categoryId = type === "sales"
    ? (settings.sales_category_id || config.salesCategoryId)
    : type === "delivery"
      ? (settings.delivery_category_id || config.deliveryCategoryId || config.ticketCategoryId)
      : (settings.support_category_id || config.ticketCategoryId);

  if (!categoryId) {
    throw new Error(`Categoria de canal não configurada para tipo de ticket: ${type}`);
  }

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

  const insertStartTime = Date.now();
  try {
    await run(
      "INSERT INTO tickets (guild_id, channel_id, user_id, type, product_id, number, status, internal_status, last_activity_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', 'open', ?, ?)",
      [guild.id, channel.id, member.id, type, productId || null, number, Date.now(), Date.now()]
    );
    recordCustomerTicket({ guild_id: guild.id, user_id: member.id });
    const insertTime = Date.now() - insertStartTime;
    console.log(`[TICKETS] INSERT successful (${insertTime}ms): channel=${channel.id}, user=${member.id}, type=${type}, product_id=${productId || null}`);
  } catch (error) {
    console.error(`[TICKETS] INSERT failed: ${error.message}`, { 
      guild_id: guild.id,
      channel_id: channel.id,
      user_id: member.id,
      type,
      product_id: productId || null,
      number
    });
    throw error;
  }

  console.log(`[TICKETS] Ticket created: guild=${guild.id}, channel=${channel.id}, user=${member.id}, type=${type}, number=${formatted}`);
  
  // Aguarda a propagação dos canais no cache do Discord antes de retornar
  await new Promise(resolve => setTimeout(resolve, 150));

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
      `${config.botName} | Ticket de Entrega - #${formatted}`,
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
    ]).setFooter({ text: `${config.botName} - Entrega` });

    const deliveryRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Assumir")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Finalizar")
        .setEmoji("🔒")
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
    const reasonLabel = getTicketTypeLabel(type, reason);
    const supportEmbed = infoEmbed(
      config,
      `🎫 ${config.botName} | ${reasonLabel} #${formatted}`,
      [
        `Atendimento aberto para ${member}.`,
        "",
        "Descreva sua solicitação com detalhes para agilizar o atendimento."
      ].join("\n")
    ).addFields(
      {
        name: "📌 Motivo",
        value: reasonLabel,
        inline: true
      },
      {
        name: "👤 Cliente",
        value: `<@${member.id}>`,
        inline: true
      },
      {
        name: "🧾 Código",
        value: `#${formatted}`,
        inline: true
      },
      {
        name: "📋 O que enviar",
        value: "Explique o problema, envie prints/anexos e informe IDs, links ou dados importantes.",
        inline: false
      }
    ).setFooter({ text: `${config.botName} • Atendimento` });

    const supportRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Assumir")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_status_waiting_customer")
        .setLabel("Cliente")
        .setEmoji("👤")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("ticket_status_waiting_staff")
        .setLabel("Staff")
        .setEmoji("🛠️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("ticket_status_reviewing")
        .setLabel("Análise")
        .setEmoji("🔎")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("ticket_status_resolved")
        .setLabel("Resolvido")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
    );

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Finalizar")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [supportEmbed],
      components: [supportRow, closeRow]
    });
  }

  if (type !== "sales") {
    await logTicketCriado(channel.client, config, {
      userId: member.id,
      type,
      channelId: channel.id,
      reason: reason || null,
    }).catch(() => null);
  }

  return { channel };
}

async function closeTicket(channel, userId, config, options = {}) {
  const ticket = await get(
    "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'",
    [channel.id]
  );

  if (!ticket) {
    console.error(`[TICKETS] closeTicket: ticket not found for channel ${channel.id}`);
    return { error: "Ticket não encontrado ou já fechado." };
  }

  try {
    await run(
      "UPDATE tickets SET status = 'closed', internal_status = 'resolved', closed_at = ?, close_reason = ? WHERE id = ?",
      [Date.now(), "Fechado manualmente", ticket.id]
    );
    console.log(`[TICKETS] Ticket closed: channel=${channel.id}, ticket_id=${ticket.id}`);
  } catch (error) {
    console.error(`[TICKETS] Error closing ticket: ${error.message}`, { channel_id: channel.id, ticket_id: ticket.id });
  }

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
    ).setFooter({ text: `${config.botName} - Feedback` });

    await channel.send({ embeds: [closeEmbed], components: [ratingRow] });
  } else {
    const closeEmbed = successEmbed(
      config,
      "Ticket encerrado",
      "O canal será encerrado em instantes."
    ).setFooter({ text: `${config.botName} - Encerramento` });

    await channel.send({ embeds: [closeEmbed] });

    setTimeout(() => {
      channel.delete("Ticket encerrado").catch(() => null);
    }, 5000);
  }

  return { ticket, requestedBy: userId };
}

async function registerRating(channel, rating, config) {
  const ticket = await get("SELECT * FROM tickets WHERE channel_id = ?", [channel.id]);
  if (!ticket) {
    console.error(`[TICKETS] registerRating: ticket not found for channel ${channel.id}`);
    return { error: "Ticket não encontrado." };
  }

  await run("UPDATE tickets SET rating = ? WHERE id = ?", [rating, ticket.id]);

  await logFeedback(channel.client, config, {
    userId: ticket.user_id,
    rating,
    ticketName: channel.name,
    ticketId: ticket.id,
  }).catch(() => null);

  const ratingEmbed = warningEmbed(
    config,
    "Obrigado!",
    "Sua avaliação foi registrada. O canal será encerrado em 5 segundos."
  ).setFooter({ text: `${config.botName} - Encerramento` });

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

async function listTicketByChannel(channelId, retries = 8, delayMs = 350) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ticket = await get("SELECT * FROM tickets WHERE channel_id = ?", [channelId]);
      if (ticket) {
        if (attempt > 1) console.log(`[TICKETS] Found ticket on attempt ${attempt} after ${(attempt - 1) * delayMs}ms`);
        return ticket;
      }
      if (attempt < retries) {
        console.log(`[TICKETS] Attempt ${attempt}/${retries}: ticket not found, retrying in ${delayMs}ms...`);
      }
    } catch (error) {
      console.error(`[TICKETS] Error on attempt ${attempt}: ${error.message}`);
    }
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  console.error(`[TICKETS] Ticket not found for channel ${channelId} after ${retries} retries (waited ${(retries - 1) * delayMs}ms total)`);
  return null;
}

async function listTicketByUser(guildId, userId) {
  return await all(
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

