const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { all, run } = require("../database/db");

let started = false;

function getCartAbandonmentSettings(config) {
  return {
    enabled: process.env.CART_ABANDONMENT_ENABLED
      ? process.env.CART_ABANDONMENT_ENABLED === "true"
      : config.cartAbandonment?.enabled ?? true,
    warnAfterMs: Number(process.env.CART_ABANDONMENT_WARN_MINUTES || config.cartAbandonment?.warnAfterMinutes || 20) * 60 * 1000,
    closeAfterMs: Number(process.env.CART_ABANDONMENT_CLOSE_MINUTES || config.cartAbandonment?.closeAfterMinutes || 60) * 60 * 1000
  };
}

async function warnAbandonedCart(client, config, ticket) {
  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel?.send) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("select_payment_gateway_menu")
      .setLabel("Escolher pagamento")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ticket_cancel_purchase")
      .setLabel("Cancelar compra")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${ticket.user_id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle("🛒 Carrinho aguardando você")
        .setDescription([
          "Seu carrinho ainda está aberto e sem pagamento aprovado.",
          "",
          "Finalize o pagamento para garantir o produto ou cancele se não quiser continuar."
        ].join("\n"))
        .setFooter({ text: `${config.botName} • Carrinho` })
        .setTimestamp()
    ],
    components: [row]
  }).catch(() => null);

  run("UPDATE tickets SET abandoned_warned_at = ? WHERE id = ?", [Date.now(), ticket.id]);
}

async function closeAbandonedCart(client, config, ticket) {
  run(
    "UPDATE tickets SET status = 'closed', internal_status = 'abandoned', closed_at = ?, close_reason = ? WHERE id = ?",
    [Date.now(), "Carrinho abandonado automaticamente", ticket.id]
  );
  run(
    "UPDATE payments SET status = 'cancelled', updated_at = ? WHERE channel_id = ? AND status = 'pending'",
    [Date.now(), ticket.channel_id]
  );

  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel?.send) return;

  await channel.send({
    content: `<@${ticket.user_id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.danger)
        .setTitle("🛒 Carrinho encerrado")
        .setDescription("Este carrinho foi fechado automaticamente por inatividade.")
        .setFooter({ text: `${config.botName} • Carrinho abandonado` })
        .setTimestamp()
    ]
  }).catch(() => null);

  setTimeout(() => channel.delete("Carrinho abandonado automaticamente").catch(() => null), 6000);
}

function startCartAbandonment(client, config) {
  if (started) return;
  started = true;

  const settings = getCartAbandonmentSettings(config);
  if (!settings.enabled) {
    console.log("[CART] Anti-abandono desativado.");
    return;
  }

  setInterval(async () => {
    const now = Date.now();
    const tickets = all(
      `SELECT * FROM tickets
       WHERE type = 'sales' AND status = 'open'
       ORDER BY created_at ASC
       LIMIT 50`
    );

    for (const ticket of tickets) {
      const hasApproved = all(
        "SELECT id FROM payments WHERE channel_id = ? AND status = 'approved' LIMIT 1",
        [ticket.channel_id]
      ).length > 0;
      if (hasApproved) continue;

      const referenceAt = ticket.last_activity_at || ticket.created_at;
      const ageMs = now - referenceAt;

      if (!ticket.abandoned_warned_at && ageMs >= settings.warnAfterMs) {
        await warnAbandonedCart(client, config, ticket);
        continue;
      }
      if (ageMs >= settings.closeAfterMs) {
        await closeAbandonedCart(client, config, ticket);
      }
    }
  }, 60 * 1000);

  console.log(`[CART] Anti-abandono ativo: aviso ${Math.round(settings.warnAfterMs / 60000)}m, fechamento ${Math.round(settings.closeAfterMs / 60000)}m.`);
}

module.exports = {
  getCartAbandonmentSettings,
  startCartAbandonment
};
