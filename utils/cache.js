/**
 * Sistema simples de cache para o bot
 */

const cache = new Map();

function set(key, value, ttlMinutes = 5) {
  const expiresAt = Date.now() + (ttlMinutes * 60 * 1000);
  cache.set(key, { value, expiresAt });
}

function get(key) {
  const item = cache.get(key);
  if (!item) return null;
  
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return item.value;
}

function del(key) {
  cache.delete(key);
}

function clear() {
  cache.clear();
}

function clearExpired() {
  for (const [key, item] of cache.entries()) {
    if (Date.now() > item.expiresAt) {
      cache.delete(key);
    }
  }
}

// Limpar cache expirado a cada 10 minutos
setInterval(clearExpired, 10 * 60 * 1000);

module.exports = {
  set,
  get,
  del,
  clear,
  clearExpired
};
