const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require("discord.js");
const dotenv = require("dotenv");
const { loadConfig } = require("./utils/config");
const { startWebhookServer } = require("./utils/webhookServer");

dotenv.config();

const config = loadConfig();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = "1426968118684811448";

if (!token || !clientId) {
  throw new Error("Variaveis DISCORD_TOKEN e CLIENT_ID sao obrigatorias.");
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
client.once("clientReady", () => {
  startWebhookServer(client, config);
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

registerCommands()
  .then(() => console.log("Comandos registrados"))
  .catch((error) => console.error("Falha ao registrar comandos", error));

process.on("unhandledRejection", (error) => {
  console.error("Erro nao tratado", error);
});

client.login(token);