const { dangerEmbed } = require("../utils/embeds");
const { getSettings } = require("../utils/settings");
const { isAdmin } = require("../utils/permissions");

const ADMIN_BUTTON_IDS = new Set([
  "admin_main_back", "admin_products_back", "admin_invites", "start_config",
  "admin_edit_channels", "admin_status_refresh", "admin_customer_sync", "admin_env_check",
  "admin_export_sales_csv", "admin_health_view", "admin_sync_history", "admin_sales_toggle",
  "admin_automod_config", "admin_mod_permissions", "admin_customer_lookup",
  "admin_customers_export", "admin_strikes_export", "admin_presence_edit",
  "admin_invites_view_user", "admin_invites_detailed", "admin_invites_set",
  "admin_restart_bot", "admin_restart_cancel", "admin_restart_confirm", "add_coupon"
]);
const ADMIN_BUTTON_PREFIXES = [
  "edit_product_price_", "edit_product_delivery_", "delete_product_", "toggle_coupon_",
  "delete_coupon_", "payment_mark_", "payment_customer_history_"
];
const ADMIN_MODAL_IDS = new Set([
  "initial_config_modal", "admin_invites_set_modal", "admin_presence_modal",
  "admin_automod_modal", "admin_mod_permissions_modal", "admin_customer_lookup_modal",
  "add_product_modal", "admin_channels_modal"
]);
const ADMIN_MODAL_PREFIXES = ["edit_delivery_modal_", "edit_product_modal_", "create_coupon_modal"];

function matches(customId, exactIds, prefixes) {
  return exactIds.has(customId) || prefixes.some((prefix) => customId.startsWith(prefix));
}

function isAdminButtonInteraction(customId) {
  return matches(customId, ADMIN_BUTTON_IDS, ADMIN_BUTTON_PREFIXES);
}

function isAdminModalInteraction(customId) {
  return matches(customId, ADMIN_MODAL_IDS, ADMIN_MODAL_PREFIXES);
}

async function requireAdminAccess(interaction, config) {
  if (!interaction.guild || !interaction.member) return false;
  const settings = await getSettings(interaction.guild.id);
  if (isAdmin(interaction.member, settings)) return true;

  const payload = {
    embeds: [dangerEmbed(config, "Acesso negado", "Apenas administradores podem usar este painel.")],
    ephemeral: true
  };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
  return false;
}

module.exports = { isAdminButtonInteraction, isAdminModalInteraction, requireAdminAccess };