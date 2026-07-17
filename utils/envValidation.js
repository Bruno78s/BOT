const REQUIRED_ENV = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "GUILD_ID",
  "MERCADO_PAGO_ACCESS_TOKEN",
  "MERCADO_PAGO_WEBHOOK_SECRET",
  "MERCADO_PAGO_WEBHOOK_URL",
  "BZNX_SITE_URL",
  "BZNX_INTEGRATION_API_KEY",
  "DISCORD_GUILD_ID",
  "DISCORD_CUSTOMER_ROLE_ID"
];

const OPTIONAL_ENV = [
  "CLIENT_ROLE_ID",
  "WEBHOOK_PORT",
  "MERCADO_PAGO_PENDING_CHECK_INTERVAL_MS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SUCCESS_URL",
  "STRIPE_CANCEL_URL",
  "BOT_PRESENCE_MESSAGE",
  "BOT_PRESENCE_TYPE",
  "RECEIPT_CHANNEL_ID",
  "SEND_RECEIPT_DM",
  "AUTOMOD_ENABLED",
  "AUTOMOD_ANTI_LINKS",
  "AUTOMOD_ANTI_SPAM",
  "AUTOMOD_ANTI_CAPS",
  "AUTOMOD_IGNORE_STAFF",
  "AUTOMOD_BAD_WORDS",
  "AUTOMOD_LINK_WHITELIST",
  "MODERATION_ADMIN_ROLE_IDS",
  "MODERATION_MODERATOR_ROLE_IDS",
  "BACKUP_ENCRYPTION_KEY",
  "JWT_SECRET",
  "BOT_TIMEZONE",
  "TRUST_PROXY",
  "REGISTER_COMMANDS_ON_STARTUP"
];


function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !String(process.env[key] || "").trim());
  const warnings = [];

  if (process.env.DISCORD_CUSTOMER_ROLE_ID && process.env.CLIENT_ROLE_ID && process.env.DISCORD_CUSTOMER_ROLE_ID !== process.env.CLIENT_ROLE_ID) {
    warnings.push("DISCORD_CUSTOMER_ROLE_ID e CLIENT_ROLE_ID estao diferentes.");
  }

  const interval = Number(process.env.BZNX_CUSTOMER_ROLE_SYNC_INTERVAL_MS || 120000);
  if (!Number.isFinite(interval) || interval < 60000) {
    warnings.push("BZNX_CUSTOMER_ROLE_SYNC_INTERVAL_MS invalido. O bot usara 120000ms.");
  }

  const webhookUrl = process.env.MERCADO_PAGO_WEBHOOK_URL || "";
  if (webhookUrl && !webhookUrl.startsWith("https://")) {
    warnings.push("MERCADO_PAGO_WEBHOOK_URL nao usa HTTPS.");
  }

  const backupSecret = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET || "";
  if (backupSecret.length < 16) {
    throw new Error("BACKUP_ENCRYPTION_KEY ou JWT_SECRET deve ter pelo menos 16 caracteres.");
  }

  if (missing.length > 0) {
    throw new Error(`Variaveis obrigatorias ausentes no .env: ${missing.join(", ")}`);
  }

  console.log("[ENV] Variaveis obrigatorias carregadas.");
  for (const warning of warnings) {
    console.warn(`[ENV] Aviso: ${warning}`);
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
    required: REQUIRED_ENV.map((key) => ({ key, configured: !!process.env[key] })),
    optional: OPTIONAL_ENV.map((key) => ({ key, configured: !!process.env[key] }))
  };
}

module.exports = {
  REQUIRED_ENV,
  OPTIONAL_ENV,
  validateEnv
};
