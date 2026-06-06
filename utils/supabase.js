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
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    const options = {};

    if (nodeMajor < 22) {
      try {
        const WebSocket = require('ws');
        options.realtime = { transport: WebSocket };
        console.log('[SUPABASE] Usando transporte ws para Realtime (Node < 22)');
      } catch (err) {
        console.warn('[SUPABASE] Pacote "ws" não encontrado. Instale com `npm i ws` para suporte Realtime no Node < 22');
      }
    }

    supabase = createClient(url, key, options);
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
