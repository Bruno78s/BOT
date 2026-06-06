const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { all } = require("../database/db");

const BACKUP_DIR = path.join(__dirname, "..", "database", "backups");
const DATA_DIR = path.join(__dirname, "..", "database", "data");

// Chave de criptografia (deve estar no .env)
const ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET;
const IV_LENGTH = 16;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Criptografa dados usando AES-256-CBC
 */
function encrypt(input) {
  try {
    if (!ENCRYPTION_KEY) {
      throw new Error('BACKUP_ENCRYPTION_KEY ou JWT_SECRET não definido');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const bufferInput = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    const encryptedBuffer = Buffer.concat([cipher.update(bufferInput), cipher.final()]);

    return iv.toString('hex') + ':' + encryptedBuffer.toString('hex');
  } catch (error) {
    console.error('[ENCRYPTION] Erro ao criptografar:', error);
    return null;
  }
}

/**
 * Descriptografa dados
 */
function decrypt(encryptedData, returnBuffer = false) {
  try {
    if (!ENCRYPTION_KEY) {
      throw new Error('BACKUP_ENCRYPTION_KEY ou JWT_SECRET não definido');
    }

    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decryptedBuffer = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return returnBuffer ? decryptedBuffer : decryptedBuffer.toString('utf8');
  } catch (error) {
    console.error('[ENCRYPTION] Erro ao descriptografar:', error);
    return null;
  }
}

/**
 * Backup criptografado do banco de dados
 */
async function backupDatabaseEncrypted() {
  ensureDir(BACKUP_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    const data = await exportData();
    const jsonData = JSON.stringify(data, null, 2);
    const encrypted = encrypt(jsonData);
    if (!encrypted) throw new Error('Falha na criptografia');

    const target = path.join(BACKUP_DIR, `db-encrypted-${timestamp}.enc`);
    fs.writeFileSync(target, encrypted);

    console.log(`[BACKUP] Backup criptografado criado: ${target}`);
    return { success: true, path: target };
  } catch (error) {
    console.error('[BACKUP] Erro ao criar backup criptografado:', error);
    return { success: false, error: error.message };
  }
}

async function backupDatabase() {
  ensureDir(BACKUP_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(BACKUP_DIR, `db-${timestamp}.json`);

  try {
    const data = await exportData();
    fs.writeFileSync(target, JSON.stringify(data, null, 2));
    console.log(`[BACKUP] Backup JSON criado: ${target}`);
    return { success: true, path: target };
  } catch (error) {
    console.error('[BACKUP] Erro ao criar backup JSON:', error);
    return { success: false, error: error.message };
  }
}

function pruneBackups(retentionDays) {
  ensureDir(BACKUP_DIR);
  const limit = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(BACKUP_DIR);
  for (const file of files) {
    const fullPath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < limit) {
      fs.unlinkSync(fullPath);
    }
  }
}

// Exportar dados importantes para JSON (criptografado)
async function exportData() {
  ensureDir(DATA_DIR);

  try {
    const tables = [
      "settings",
      "users",
      "counters",
      "tickets",
      "logs",
      "payments",
      "panel_messages",
      "auto_responses",
      "coupons",
      "invite_stats",
      "invite_joins"
    ];

    const data = {
      exportedAt: Date.now()
    };

    for (const table of tables) {
      data[table] = await all(`SELECT * FROM ${table}`);
    }

    return data;
  } catch (error) {
    console.error("Erro ao exportar dados:", error);
    return { success: false, error: error.message };
  }
}

// Importar dados de JSON (após reiniciar) - suporta criptografado
function importData() {
  // Tentar arquivo criptografado primeiro
  const encryptedPath = path.join(DATA_DIR, "exported-data.enc");
  const jsonPath = path.join(DATA_DIR, "exported-data.json");
  
  if (fs.existsSync(encryptedPath)) {
    try {
      const encrypted = fs.readFileSync(encryptedPath, "utf8");
      const decrypted = decrypt(encrypted);
      if (decrypted) {
        const data = JSON.parse(decrypted);
        return { success: true, data, encrypted: true };
      }
    } catch (error) {
      console.error("Erro ao descriptografar dados:", error);
    }
  }
  
  // Fallback para arquivo não criptografado
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      return { success: true, data, encrypted: false };
    } catch (error) {
      console.error("Erro ao importar dados:", error);
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, message: "Nenhum arquivo de exportação encontrado" };
}

module.exports = {
  backupDatabase,
  backupDatabaseEncrypted,
  pruneBackups,
  exportData,
  importData,
  ensureDir,
  encrypt,
  decrypt
};
