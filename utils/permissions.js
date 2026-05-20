function isAdmin(member, settings) {
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
