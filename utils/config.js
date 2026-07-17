const fs = require("fs");
const path = require("path");
const { hydrateInventory } = require("./inventory");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const PRIVATE_CONFIG_PATH = path.join(__dirname, "..", "config.private.json");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function readPrivateConfig() {
  const value = readJson(PRIVATE_CONFIG_PATH, { products: {} });
  if (!value || typeof value !== "object") return { products: {} };
  if (!value.products || typeof value.products !== "object") value.products = {};
  return value;
}

function mergePrivateConfig(publicConfig) {
  const privateConfig = readPrivateConfig();
  const merged = JSON.parse(JSON.stringify(publicConfig));
  merged.products = (merged.products || []).map((product) => {
    const privateProduct = privateConfig.products[product.id] || {};
    const stock = Number(product.initialStock ?? product.stock ?? 0);
    const runtimeProduct = { ...product, stock: Number.isInteger(stock) && stock >= 0 ? stock : 0 };
    if (privateProduct.deliveryUrl) runtimeProduct.deliveryUrl = privateProduct.deliveryUrl;
    return runtimeProduct;
  });
  return merged;
}

function toPublicConfig(runtimeConfig) {
  const publicConfig = JSON.parse(JSON.stringify(runtimeConfig));
  publicConfig.products = (publicConfig.products || []).map((product) => {
    const copy = { ...product };
    delete copy.deliveryUrl;
    if (copy.initialStock === undefined) copy.initialStock = Number(copy.stock || 0);
    delete copy.stock;
    return copy;
  });
  return publicConfig;
}

function toPrivateConfig(runtimeConfig) {
  const products = {};
  for (const product of runtimeConfig.products || []) {
    if (product.deliveryUrl) products[product.id] = { deliveryUrl: product.deliveryUrl };
  }
  return { products };
}

function readConfig() {
  const publicConfig = readJson(CONFIG_PATH);
  if (!publicConfig) throw new Error("config.json não encontrado.");
  const config = mergePrivateConfig(publicConfig);
  validateConfig(config);
  return hydrateInventory(config);
}

function loadConfig() {
  return readConfig();
}

function writeConfig(config) {
  validateConfig(config);
  writeJsonAtomic(PRIVATE_CONFIG_PATH, toPrivateConfig(config));
  writeJsonAtomic(CONFIG_PATH, toPublicConfig(config));
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

  if (config.booster && (!config.booster.roleId || !config.booster.announceChannelId)) {
    throw new Error("config.json invalido: booster deve conter roleId e announceChannelId");
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
      throw new Error(`config.json invalido: produto incompleto (id: ${product.id || "desconhecido"})`);
    }
    if (!Number.isInteger(Number(product.stock)) || Number(product.stock) < 0) {
      throw new Error(`config.json invalido: estoque inválido (id: ${product.id})`);
    }
  }
}

module.exports = {
  CONFIG_PATH,
  PRIVATE_CONFIG_PATH,
  loadConfig,
  readConfig,
  readPrivateConfig,
  validateConfig,
  writeConfig
};