const { EmbedBuilder } = require("discord.js");
const { all, get, run } = require("../database/db");

const STATUS_LABELS = {
  open: "Aberto",
  claimed: "Assumido",
  waiting_customer: "Aguardando cliente",
  waiting_staff: "Aguardando staff",
  reviewing: "Em análise",
  resolved: "Resolvido"
};

function getTicketStatusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.open;
}

function touchTicketActivity(channelId) {
  run(
    "UPDATE tickets SET last_activity_at = ?, auto_close_warned_at = NULL WHERE channel_id = ? AND status = 'open'",
    [Date.now(), channelId]
  );
}

function setTicketInternalStatus(channelId, status, userId = null) {
  const ticket = get("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'", [channelId]);
  if (!ticket) return null;

  const claimedBy = status === "claimed" && userId ? userId : ticket.claimed_by;
  run(
    "UPDATE tickets SET internal_status = ?, claimed_by = ?, last_activity_at = ?, auto_close_warned_at = NULL WHERE id = ?",
    [status, claimedBy, Date.now(), ticket.id]
  );

  return { ...ticket, internal_status: status, claimed_by: claimedBy };
}

async function startTicketAutoClose(client, config) {
  const warnHours = Math.max(Number(process.env.TICKET_AUTO_CLOSE_WARN_HOURS || 12), 1);
  const closeHours = Math.max(Number(process.env.TICKET_AUTO_CLOSE_HOURS || 24), warnHours + 1);
  const checkMs = Math.max(Number(process.env.TICKET_AUTO_CLOSE_CHECK_MS || 10 * 60 * 1000), 60 * 1000);

  async function checkTickets() {
    const now = Date.now();
    const tickets = all(
      "SELECT * FROM tickets WHERE status = 'open' AND type = 'support'",
      []
    );

    for (const ticket of tickets) {
      const lastActivity = ticket.last_activity_at || ticket.created_at;
      const inactiveMs = now - lastActivity;
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel?.send) {
        run(
          "UPDATE tickets SET status = 'closed', closed_at = ?, close_reason = ? WHERE id = ?",
          [now, "Canal não encontrado durante checagem automática", ticket.id]
        );
        continue;
      }

      if (inactiveMs >= closeHours * 60 * 60 * 1000) {
        run(
          "UPDATE tickets SET status = 'closed', internal_status = 'resolved', closed_at = ?, close_reason = ? WHERE id = ?",
          [now, "Fechado automaticamente por inatividade", ticket.id]
        );

        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("🔒 Ticket fechado por inatividade")
              .setDescription(`Este ticket ficou sem movimentação por ${closeHours} horas e foi encerrado automaticamente.`)
              .setFooter({ text: `${config.botName} • Tickets` })
              .setTimestamp()
          ]
        }).catch(() => null);

        setTimeout(() => channel.delete("Ticket fechado automaticamente por inatividade").catch(() => null), 8000);
        continue;
      }

      if (!ticket.auto_close_warned_at && inactiveMs >= warnHours * 60 * 60 * 1000) {
        run("UPDATE tickets SET auto_close_warned_at = ? WHERE id = ?", [now, ticket.id]);
        await channel.send({
          content: `<@${ticket.user_id}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle("⏳ Ticket parado")
              .setDescription(`Este ticket está sem movimentação. Se ninguém responder, ele será fechado automaticamente em até ${closeHours} horas de inatividade.`)
              .setFooter({ text: `${config.botName} • Tickets` })
              .setTimestamp()
          ]
        }).catch(() => null);
      }
    }
  }

  await checkTickets().catch((error) => console.error("[TICKETS] Erro no auto-fechamento:", error.message));
  const timer = setInterval(() => {
    checkTickets().catch((error) => console.error("[TICKETS] Erro no auto-fechamento:", error.message));
  }, checkMs);
  if (timer.unref) timer.unref();
  console.log(`[TICKETS] Auto-fechamento ativo: aviso ${warnHours}h, fechamento ${closeHours}h.`);
  return timer;
}

module.exports = {
  getTicketStatusLabel,
  setTicketInternalStatus,
  startTicketAutoClose,
  touchTicketActivity
};
