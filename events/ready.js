




const cron = require("node-cron");
const { initDb, run } = require("../database/db");
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
const { cacheGuildInvites } = require("../utils/invites");
const { syncToSupabase } = require("../utils/syncToSupabase");
const { isSupabaseEnabled } = require("../utils/supabase");

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

    setInterval(() => {
      ensureStatsPanel(client, config).catch(() => null);
    }, 30000);

    await joinConfiguredVoice(client, config);
    keepAlive(client, config);
    await ensureTicketPanel(client, config);
    await ensureVerifyPanel(client, config);
    await ensureWelcomePanel(client, config);
    await ensureStatsPanel(client, config);
    await ensureTermsPanel(client, config);
    await ensureRulesPanel(client, config);
    await ensureProductPanels(client, config);

    await logSystemEvent(
      client,
      config,
      "Bot Iniciado",
      {
        description: `Bot ${config.botName} iniciado com sucesso como ${client.user.tag}.`,
        fields: [
          { name: "Bot", value: `${config.botName}`, inline: true },
          { name: "Usuário", value: client.user.tag, inline: true },
          { name: "Servidores", value: client.guilds.cache.size.toString(), inline: true }
        ]
      }
    );

    console.log(`${config.botName} conectado como ${client.user.tag}`);
  }
};
