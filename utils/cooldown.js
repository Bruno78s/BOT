/**
 * Sistema de cooldown para comandos
 */

const cooldowns = new Map();

function checkCooldown(userId, commandName, cooldownSeconds = 5) {
  const key = `${userId}-${commandName}`;
  const now = Date.now();
  const userCooldown = cooldowns.get(key);
  
  if (userCooldown) {
    const remaining = userCooldown - now;
    if (remaining > 0) {
      return { onCooldown: true, remaining: Math.ceil(remaining / 1000) };
    }
  }
  
  // Set new cooldown
  cooldowns.set(key, now + (cooldownSeconds * 1000));
  return { onCooldown: false, remaining: 0 };
}

function clearOldCooldowns() {
  const now = Date.now();
  for (const [key, expiresAt] of cooldowns.entries()) {
    if (now > expiresAt) {
      cooldowns.delete(key);
    }
  }
}

// Limpar cooldowns antigos a cada 5 minutos
setInterval(clearOldCooldowns, 5 * 60 * 1000);

module.exports = {
  checkCooldown,
  clearOldCooldowns
};
