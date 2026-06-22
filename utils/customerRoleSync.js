const axios = require("axios");

const DEFAULT_SITE_URL = "https://bznx-store.duckdns.org";
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const syncState = {
  enabled: false,
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastPendingCount: 0,
  lastProcessedCount: 0,
  lastSuccessCount: 0,
  lastErrorCount: 0
};

function getConfig() {
  const siteUrl = (process.env.BZNX_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  const apiKey = process.env.BZNX_INTEGRATION_API_KEY;
  const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;
  const customerRoleId = process.env.DISCORD_CUSTOMER_ROLE_ID || process.env.CLIENT_ROLE_ID;
  const intervalMs = Number(process.env.BZNX_CUSTOMER_ROLE_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS);

  return {
    siteUrl,
    apiKey,
    guildId,
    customerRoleId,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 60000 ? intervalMs : DEFAULT_INTERVAL_MS
  };
}

function normalizeError(error) {
  if (error?.response) {
    return `HTTP ${error.response.status}: ${JSON.stringify(error.response.data).slice(0, 300)}`;
  }

  return error?.message || String(error);
}

async function sendResult(http, siteUrl, item, success, error = null) {
  const body = {
    userId: item.userId,
    discordId: item.discordId || null,
    success
  };

  if (!success) body.error = error || "Erro desconhecido";

  await http.post(`${siteUrl}/api/integrations/discord/customer-role/result`, body);
}

async function processItem(client, guild, roleId, http, siteUrl, item) {
  if (!item?.userId) {
    throw new Error("Item sem userId");
  }

  if (!item.discordId) {
    await sendResult(http, siteUrl, item, false, "Cliente sem discordId vinculado");
    console.log(`[CUSTOMER ROLE] Ignorado sem discordId: userId=${item.userId} email=${item.email || "n/a"}`);
    return false;
  }

  try {
    const member = await guild.members.fetch(item.discordId);
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      throw new Error(`Cargo Cliente nao encontrado: ${roleId}`);
    }

    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, "Sincronizacao BznX Store: cliente confirmado no site");
      console.log(`[CUSTOMER ROLE] Cargo Cliente adicionado para ${member.user.tag} (${item.discordId})`);
    } else {
      console.log(`[CUSTOMER ROLE] Membro ja possui cargo Cliente: ${member.user.tag} (${item.discordId})`);
    }

    await sendResult(http, siteUrl, item, true);
    return true;
  } catch (error) {
    const message = normalizeError(error);
    await sendResult(http, siteUrl, item, false, message).catch((resultError) => {
      console.error(`[CUSTOMER ROLE] Falha ao reportar erro para userId=${item.userId}:`, normalizeError(resultError));
    });
    console.error(`[CUSTOMER ROLE] Erro ao processar userId=${item.userId} discordId=${item.discordId}: ${message}`);
    return false;
  }
}

async function runCustomerRoleSync(client) {
  const { siteUrl, apiKey, guildId, customerRoleId } = getConfig();
  syncState.lastRunAt = Date.now();

  if (!apiKey || !guildId || !customerRoleId) {
    syncState.enabled = false;
    syncState.lastError = "Variaveis de integracao ausentes";
    console.log("[CUSTOMER ROLE] Sincronizacao desativada: configure BZNX_INTEGRATION_API_KEY, DISCORD_GUILD_ID e DISCORD_CUSTOMER_ROLE_ID.");
    return;
  }
  syncState.enabled = true;

  const http = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "x-bznx-bot-key": apiKey,
      "Content-Type": "application/json"
    }
  });

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      syncState.lastError = `Servidor Discord nao encontrado: ${guildId}`;
      console.error(`[CUSTOMER ROLE] Servidor Discord nao encontrado: ${guildId}`);
      return;
    }

    const response = await http.get(`${siteUrl}/api/integrations/discord/customer-role/pending`, {
      params: { limit: 50 }
    });

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    syncState.lastPendingCount = items.length;
    syncState.lastProcessedCount = 0;
    syncState.lastSuccessCount = 0;
    syncState.lastErrorCount = 0;
    if (items.length === 0) {
      syncState.lastSuccessAt = Date.now();
      syncState.lastError = null;
      console.log("[CUSTOMER ROLE] Nenhum cliente pendente para sincronizar.");
      return;
    }

    console.log(`[CUSTOMER ROLE] ${items.length} cliente(s) pendente(s) recebidos do site.`);
    for (const item of items) {
      const ok = await processItem(client, guild, customerRoleId, http, siteUrl, item);
      syncState.lastProcessedCount++;
      if (ok) syncState.lastSuccessCount++;
      else syncState.lastErrorCount++;
    }
    syncState.lastSuccessAt = Date.now();
    syncState.lastError = syncState.lastErrorCount ? `${syncState.lastErrorCount} item(ns) com erro no ultimo ciclo` : null;
  } catch (error) {
    syncState.lastError = normalizeError(error);
    console.error("[CUSTOMER ROLE] Erro na sincronizacao:", syncState.lastError);
  }
}

function startCustomerRoleSync(client) {
  const { intervalMs } = getConfig();
  let running = false;

  async function tick() {
    if (running) {
      console.log("[CUSTOMER ROLE] Sincronizacao anterior ainda em andamento, pulando ciclo.");
      return;
    }

    running = true;
    syncState.running = true;
    try {
      await runCustomerRoleSync(client);
    } finally {
      running = false;
      syncState.running = false;
    }
  }

  tick().catch((error) => {
    console.error("[CUSTOMER ROLE] Erro inesperado no primeiro ciclo:", normalizeError(error));
  });

  const timer = setInterval(() => {
    tick().catch((error) => {
      console.error("[CUSTOMER ROLE] Erro inesperado no ciclo:", normalizeError(error));
    });
  }, intervalMs);

  if (timer.unref) timer.unref();
  console.log(`[CUSTOMER ROLE] Sincronizacao iniciada a cada ${Math.round(intervalMs / 1000)}s.`);

  return timer;
}

module.exports = {
  getCustomerRoleSyncStatus: () => ({ ...syncState }),
  runCustomerRoleSync,
  startCustomerRoleSync
};
