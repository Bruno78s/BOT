const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const data = JSON.parse(raw);
  validateConfig(data);
  return data;
}

function validateConfig(config) {
  const required = ["botName", "colors", "limits", "keywords", "products"];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      throw new Error(`config.json invalido: campo ausente ${key}`);
    }
  }

  if (!config.limits.ticketCooldownMinutes || !config.limits.maxOpenTicketsPerGuild) {
    throw new Error("config.json invalido: limites obrigatorios ausentes");
  }

  if (!Array.isArray(config.products) || config.products.length === 0) {
    throw new Error("config.json invalido: products deve conter itens");
  }

  if (!config.verification || !config.verification.welcomeChannelId || !config.verification.channelId || !config.verification.unverifiedRoleId || !config.verification.verifiedRoleId) {
    throw new Error("config.json invalido: verification incompleto");
  }

  if (!config.notifications || !config.notifications.botSalesChannelId || !config.notifications.voiceChannelId) {
    throw new Error("config.json invalido: notifications incompleto");
  }

  if (!config.statsChannelId) {
    throw new Error("config.json invalido: statsChannelId obrigatorio");
  }

  if (!config.salesCategoryId || !config.ticketCategoryId) {
    throw new Error("config.json invalido: salesCategoryId e ticketCategoryId obrigatorios");
  }

  if (!config.logChannels || Object.keys(config.logChannels).length === 0) {
    throw new Error("config.json invalido: logChannels obrigatorio");
  }

  if (config.clientRoleId && typeof config.clientRoleId !== "string") {
    throw new Error("config.json invalido: clientRoleId deve ser uma string");
  }

  if (config.booster) {
    if (!config.booster.roleId || !config.booster.announceChannelId) {
      throw new Error("config.json invalido: booster deve conter roleId e announceChannelId");
    }
  }

  if (config.botPresence) {
    if (!config.botPresence.message || typeof config.botPresence.message !== "string") {
      throw new Error("config.json invalido: botPresence.message deve ser uma string");
    }
    if (!config.botPresence.type || typeof config.botPresence.type !== "string") {
      throw new Error("config.json invalido: botPresence.type deve ser uma string");
    }
  }

  for (const product of config.products) {
    if (!product.id || !product.name || !product.category || !product.tier || !product.channelId || product.price === undefined || product.stock === undefined) {
      throw new Error(`config.json invalido: produto incompleto (id: ${product.id || 'desconhecido'})`);
    }
  }
}

module.exports = {
  loadConfig,
  validateConfig
};
