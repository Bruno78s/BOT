const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { all, db } = require("../database/db");

const BACKUP_DIR = path.join(__dirname, "..", "database", "backups");
const DATA_DIR = path.join(__dirname, "..", "database", "data");
const TABLES = [
  "settings", "users", "counters", "tickets", "logs", "payments", "panel_messages",
  "auto_responses", "coupons", "invite_stats", "invite_joins", "moderation_cases",
  "moderation_warnings", "moderation_strikes", "customer_profiles", "product_inventory",
  "payment_fulfillment_jobs"
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function requireEncryptionSecret() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("BACKUP_ENCRYPTION_KEY ou JWT_SECRET deve ter pelo menos 16 caracteres.");
  }
  return secret;
}

function encrypt(input) {
  const secret = requireEncryptionSecret();
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const source = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  const encrypted = Buffer.concat([cipher.update(source), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", salt.toString("hex"), iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decryptLegacy(encryptedData, returnBuffer) {
  const [ivHex, payloadHex] = encryptedData.split(":");
  if (!ivHex || !payloadHex) throw new Error("Formato de backup inválido.");
  const key = Buffer.from(requireEncryptionSecret().padEnd(32).slice(0, 32));
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
  const output = Buffer.concat([decipher.update(Buffer.from(payloadHex, "hex")), decipher.final()]);
  return returnBuffer ? output : output.toString("utf8");
}

function decrypt(encryptedData, returnBuffer = false) {
  const value = String(encryptedData || "");
  if (!value.startsWith("v2:")) return decryptLegacy(value, returnBuffer);

  const [, saltHex, ivHex, tagHex, payloadHex] = value.split(":");
  if (!saltHex || !ivHex || !tagHex || !payloadHex) throw new Error("Formato de backup v2 inválido.");
  const key = crypto.scryptSync(requireEncryptionSecret(), Buffer.from(saltHex, "hex"), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const output = Buffer.concat([decipher.update(Buffer.from(payloadHex, "hex")), decipher.final()]);
  return returnBuffer ? output : output.toString("utf8");
}

async function exportData() {
  const data = { version: 2, exportedAt: Date.now() };
  for (const table of TABLES) data[table] = all(`SELECT * FROM ${table}`);
  return data;
}

async function backupDatabaseEncrypted() {
  ensureDir(BACKUP_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(BACKUP_DIR, `db-${timestamp}.enc`);
  try {
    const data = await exportData();
    fs.writeFileSync(target, encrypt(JSON.stringify(data)), { encoding: "utf8", mode: 0o600 });
    console.log(`[BACKUP] Backup autenticado criado: ${path.basename(target)}`);
    return { success: true, path: target };
  } catch (error) {
    console.error("[BACKUP] Falha ao criar backup:", error.message);
    return { success: false, error: error.message };
  }
}

async function backupDatabase() {
  return backupDatabaseEncrypted();
}

function pruneBackups(retentionDays) {
  ensureDir(BACKUP_DIR);
  const days = Number.isFinite(Number(retentionDays)) ? Number(retentionDays) : 30;
  const limit = Date.now() - Math.max(days, 1) * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    const fullPath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(fullPath);
    if (stat.isFile() && stat.mtimeMs < limit) fs.unlinkSync(fullPath);
  }
}

function restoreData(data) {
  if (!data || typeof data !== "object") throw new Error("Conteúdo de recuperação inválido.");
  let restoredRows = 0;
  let restoredTables = 0;

  const restore = db.transaction(() => {
    for (const table of TABLES) {
      const rows = Array.isArray(data[table]) ? data[table] : [];
      if (!rows.length) continue;
      const allowed = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => allowed.has(column));
        if (!columns.length) continue;
        const placeholders = columns.map(() => "?").join(", ");
        const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
        db.prepare(sql).run(...columns.map((column) => row[column]));
        restoredRows++;
      }
      restoredTables++;
    }
  });

  restore();
  return { restoredRows, restoredTables };
}

function importData() {
  ensureDir(DATA_DIR);
  const encryptedPath = path.join(DATA_DIR, "exported-data.enc");
  const jsonPath = path.join(DATA_DIR, "exported-data.json");
  const source = fs.existsSync(encryptedPath) ? encryptedPath : fs.existsSync(jsonPath) ? jsonPath : null;
  if (!source) return { success: false, message: "Nenhum arquivo de recuperação encontrado." };

  try {
    const raw = fs.readFileSync(source, "utf8");
    const data = source.endsWith(".enc") ? JSON.parse(decrypt(raw)) : JSON.parse(raw);
    const result = restoreData(data);
    fs.unlinkSync(source);
    return { success: true, ...result, encrypted: source.endsWith(".enc") };
  } catch (error) {
    console.error("[BACKUP] Falha ao restaurar arquivo de recuperação:", error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  backupDatabase,
  backupDatabaseEncrypted,
  decrypt,
  encrypt,
  ensureDir,
  exportData,
  importData,
  pruneBackups,
  restoreData
};