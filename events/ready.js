




const cron = require("node-cron");
const { EmbedBuilder } = require("discord.js");
const { initDb, run, all } = require("../database/db");
const { backupDatabase, pruneBackups } = require("../utils/backup");
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
const { syncToSupabase } = require("../utils/syncToSupabase");
const { isSupabaseEnabled } = require("../utils/supabase");
const { backupDatabaseEncrypted } = require("../utils/backup");
const Dashboard = require("../utils/dashboard");
const ReportSystem = require("../utils/reports");
const StockPrediction = require("../utils/stockPrediction");
const AutoRestock = require("../utils/autoRestock");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client, config) {
    await initDb();
    await run("CREATE TABLE IF NOT EXISTS panel_messages (guild_id TEXT NOT NULL, type TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, type))").catch(() => null);
    await run("ALTER TABLE tickets ADD COLUMN terms_accepted_at INTEGER").catch(() => null);
    await run("ALTER TABLE tickets ADD COLUMN terms_snapshot TEXT").catch(() => null);
    await Promise.all(client.guilds.cache.map((guild) => cacheGuildInvites(guild).catch(() => null)));

    cron.schedule("0 3 * * *", async () => {
      backupDatabase();
      backupDatabaseEncrypted(); // Melhoria 12: Backup criptografado
      pruneBackups(config.limits.logRetentionDays);
    });

    // Sincronizar com Supabase a cada 5 minutos
    if (isSupabaseEnabled()) {
      cron.schedule("*/5 * * * *", async () => {
        const result = await syncToSupabase();
        if (result.success) {
          console.log(`[SYNC] ${result.message}`);
        } else {
          console.log(`[SYNC] ${result.message}`);
        }
      });
      console.log("[SYNC] Sincronização com Supabase ativada (a cada 5 minutos)");
    }

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

    // Expirar pagamentos PIX pendentes a cada 15 minutos (expiram em 30 min)
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
            await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xe74c3c)
                  .setTitle("\u23F0 PIX Expirado")
                  .setDescription([
                    "> Seu PIX expirou sem confirma\u00e7\u00e3o de pagamento.",
                    "> Use o bot\u00e3o abaixo para gerar um novo, se desejar.",
                  ].join("\n"))
                  .setFooter({ text: `${config.botName} \u2022 Pagamento expirado` })
                  .setTimestamp()
              ]
            }).catch(() => null);
          }
          console.log(`[PIX] Pagamento #${payment.id} expirado (canal: ${payment.channel_id})`);
        }
      } catch (err) {
        console.error("[PIX EXPIRY] Erro:", err);
      }
    }, 15 * 60 * 1000);

    await joinConfiguredVoice(client, config);
    keepAlive(client, config);
    await ensureTicketPanel(client, config);
    await ensureVerifyPanel(client, config);
    await ensureWelcomePanel(client, config);
    await ensureStatsPanel(client, config);
    await ensureTermsPanel(client, config);
    await ensureRulesPanel(client, config);
    await ensureProductPanels(client, config);

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
