const { EmbedBuilder } = require("discord.js");
const { run } = require("../database/db");

async function logToDb(guildId, level, message, meta = null) {
  const createdAt = Date.now();
  const metaText = meta ? JSON.stringify(meta) : null;
  await run(
    "INSERT INTO logs (guild_id, level, message, meta, created_at) VALUES (?, ?, ?, ?, ?)",
    [guildId, level, message, metaText, createdAt]
  );
}

function resolveLogColor(config, level) {
  if (level === "success") return config.colors.success;
  if (level === "warning") return config.colors.warning;
  if (level === "danger" || level === "error") return config.colors.danger;
  return config.colors.primary;
}

function buildLogEmbed(config, level, message, options = {}) {
  const title = options.title || `${config.botName} | Logs`;
  const embed = new EmbedBuilder()
    .setColor(resolveLogColor(config, level))
    .setTitle(title)
    .setTimestamp();

  if (message) embed.setDescription(message);
  if (options.fields && options.fields.length) embed.addFields(options.fields);
  if (options.footer) embed.setFooter({ text: options.footer });

  return embed;
}

async function logToChannel(channel, config, level, message, options = {}) {
  if (!channel || !channel.send) return;
  const embed = buildLogEmbed(config, level, message, options);
  await channel.send({ embeds: [embed] });
}

module.exports = {
  logToDb,
  logToChannel
};
