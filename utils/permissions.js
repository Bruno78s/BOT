function isAdmin(member, settings) {
  // Verificar se é dono do servidor
  if (member.guild.ownerId === member.id) return true;
  
  // Verificar permissão de Administrator
  if (member.permissions.has("Administrator")) return true;
  
  // Verificar cargo de admin configurado
  if (!settings || !settings.admin_role_id) return false;
  return member.roles.cache.has(settings.admin_role_id);
}

function isSupport(member, settings) {
  if (!settings || !settings.support_role_id) return false;
  return member.roles.cache.has(settings.support_role_id) || isAdmin(member, settings);
}

module.exports = {
  isAdmin,
  isSupport
};
