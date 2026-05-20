const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DB_PATH, all } = require("../database/db");

const BACKUP_DIR = path.join(__dirname, "..", "database", "backups");
const DATA_DIR = path.join(__dirname, "..", "database", "data");

// Chave de criptografia (deve estar no .env)
const ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-key-change-in-production';
const IV_LENGTH = 16;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Criptografa dados usando AES-256-CBC
 */
function encrypt(text) {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('[ENCRYPTION] Erro ao criptografar:', error);
    return null;
  }
}

/**
 * Descriptografa dados
 */
function decrypt(encryptedData) {
  try {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('[ENCRYPTION] Erro ao descriptografar:', error);
    return null;
  }
}

/**
 * Backup criptografado do banco de dados
 */
function backupDatabaseEncrypted() {
  ensureDir(BACKUP_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const source = DB_PATH;
  
  try {
    // Ler arquivo do banco
    const data = fs.readFileSync(source, 'utf8');
    
    // Criptografar
    const encrypted = encrypt(data);
    if (!encrypted) throw new Error('Falha na criptografia');
    
    // Salvar arquivo criptografado
    const target = path.join(BACKUP_DIR, `db-encrypted-${timestamp}.enc`);
    fs.writeFileSync(target, encrypted);
    
    console.log(`[BACKUP] Backup criptografado criado: ${target}`);
    return { success: true, path: target };
  } catch (error) {
    console.error('[BACKUP] Erro ao criar backup criptografado:', error);
    return { success: false, error: error.message };
  }
}

function backupDatabase() {
  ensureDir(BACKUP_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(BACKUP_DIR, `db-${timestamp}.sqlite`);
  fs.copyFileSync(DB_PATH, target);
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
    const invites = await all("SELECT * FROM invite_stats");
    const inviteJoins = await all("SELECT * FROM invite_joins WHERE left_at IS NULL");
    const payments = await all("SELECT * FROM payments WHERE status = 'pending'");
    
    const data = {
      exportedAt: Date.now(),
      invites,
      inviteJoins,
      pendingPayments: payments
    };
    
    // Criptografar antes de salvar
    const jsonData = JSON.stringify(data);
    const encrypted = encrypt(jsonData);
    
    if (encrypted) {
      fs.writeFileSync(
        path.join(DATA_DIR, "exported-data.enc"),
        encrypted
      );
      console.log('[BACKUP] Dados exportados e criptografados com sucesso');
    } else {
      // Fallback para não criptografado se falhar
      fs.writeFileSync(
        path.join(DATA_DIR, "exported-data.json"),
        jsonData
      );
    }
    
    return { success: true, message: "Dados exportados com sucesso" };
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
