const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "bot.db");

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Run schema to ensure tables exist
const schema = require("fs").readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("payments", "coupon_id", "INTEGER");
ensureColumn("payments", "order_code", "TEXT");
ensureColumn("payments", "fulfillment_status", "TEXT NOT NULL DEFAULT 'awaiting_payment'");
ensureColumn("payments", "delivered_at", "INTEGER");
ensureColumn("payments", "issue_reason", "TEXT");
ensureColumn("payments", "payment_message_id", "TEXT");
ensureColumn("coupons", "payment_method", "TEXT");
ensureColumn("coupons", "role_id", "TEXT");
ensureColumn("coupons", "first_purchase_only", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("coupons", "per_user_limit", "INTEGER");

// Query functions
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  return { lastID: result.lastInsertRowid, changes: result.changes };
}

module.exports = {
  get,
  all,
  run,
  db
};
