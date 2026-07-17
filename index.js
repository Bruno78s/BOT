const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require("discord.js");
const dotenv = require("dotenv");
const { loadConfig } = require("./utils/config");
const { startWebhookServer } = require("./utils/webhookServer");
const { backupDatabaseEncrypted, importData } = require("./utils/backup");
const { validateEnv } = require("./utils/envValidation");
const { hydrateInventory } = require("./utils/inventory");

dotenv.config();
validateEnv();

const config = loadConfig();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error("Variaveis DISCORD_TOKEN, CLIENT_ID e GUILD_ID sao obrigatorias.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
client.once("clientReady", async () => {
  const imported = importData();
  if (imported.success) {
    hydrateInventory(config);
    console.log(`[BACKUP] Recuperação aplicada: ${imported.restoredRows || 0} registro(s) em ${imported.restoredTables || 0} tabela(s).`);
  }
  startWebhookServer(client, config);
});

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
const commandsData = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if (command?.data) {
    const commandName = command.data.name;
    client.commands.set(commandName, command);
    commandsData.push(command.data.toJSON());
  }
}

const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  const executeEvent = (...args) => Promise.resolve(event.execute(...args, config)).catch((error) => {
    console.error(`[EVENT:${event.name}] Falha não tratada:`, error);
  });
  if (event.once) client.once(event.name, executeEvent);
  else client.on(event.name, executeEvent);
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  const commandList = commandsData.map((command) => `/${command.name}`).join(", ");
  console.log(`Registrando comandos atuais: ${commandList}`);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandsData });
}

async function shutdownWithBackup(exitCode = 0) {
  console.log("[BACKUP] Exportando dados antes de desligar...");
  await backupDatabaseEncrypted().catch((error) => {
    console.error("[BACKUP] Falha ao exportar dados:", error);
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  process.exit(exitCode);
}

async function start() {
  try {
    if (process.env.REGISTER_COMMANDS_ON_STARTUP === "true") {
      await registerCommands();
      console.log("Comandos registrados durante a inicialização.");
    }
    await client.login(token);
  } catch (error) {
    if (error?.code === "TokenInvalid" || error?.status === 401) {
      console.error("[ERRO] Token do Discord invalido. Gere um novo token no Discord Developer Portal e atualize DISCORD_TOKEN no .env.");
    } else {
      console.error("[ERRO] Falha ao iniciar o bot:", error);
    }
    await shutdownWithBackup(1);
  }
}

process.on("unhandledRejection", (error) => {
  console.error("[ERRO] Rejeição não tratada:", error);
});

process.on("uncaughtException", async (error) => {
  console.error("[ERRO] Exceção não capturada:", error);
  await shutdownWithBackup(1);
});

// Exportar dados antes de desligar
process.on("SIGINT", async () => {
  await shutdownWithBackup(0);
});

process.on("SIGTERM", async () => {
  await shutdownWithBackup(0);
});

start();
