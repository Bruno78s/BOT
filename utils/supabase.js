const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  
  if (!url || !key) {
    console.log('[SUPABASE] Credenciais Supabase não configuradas');
    return null;
  }
  
  try {
    supabase = createClient(url, key);
    console.log('[SUPABASE] Conectado com sucesso');
    return supabase;
  } catch (error) {
    console.error('[SUPABASE] Erro ao conectar:', error);
    return null;
  }
}

function getSupabase() {
  if (!supabase) {
    return initSupabase();
  }
  return supabase;
}

function isSupabaseEnabled() {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE;
}

module.exports = {
  initSupabase,
  getSupabase,
  isSupabaseEnabled
};
