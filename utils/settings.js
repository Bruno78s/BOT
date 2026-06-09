const { get, run } = require("../database/db");

async function getSettings(guildId) {
  return get("SELECT * FROM settings WHERE guild_id = ?", [guildId]);
}

async function upsertSettings(guildId, data) {
  run(
    "INSERT INTO settings (guild_id, admin_role_id, support_role_id, sales_category_id, support_category_id, log_channel_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET admin_role_id = excluded.admin_role_id, support_role_id = excluded.support_role_id, sales_category_id = excluded.sales_category_id, support_category_id = excluded.support_category_id, log_channel_id = excluded.log_channel_id",
    [
      guildId,
      data.admin_role_id,
      data.support_role_id,
      data.sales_category_id,
      data.support_category_id,
      data.log_channel_id
    ]
  );
}

module.exports = {
  getSettings,
  upsertSettings
};
