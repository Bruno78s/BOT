const fs = require("fs");
const path = require("path");
const { DB_PATH, all } = require("../database/db");

const BACKUP_DIR = path.join(__dirname, "..", "database", "backups");
const DATA_DIR = path.join(__dirname, "..", "database", "data");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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

// Exportar dados importantes para JSON
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
    
    fs.writeFileSync(
      path.join(DATA_DIR, "exported-data.json"),
      JSON.stringify(data, null, 2)
    );
    
    return { success: true, message: "Dados exportados com sucesso" };
  } catch (error) {
    console.error("Erro ao exportar dados:", error);
    return { success: false, error: error.message };
  }
}

// Importar dados de JSON (após reiniciar)
function importData() {
  const filePath = path.join(DATA_DIR, "exported-data.json");
  
  if (!fs.existsSync(filePath)) {
    return { success: false, message: "Nenhum arquivo de exportação encontrado" };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { success: true, data };
  } catch (error) {
    console.error("Erro ao importar dados:", error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  backupDatabase,
  pruneBackups,
  exportData,
  importData,
  ensureDir
};
