const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { REST, Routes } = require("discord.js");

dotenv.config();
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
if (!token || !clientId || !guildId) {
  throw new Error("DISCORD_TOKEN, CLIENT_ID e GUILD_ID são obrigatórios.");
}

const commandsPath = path.join(__dirname, "..", "commands");
const body = fs.readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"))
  .map((file) => require(path.join(commandsPath, file)))
  .filter((command) => command?.data)
  .map((command) => command.data.toJSON());

(async () => {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log(`Comandos publicados no servidor: ${body.map((command) => `/${command.name}`).join(", ")}`);
})().catch((error) => {
  console.error("Falha ao publicar comandos:", error);
  process.exitCode = 1;
});