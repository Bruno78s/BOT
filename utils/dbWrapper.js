/**
 * Wrapper de Database - Usa Supabase apenas
 */

const { isSupabaseEnabled, getSupabase } = require('./supabase');

// Query genérica que funciona com ambos
async function query(sql, params = []) {
  if (isSupabaseEnabled()) {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase não inicializado');
    
    // Converter query SQL para Supabase
    // Extrair nome da tabela e operação
    const cleanSql = sql.trim().toLowerCase();
    
    if (cleanSql.startsWith('select')) {
      const table = extractTableName(sql);
      const { data, error } = await supabase
        .from(table)
        .select('*');
      
      if (error) throw error;
      return data;
    }
    
    if (cleanSql.startsWith('insert')) {
      const table = extractTableName(sql);
      const values = extractValues(sql, params);
      const { data, error } = await supabase
        .from(table)
        .insert(values)
        .select();
      
      if (error) throw error;
      return data;
    }
    
    if (cleanSql.startsWith('update')) {
      const table = extractTableName(sql);
      const { set, where } = extractUpdateData(sql, params);
      const { data, error } = await supabase
        .from(table)
        .update(set)
        .match(where)
        .select();
      
      if (error) throw error;
      return data;
    }
    
    if (cleanSql.startsWith('delete')) {
      const table = extractTableName(sql);
      const where = extractWhere(sql, params);
      const { data, error } = await supabase
        .from(table)
        .delete()
        .match(where);
      
      if (error) throw error;
      return data;
    }
    
    // Fallback para RPC se não conseguir parsear
    const { data, error } = await supabase.rpc('execute_sql', { sql, params });
    if (error) throw error;
    return data;
  }
  throw new Error('Supabase não configurado. Esta aplicação agora exige Supabase.');
}

// Query single
async function get(sql, params = []) {
  const results = await query(sql, params);
  return results && results.length > 0 ? results[0] : null;
}

// Query all
async function all(sql, params = []) {
  return await query(sql, params);
}

// Run (insert/update/delete)
async function run(sql, params = []) {
  if (!isSupabaseEnabled()) {
    throw new Error('Supabase não configurado. Esta aplicação agora exige Supabase.');
  }
  await query(sql, params);
  return { lastID: null, changes: 1 };
}

// Funções auxiliares para parsear SQL
function extractTableName(sql) {
  const match = sql.match(/from\s+(\w+)|into\s+(\w+)|update\s+(\w+)/i);
  return match ? (match[1] || match[2] || match[3]) : 'unknown';
}

function extractValues(sql, params) {
  // Simplificado - assume que params já está na ordem correta
  const values = {};
  const columns = extractColumns(sql);
  columns.forEach((col, i) => {
    values[col] = params[i] !== undefined ? params[i] : null;
  });
  return values;
}

function extractColumns(sql) {
  const match = sql.match(/\(([^)]+)\)\s*values/i);
  if (match) {
    return match[1].split(',').map(c => c.trim().replace(/"/g, ''));
  }
  return [];
}

function extractUpdateData(sql, params) {
  return { set: {}, where: {} };
}

function extractWhere(sql, params) {
  return {};
}

module.exports = {
  get,
  all,
  run,
  query,
  isSupabaseEnabled
};
