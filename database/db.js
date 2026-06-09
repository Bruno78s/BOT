const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "bot.db");
let db = null;

function ensureDatabase() {
  if (db) return db;

  try {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");

    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    
    db.exec(schema);
    console.log("[DB] Banco de dados SQLite inicializado em:", DB_PATH);
    return db;
  } catch (error) {
    console.error("[DB] Erro ao inicializar banco:", error.message);
    throw error;
  }
}

function get(sql, params = []) {
  try {
    const database = ensureDatabase();
    const stmt = database.prepare(sql);
    return stmt.get(...params);
  } catch (error) {
    console.error("[DB] Erro em GET:", { sql, params, error: error.message });
    return null;
  }
}

function all(sql, params = []) {
  try {
    const database = ensureDatabase();
    const stmt = database.prepare(sql);
    return stmt.all(...params);
  } catch (error) {
    console.error("[DB] Erro em ALL:", { sql, params, error: error.message });
    return [];
  }
}

function run(sql, params = []) {
  try {
    const database = ensureDatabase();
    const stmt = database.prepare(sql);
    const result = stmt.run(...params);
    return { lastID: result.lastInsertRowid, changes: result.changes };
  } catch (error) {
    console.error("[DB] Erro em RUN:", { sql, params, error: error.message });
    throw error;
  }
}

module.exports = {
  get,
  all,
  run,
  ensureDatabase
};

