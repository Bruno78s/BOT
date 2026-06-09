




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
const { logSystemEvent } = require("../utils/advancedLogger");
const { logSistema, logRelatorio } = require("../utils/channelLogger");
const { cacheGuildInvites } = require("../utils/invites");
const Dashboard = require("../utils/dashboard");
const ReportSystem = require("../utils/reports");
const StockPrediction = require("../utils/stockPrediction");
const AutoRestock = require("../utils/autoRestock");

module.exports = {
  name: "ready",
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
      await run("DELETE FROM logs WHERE created_at < ?", [limit]);
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
      
      // Verificar produtos com estoque zerado/baixo e notificar no relatorio
      const lowStockProducts = config.products.filter(p => p.stock === 0 || p.stock < 3);
      if (lowStockProducts.length > 0) {
        await logRelatorio(client, config);
        console.log(`[STOCK] ${lowStockProducts.length} produto(s) com estoque cr\u00edtico — relat\u00f3rio atualizado`);
      }

      // Executar restock automático se habilitado
      if (process.env.AUTO_RESTOCK_ENABLED === 'true') {
        const restockResult = await autoRestock.runAutoRestock();
        if (restockResult.restocked.length > 0) {
          await logRelatorio(client, config);
        }
      }
    });

    // Melhoria 13: Dashboard em Tempo Real - Atualizar a cada 2 minutos
    const dashboard = new Dashboard(config);
    setInterval(async () => {
      dashboard.clearCache();
    }, 120000); // Limpar cache a cada 2 minutos

    setInterval(() => {
      ensureStatsPanel(client, config).catch(() => null);
    }, 30000);

    // Expirar pagamentos PIX pendentes a cada 5 minutos (expiram em 30 min)
    const PIX_EXPIRY_MS = 30 * 60 * 1000;
    setInterval(async () => {
      try {
        const expiredPayments = await all(
          "SELECT * FROM payments WHERE status = 'pending' AND created_at < ?",
          [Date.now() - PIX_EXPIRY_MS]
        );
        for (const payment of expiredPayments) {
          await run("UPDATE payments SET status = 'expired', updated_at = ? WHERE id = ?", [Date.now(), payment.id]);
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
                .setLabel("Gerar Novo PIX")
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
                    "> Seu PIX expirou sem confirma\u00e7\u00e3o de pagamento.",
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
    await ensureProductPanels(client, config);

    const presenceMessage = process.env.BOT_PRESENCE_MESSAGE || config.botPresence?.message || `a loja ${config.botName}`;
    const presenceTypeKey = process.env.BOT_PRESENCE_TYPE || config.botPresence?.type || "WATCHING";
    const presenceType = ActivityType[presenceTypeKey] || ActivityType.Watching;

    try {
      await client.user.setPresence({
        activities: [{ name: presenceMessage, type: presenceType }],
        status: "online"
      });
    } catch (err) {
      // ignore presence errors
    }

    setInterval(async () => {
      try {
        await client.user.setPresence({
          activities: [{ name: presenceMessage, type: presenceType }],
          status: "online"
        });
      } catch (err) {
        // ignore presence errors
      }
    }, 10 * 60 * 1000);

    await logSistema(client, config, "Bot Iniciado", {
      description: [
        `> 🤖 **Bot:** ${config.botName}`,
        `> 👤 **Usuário:** ${client.user.tag}`,
        `> 🌐 **Servidores:** ${client.guilds.cache.size}`,
        `> 📅 **Iniciado em:** <t:${Math.floor(Date.now()/1000)}:F>`,
        "",
        "> ✅ Todos os sistemas foram iniciados com sucesso.",
      ].join("\n"),
      fields: [
        { name: "🔖 Versão Node", value: process.version, inline: true },
        { name: "⏱️ Uptime", value: `0s`, inline: true },
        { name: "📦 Produtos", value: `${config.products?.length || 0} cadastrados`, inline: true },
      ]
    });
    await logRelatorio(client, config);

    console.log(`${config.botName} conectado como ${client.user.tag}`);
  }
};
