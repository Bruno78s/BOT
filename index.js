const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require("discord.js");
const dotenv = require("dotenv");
const { loadConfig } = require("./utils/config");
const { startWebhookServer } = require("./utils/webhookServer");
const { exportData, importData } = require("./utils/backup");
const { validateEnv } = require("./utils/envValidation");

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
  startWebhookServer(client, config);
  
  // Importar dados salvos após reiniciar
  const imported = importData();
  if (imported.success) {
    console.log(`[BACKUP] Dados importados: ${imported.data.invites?.length || 0} invites, ${imported.data.pendingPayments?.length || 0} pagamentos pendentes`);
  }
});

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
const commandsData = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if (command?.data) {
    client.commands.set(command.data.name, command);
    commandsData.push(command.data.toJSON());
  }
}

const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, config));
  } else {
    client.on(event.name, (...args) => event.execute(...args, config));
  }
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  console.log("Limpando comandos antigos...");
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
  console.log("Registrando comandos atuais...");
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandsData });
}

async function shutdownWithBackup(exitCode = 0) {
  console.log("[BACKUP] Exportando dados antes de desligar...");
  await exportData().catch((error) => {
    console.error("[BACKUP] Falha ao exportar dados:", error);
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  process.exit(exitCode);
}

async function start() {
  try {
    await registerCommands();
    console.log("Comandos registrados");
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
