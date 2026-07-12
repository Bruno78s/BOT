const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchTicketMessages(channel, limit = 500) {
  const collected = [];
  let before;

  while (collected.length < limit) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, limit - collected.length), before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function buildTranscriptHtml({ channel, ticket, messages, config }) {
  const rows = messages.map((message) => {
    const attachments = message.attachments?.size
      ? [...message.attachments.values()].map((file) => `<a href="${escapeHtml(file.url)}">${escapeHtml(file.name || file.url)}</a>`).join("<br>")
      : "";
    const embeds = message.embeds?.length ? `<div class="embeds">${message.embeds.length} embed(s)</div>` : "";
    return `
      <article class="message">
        <img src="${escapeHtml(message.author.displayAvatarURL({ extension: "png", size: 64 }))}" />
        <div>
          <header><strong>${escapeHtml(message.author.tag)}</strong><span>${new Date(message.createdTimestamp).toLocaleString("pt-BR")}</span></header>
          <p>${escapeHtml(message.content || "").replace(/\n/g, "<br>") || "<em>Sem texto</em>"}</p>
          ${attachments ? `<div class="attachments">${attachments}</div>` : ""}
          ${embeds}
        </div>
      </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Transcript ${escapeHtml(channel.name)}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #101216; color: #f3f4f6; margin: 0; padding: 24px; }
    .wrap { max-width: 980px; margin: 0 auto; }
    .top { border-bottom: 1px solid #2f3440; padding-bottom: 16px; margin-bottom: 18px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    .meta { color: #b9c0cc; line-height: 1.6; }
    .message { display: grid; grid-template-columns: 48px 1fr; gap: 12px; padding: 14px 0; border-bottom: 1px solid #242833; }
    .message img { width: 42px; height: 42px; border-radius: 50%; }
    header { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; }
    header span { color: #9aa3b2; font-size: 12px; }
    p { margin: 0; white-space: normal; line-height: 1.45; }
    a { color: #60a5fa; }
    .attachments, .embeds { margin-top: 8px; color: #cbd5e1; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="top">
      <h1>${escapeHtml(config.botName)} • Transcript</h1>
      <div class="meta">
        Canal: #${escapeHtml(channel.name)}<br>
        Ticket ID: ${escapeHtml(ticket?.id || "N/A")}<br>
        Usuário: ${escapeHtml(ticket?.user_id || "N/A")}<br>
        Mensagens: ${messages.length}<br>
        Gerado em: ${new Date().toLocaleString("pt-BR")}
      </div>
    </section>
    ${rows || "<p>Nenhuma mensagem capturada.</p>"}
  </main>
</body>
</html>`;
}

async function createTicketTranscript(channel, ticket, config) {
  const messages = await fetchTicketMessages(channel);
  const html = buildTranscriptHtml({ channel, ticket, messages, config });
  return new AttachmentBuilder(Buffer.from(html, "utf8"), {
    name: `transcript-${channel.id}-${Date.now()}.html`
  });
}

async function sendTicketTranscript(channel, ticket, config) {
  const channelId = config.logChannels?.ticket || config.logChannels?.seguranca || config.logChannels?.sistema;
  if (!channelId) return null;

  const logChannel = await channel.client.channels.fetch(channelId).catch(() => null);
  if (!logChannel?.send) return null;

  const file = await createTicketTranscript(channel, ticket, config);
  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle("📄 Transcript de ticket")
    .setDescription(`Ticket encerrado: **#${channel.name}**`)
    .addFields(
      { name: "👤 Usuário", value: ticket?.user_id ? `<@${ticket.user_id}>` : "N/A", inline: true },
      { name: "📌 Tipo", value: ticket?.type || "N/A", inline: true },
      { name: "🆔 Ticket", value: String(ticket?.id || "N/A"), inline: true }
    )
    .setFooter({ text: `${config.botName} • Tickets` })
    .setTimestamp();

  return logChannel.send({ embeds: [embed], files: [file] }).catch(() => null);
}

module.exports = {
  createTicketTranscript,
  sendTicketTranscript
};
