const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "bot.db");

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Run schema to ensure tables exist
const schema = require("fs").readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

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
