




const cron = require("node-cron");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require("discord.js");
const { run, all } = require("../database/db");
const { backupDatabase, pruneBackups, backupDatabaseEncrypted } = require("../utils/backup");
const { joinConfiguredVoice, keepAlive } = require("../utils/voice");
const { ensureTicketPanel } = require("../utils/panel");
const { ensureVerifyPanel } = require("../utils/verifyPanel");
const { ensureWelcomePanel } = require("../utils/welcomePanel");
const { ensureStatsPanel } = require("../utils/statsPanel");
const { ensureTermsPanel } = require("../utils/termsPanel");
const { ensureRulesPanel } = require("../utils/rulesPanel");
const { ensureProductPanels } = require("../utils/productPanels");
const { ensureInviteShowcasePanel } = require("../utils/inviteShowcasePanel");
const { logSystemEvent } = require("../utils/advancedLogger");
const { logSistema, logRelatorio } = require("../utils/channelLogger");
const { cacheGuildInvites, validatePendingInvites } = require("../utils/invites");
const Dashboard = require("../utils/dashboard");
const ReportSystem = require("../utils/reports");
const StockPrediction = require("../utils/stockPrediction");
const AutoRestock = require("../utils/autoRestock");
const { startCustomerRoleSync } = require("../utils/customerRoleSync");
const { startStatusPanel } = require("../utils/statusPanel");
const { processMercadoPagoPayment } = require("../utils/webhookServer");
const { startTicketAutoClose } = require("../utils/ticketAutomation");
const { startCartAbandonment } = require("../utils/cartAbandonment");
const { recordFailedPayment } = require("../utils/customers");

const DEFAULT_PRESENCE_ACTIVITIES = [
  "CUSTOM:ENTREGAS ON",
  "CUSTOM:LOJA ONLINE",
  "CUSTOM:MELHORES PRODUTOS AQUI",
  "CUSTOM:BOTS E SITES SOB MEDIDA",
  "CUSTOM:ATENDIMENTO BZNX STORE"
].join(";");

function resolvePresenceType(typeKey) {
  const normalized = String(typeKey || "").trim().toLowerCase();
  const aliases = {
    playing: "Playing",
    jogando: "Playing",
    streaming: "Streaming",
    listening: "Listening",
    ouvindo: "Listening",
    watching: "Watching",
    assistindo: "Watching",
    custom: "Custom",
    competing: "Competing"
  };

  return ActivityType[aliases[normalized] || typeKey] || ActivityType.Watching;
}

function buildPresenceActivity(name, type) {
  if (type === ActivityType.Custom) {
    return {
      name: "BznX Store",
      state: name,
      type
    };
  }

  return { name, type };
}

function getPresenceActivities(config) {
  const rawList = process.env.BOT_PRESENCE_ACTIVITIES || DEFAULT_PRESENCE_ACTIVITIES;
  const items = rawList
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf(":");
      if (separatorIndex === -1) {
        return buildPresenceActivity(item, ActivityType.Custom);
      }

      const typeKey = item.slice(0, separatorIndex).trim();
      const name = item.slice(separatorIndex + 1).trim();
      return name ? buildPresenceActivity(name, resolvePresenceType(typeKey)) : null;
    })
    .filter(Boolean);

  if (items.length > 0) return items;

  const presenceMessage = process.env.BOT_PRESENCE_MESSAGE || config.botPresence?.message || "LOJA ONLINE";
  const presenceTypeKey = process.env.BOT_PRESENCE_TYPE || config.botPresence?.type || "CUSTOM";
  return [buildPresenceActivity(presenceMessage, resolvePresenceType(presenceTypeKey))];
}

async function applyPresence(client, activities, index = 0) {
  const activity = activities[index % activities.length];
  await client.user.setPresence({
    activities: [activity],
    status: "online"
  });
}

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client, config) {
    await Promise.all(client.guilds.cache.map((guild) => cacheGuildInvites(guild).catch(() => null)));

    cron.schedule("0 3 * * *", async () => {
      await backupDatabase();
      await backupDatabaseEncrypted(); // Melhoria 12: Backup criptografado
      pruneBackups(config.limits.logRetentionDays);
    });

    cron.schedule("0 4 * * *", async () => {
      const limit = Date.now() - config.limits.logRetentionDays * 24 * 60 * 60 * 1000;
      run("DELETE FROM logs WHERE created_at < ?", [limit]);
    });

    // Melhoria 14: Relatórios Automáticos
    const reports = new ReportSystem(config);
    
    // Relatório diário às 9h
    cron.schedule("0 9 * * *", async () => {
      await logRelatorio(client, config);
      console.log("[REPORTS] Relatório diário enviado");
    });

    // Relatório de estoque às 8h (atualiza o mesmo)
    cron.schedule("0 8 * * *", async () => {
      await logRelatorio(client, config);
      console.log("[REPORTS] Relatório de estoque enviado");
    });

    // Melhoria 15 & 16: Previsão de Estoque e Restock Automático
    const autoRestock = new AutoRestock(config, client);
    
    // Verificar estoque a cada 6 horas
    cron.schedule("0 */6 * * *", async () => {
      const prediction = new StockPrediction(config);
      const report = await prediction.generatePredictionReport();
      
      console.log(`[STOCK] Previsão gerada: ${report.alert.summary.critical} críticos, ${report.alert.summary.high} altos`);
      
      // Verificar produtos com estoque zerado/baixo e notificar no relatório
      const lowStockProducts = config.products.filter(p => p.stock === 0 || p.stock < 3);
      if (lowStockProducts.length > 0) {
        await logRelatorio(client, config);
        console.log(`[STOCK] ${lowStockProducts.length} produto(s) com estoque crítico - relatório atualizado`);
      }

      // Executar restock automático se habilitado
      if (process.env.AUTO_RESTOCK_ENABLED === 'true') {
        const restockResult = await autoRestock.runAutoRestock();
        if (restockResult.restocked.length > 0) {
          await ensureProductPanels(client, config).catch((err) =>
            console.log("[STOCK] Erro ao atualizar painéis após restock:", err.message)
          );
          await logRelatorio(client, config);
        }
      }
    });

    // Melhoria 13: Dashboard em Tempo Real - Atualizar a cada 2 minutos
    const dashboard = new Dashboard(config);
    setInterval(async () => {
      dashboard.clearCache();
    }, 120000); // Limpar cache a cada 2 minutos

    startCustomerRoleSync(client);
    startStatusPanel(client, config);
    startTicketAutoClose(client, config);
    startCartAbandonment(client, config);

    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const validated = await validatePendingInvites(guild, config).catch((error) => {
          console.error("[INVITES] Erro ao validar convites pendentes:", error.message);
          return [];
        });
        if (validated.length > 0) {
          console.log(`[INVITES] ${validated.length} convite(s) validado(s) no servidor ${guild.name}.`);
        }
      }
    }, 60 * 1000);

    setInterval(() => {
      ensureStatsPanel(client, config).catch(() => null);
    }, 30000);

    // Expirar pagamentos PIX pendentes a cada 5 minutos (expiram em 15 min)
    const PIX_EXPIRY_MS = 15 * 60 * 1000;
    setInterval(async () => {
      try {
        const expiredPayments = all(
          "SELECT * FROM payments WHERE provider = 'mercadopago' AND status = 'pending' AND created_at < ?",
          [Date.now() - PIX_EXPIRY_MS]
        );
        for (const payment of expiredPayments) {
          if (payment.provider === "mercadopago" && payment.provider_payment_id) {
            const confirmed = await processMercadoPagoPayment(client, config, payment.provider_payment_id, "expiry-check");
            if (confirmed) {
              console.log(`[PIX] Pagamento #${payment.id} aprovado durante checagem de expiracao.`);
              continue;
            }
          }

          run("UPDATE payments SET status = 'expired', updated_at = ? WHERE id = ?", [Date.now(), payment.id]);
          recordFailedPayment(payment);
          const channel = await client.channels.fetch(payment.channel_id).catch(() => null);
          if (channel?.send) {
            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            if (messages) {
              const botMessages = messages.filter(m => m.author.id === client.user.id);
              await channel.bulkDelete(botMessages).catch(() => null);
            }

            const expiredRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("select_payment_gateway_menu")
                .setLabel("Escolher pagamento")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId("ticket_cancel_purchase")
                .setLabel("Cancelar Compra")
                .setStyle(ButtonStyle.Danger)
            );

            await channel.send({
              content: `<@${payment.user_id}>`,
              embeds: [
                new EmbedBuilder()
                  .setColor(0xe74c3c)
                  .setTitle("\u23F0 PIX Expirado")
                  .setDescription([
                    "> Seu PIX expirou após **15m 00s** sem confirmação de pagamento.",
                    "> Clique abaixo para gerar um novo ou cancelar a compra.",
                  ].join("\n"))
                  .setFooter({ text: `${config.botName} \u2022 Pagamento Expirado` })
                  .setTimestamp()
              ],
              components: [expiredRow]
            }).catch(() => null);
          }
          console.log(`[PIX] Pagamento #${payment.id} expirado (canal: ${payment.channel_id})`);
        }
      } catch (err) {
        console.error("[PIX EXPIRY] Erro:", err);
      }
    }, 5 * 60 * 1000);

    await joinConfiguredVoice(client, config);
    keepAlive(client, config);
    await ensureTicketPanel(client, config);
    await ensureVerifyPanel(client, config);
    await ensureWelcomePanel(client, config);
    await ensureStatsPanel(client, config);
    await ensureTermsPanel(client, config);
    await ensureRulesPanel(client, config);
    await ensureInviteShowcasePanel(client, config);
    await ensureProductPanels(client, config);

    const presenceActivities = getPresenceActivities(config);
    const presenceRotateMs = Math.max(Number(process.env.BOT_PRESENCE_ROTATE_INTERVAL_MS || 60000), 30000);
    let presenceIndex = 0;

    try {
      await applyPresence(client, presenceActivities, presenceIndex);
    } catch (err) {
      // ignore presence errors
    }

    setInterval(async () => {
      try {
        presenceIndex++;
        await applyPresence(client, getPresenceActivities(config), presenceIndex);
      } catch (err) {
        // ignore presence errors
      }
    }, presenceRotateMs);

    await logSistema(client, config, "Bot Iniciado", {
      description: [
        `> 🤖 **Bot:** ${config.botName}`,
        `> 👤 **Usuário:** ${client.user.tag}`,
        `> 📊 **Servidores:** ${client.guilds.cache.size}`,
        `> ⏰ **Iniciado em:** <t:${Math.floor(Date.now()/1000)}:F>`,
        "",
        "> ✅ Todos os sistemas foram iniciados com sucesso.",
      ].join("\n"),
      fields: [
        { name: "📦 Versão Node", value: process.version, inline: true },
        { name: "⏱️ Uptime", value: `0s`, inline: true },
        { name: "🛍️ Produtos", value: `${config.products?.length || 0} cadastrados`, inline: true },
      ]
    });
    await logRelatorio(client, config);

    console.log(`${config.botName} conectado como ${client.user.tag}`);
  }
};
