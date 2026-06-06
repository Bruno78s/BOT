/**
 * Sincronização de dados do bot para o Supabase do site
 * Roda periodicamente para manter site e bot sincronizados
 */

const { isSupabaseEnabled, getSupabase } = require('./supabase');
const { all, get } = require('../database/db');

async function syncToSupabase() {
  if (!isSupabaseEnabled()) {
    return { success: false, message: 'Supabase não configurado' };
  }

  return {
    success: true,
    message: 'Supabase é a fonte primária de dados. Sincronização não necessária.'
  };
}

module.exports = {
  syncToSupabase
};
