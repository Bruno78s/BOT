const { db, get, run } = require("../database/db");

function getInitialStock(product) {
  const value = Number(product?.initialStock ?? product?.stock ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function hydrateInventory(config) {
  if (!config?.products) return config;

  const seed = db.transaction((products) => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO product_inventory (product_id, stock, updated_at) VALUES (?, ?, ?)"
    );
    const select = db.prepare("SELECT stock FROM product_inventory WHERE product_id = ?");

    for (const product of products) {
      insert.run(product.id, getInitialStock(product), Date.now());
      const row = select.get(product.id);
      product.stock = Number(row?.stock ?? 0);
    }
  });

  seed(config.products);
  return config;
}

function getProductStock(productId) {
  const row = get("SELECT stock FROM product_inventory WHERE product_id = ?", [productId]);
  return row ? Number(row.stock) : null;
}

function setProductStock(config, productId, stock) {
  const normalized = Number(stock);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error("Estoque deve ser um inteiro maior ou igual a zero.");
  }

  run(
    `INSERT INTO product_inventory (product_id, stock, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET stock = excluded.stock, updated_at = excluded.updated_at`,
    [productId, normalized, Date.now()]
  );
  updateRuntimeStock(config, productId, normalized);
  return normalized;
}

function addProductStock(config, productId, quantity) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Quantidade de reposição deve ser um inteiro positivo.");
  }

  const transaction = db.transaction(() => {
    const current = getProductStock(productId);
    if (current === null) throw new Error("Produto não encontrado no inventário.");
    const next = current + amount;
    run("UPDATE product_inventory SET stock = ?, updated_at = ? WHERE product_id = ?", [next, Date.now(), productId]);
    return { previousStock: current, newStock: next };
  });

  const result = transaction();
  updateRuntimeStock(config, productId, result.newStock);
  return result;
}

function removeProductInventory(productId) {
  run("DELETE FROM product_inventory WHERE product_id = ?", [productId]);
}

function updateRuntimeStock(config, productId, stock) {
  const product = config?.products?.find((item) => item.id === productId);
  if (product) product.stock = Number(stock);
}

module.exports = {
  addProductStock,
  getInitialStock,
  getProductStock,
  hydrateInventory,
  removeProductInventory,
  setProductStock,
  updateRuntimeStock
};