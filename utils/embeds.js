const { EmbedBuilder } = require("discord.js");

const ICONS = {
  info: "??",
  success: "?",
  warning: "??",
  danger: "?"
};

function baseEmbed(color, title, description, icon = null) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTimestamp();
  
  if (title) embed.setTitle(icon ? `${icon} ${title}` : title);
  if (description) embed.setDescription(description);
  
  return embed;
}

function infoEmbed(config, title, description) {
  return baseEmbed(config.colors.primary, title, description, ICONS.info);
}

function successEmbed(config, title, description) {
  return baseEmbed(config.colors.success, title, description, ICONS.success);
}

function warningEmbed(config, title, description) {
  return baseEmbed(config.colors.warning, title, description, ICONS.warning);
}

function dangerEmbed(config, title, description) {
  return baseEmbed(config.colors.danger, title, description, ICONS.danger);
}

function loadingEmbed(config, title = "Processando...", description = "Aguarde um momento.") {
  return baseEmbed(config.colors.primary, title, description, "?");
}

module.exports = {
  infoEmbed,
  successEmbed,
  warningEmbed,
  dangerEmbed,
  loadingEmbed,
  baseEmbed
};
