const { getSupabase, isSupabaseEnabled } = require("../utils/supabase");

const transformDotNumberToJson = (sql) => {
  // Transform occurrences like `counters.0` => `counters->>'0'`
  // Matches identifiers starting with a letter/underscore to avoid touching numeric literals.
  return sql.replace(/\b([a-zA-Z_][\w]*)\.(\d+)\b/g, (m, col, idx) => `${col}->>'${idx}'`);
};

function ensureSupabase() {
  if (!isSupabaseEnabled()) {
    console.warn("[SUPABASE] Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE no .env.");
    return null;
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error("[SUPABASE] Falha ao inicializar Supabase.");
    return null;
  }

  return supabase;
}

function splitCommaOutsideParens(input) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function normalizeIdentifier(identifier) {
  // Remove quotes and any table prefix (e.g. users.last_ticket_at -> last_ticket_at)
  const cleaned = identifier.trim().replace(/['"`]/g, "");
  const parts = cleaned.split('.');
  return parts[parts.length - 1];
}

function parseWhereClause(whereClause, params = [], startIndex = 0) {
  if (!whereClause) return { conditions: [], paramsUsed: 0 };

  const conditions = [];
  let index = startIndex;
  const parts = whereClause.split(/\s+and\s+/i);

  for (const part of parts) {
    const trimmed = part.trim();
    let match = trimmed.match(/^([\w."'()\/]+)\s+is\s+null$/i);
    if (match) {
      conditions.push({ column: normalizeIdentifier(match[1]), operator: "is", value: null });
      continue;
    }

    match = trimmed.match(/^([\w."'()\/]+)\s+is\s+not\s+null$/i);
    if (match) {
      conditions.push({ column: normalizeIdentifier(match[1]), operator: "isNot", value: null });
      continue;
    }

    match = trimmed.match(/^([\w."'()\/]+)\s*(=|<>|!=|>|<|>=|<=)\s*\?$/i);
    if (match) {
      const column = normalizeIdentifier(match[1]);
      const operator = match[2];
      const value = params[index++];
      conditions.push({ column, operator, value });
      continue;
    }

    match = trimmed.match(/^date\(created_at\/1000,\s*'unixepoch'\)\s*=\s*date\('now'\)$/i);
    if (match) {
      conditions.push({ column: "created_at", operator: "todayUtc" });
      continue;
    }

    return { conditions: null, paramsUsed: 0 };
  }

  return { conditions, paramsUsed: index - startIndex };
}

function applyFilters(builder, conditions) {
  for (const condition of conditions) {
    const { column, operator, value } = condition;
    switch (operator) {
      case "=":
        builder = builder.eq(column, value);
        break;
      case "!=":
      case "<>":
        builder = builder.neq(column, value);
        break;
      case ">":
        builder = builder.gt(column, value);
        break;
      case "<":
        builder = builder.lt(column, value);
        break;
      case ">=":
        builder = builder.gte(column, value);
        break;
      case "<=":
        builder = builder.lte(column, value);
        break;
      case "is":
        builder = builder.is(column, null);
        break;
      case "isNot":
        builder = builder.not(column, "is", null);
        break;
      default:
        throw new Error(`Operador WHERE não suportado: ${operator}`);
    }
  }
  return builder;
}

function parseOrderClause(orderClause) {
  if (!orderClause) return null;
  const match = orderClause.trim().match(/^([\w."']+)\s+(asc|desc)$/i);
  if (!match) return null;
  return {
    column: normalizeIdentifier(match[1]),
    direction: match[2].toLowerCase()
  };
}

function parseSelectQuery(sql, params = []) {
  const regex = /select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+?))?(?:\s+group\s+by\s+(.+?))?(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+(\d+))?(?:\s+offset\s+(\d+))?$/i;
  const match = sql.match(regex);
  if (!match) return null;

  const select = match[1].trim();
  const table = match[2];
  const whereClause = match[3];
  const groupBy = match[4] ? match[4].split(",").map(normalizeIdentifier) : null;
  const orderClause = match[5];
  const limit = match[6] ? Number(match[6]) : undefined;

  const whereData = parseWhereClause(whereClause || "", params);
  if (whereData.conditions === null) return null;

  const order = parseOrderClause(orderClause);
  return {
    table,
    select,
    filters: whereData.conditions,
    order,
    limit,
    groupBy
  };
}

function qualifyTableName(table) {
  // Ensure we pass a plain table name (Supabase client already handles schema)
  const cleaned = table.trim();
  const parts = cleaned.split('.');
  return parts[parts.length - 1];
}

function parseInsertQuery(sql, params) {
  const normalized = sql.replace(/\s+/g, " ").trim();
  const match = normalized.match(/insert\s+into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)(?:\s+on\s+conflict\s*\(([^)]+)\)\s*do\s+update\s+set\s+(.+))?/i);
  if (!match) return null;

  const table = match[1];
  const columns = match[2].split(",").map(col => normalizeIdentifier(col));
  const valuesPart = match[3].split(",").map(v => v.trim());

  if (columns.length !== valuesPart.length || columns.length !== params.length) return null;

  const row = {};
  columns.forEach((column, index) => {
    row[column] = params[index] !== undefined ? params[index] : null;
  });

  const conflictColumns = match[4] ? match[4].split(",").map(normalizeIdentifier) : null;
  return { table, row, conflictColumns };
}

function parseUpdateQuery(sql, params) {
  const match = sql.match(/update\s+(\w+)\s+set\s+(.+?)\s+where\s+(.+)/i);
  if (!match) return null;

  const table = match[1];
  const setClause = match[2];
  const whereClause = match[3];
  const setParts = splitCommaOutsideParens(setClause);

  const set = {};
  const expressions = [];
  let paramIndex = 0;

  for (const part of setParts) {
    const [column, value] = part.split("=").map(piece => piece.trim());
    const name = normalizeIdentifier(column);

    const simpleMatch = value.match(/^\?$/);
    if (simpleMatch) {
      set[name] = params[paramIndex++];
      continue;
    }

    const exprMatch = value.match(new RegExp(`^${name}\\s*([+-])\\s*\\?$`));
    if (exprMatch) {
      expressions.push({ column: name, operator: exprMatch[1], amount: params[paramIndex++] });
      continue;
    }

    return null;
  }

  const whereData = parseWhereClause(whereClause, params, paramIndex);
  if (whereData.conditions === null) return null;

  return {
    table,
    set,
    expressions,
    where: whereData.conditions
  };
}

function parseDeleteQuery(sql, params) {
  const match = sql.match(/delete\s+from\s+(\w+)\s+where\s+(.+)/i);
  if (!match) return null;

  const whereData = parseWhereClause(match[2], params);
  if (whereData.conditions === null) return null;

  return { table: match[1], where: whereData.conditions };
}

function hasAggregateSelect(select) {
  return /count\(|sum\(|coalesce\(|case\s+when|distinct/i.test(select);
}

function evaluateCondition(row, condition) {
  const { column, operator, value } = condition;
  switch (operator) {
    case "=":
      return row[column] === value;
    case "!=":
    case "<>":
      return row[column] !== value;
    case ">":
      return row[column] > value;
    case "<":
      return row[column] < value;
    case ">=":
      return row[column] >= value;
    case "<=":
      return row[column] <= value;
    case "is":
      return row[column] === null;
    case "isNot":
      return row[column] !== null;
    case "todayUtc": {
      const date = new Date(row[column]);
      if (Number.isNaN(date.getTime())) return false;
      const now = new Date();
      return date.getUTCFullYear() === now.getUTCFullYear() &&
        date.getUTCMonth() === now.getUTCMonth() &&
        date.getUTCDate() === now.getUTCDate();
    }
    default:
      return false;
  }
}

function filterRows(rows, conditions) {
  if (!conditions || conditions.length === 0) return rows;
  return rows.filter(row => conditions.every(condition => evaluateCondition(row, condition)));
}

function parseFieldExpression(field) {
  const aliasMatch = field.match(/\s+as\s+(\w+)$/i);
  const alias = aliasMatch ? aliasMatch[1] : null;
  const expression = aliasMatch ? field.slice(0, aliasMatch.index).trim() : field.trim();
  return { expression, alias: alias || expression.replace(/\W+/g, "_").toLowerCase() };
}

function computeAggregate(rows, expression) {
  const normalized = expression.trim().toLowerCase();
  const countDistinctMatch = normalized.match(/^count\(distinct\s+([\w.]+)\)$/i);
  if (countDistinctMatch) {
    const column = normalizeIdentifier(countDistinctMatch[1]);
    const distinct = new Set(rows.map(row => row[column]));
    return distinct.size;
  }

  if (/^count\(\*\)$/i.test(normalized)) {
    return rows.length;
  }

  const sumMatch = normalized.match(/^sum\(([^)]+)\)$/i);
  if (sumMatch) {
    const column = normalizeIdentifier(sumMatch[1]);
    return rows.reduce((total, row) => total + Number(row[column] || 0), 0);
  }

  const coalesceSumMatch = normalized.match(/^coalesce\(sum\(([^)]+)\),\s*0\)$/i);
  if (coalesceSumMatch) {
    const column = normalizeIdentifier(coalesceSumMatch[1]);
    return rows.reduce((total, row) => total + Number(row[column] || 0), 0);
  }

  const caseSumMatch = normalized.match(/^sum\(case\s+when\s+([\w.]+)\s*=\s*'([^']+)'\s+then\s+([\w.]+)\s+else\s+([\w.]+)\s+end\)$/i);
  if (caseSumMatch) {
    const column = normalizeIdentifier(caseSumMatch[1]);
    const expected = caseSumMatch[2];
    const thenValue = normalizeIdentifier(caseSumMatch[3]);
    const elseValue = normalizeIdentifier(caseSumMatch[4]);
    return rows.reduce((total, row) => {
      const matchCondition = String(row[column]) === expected;
      const value = matchCondition ? row[thenValue] : row[elseValue];
      return total + Number(value || 0);
    }, 0);
  }

  const caseCountMatch = normalized.match(/^sum\(case\s+when\s+([\w.]+)\s*=\s*'([^']+)'\s+then\s+1\s+else\s+0\s+end\)$/i);
  if (caseCountMatch) {
    const column = normalizeIdentifier(caseCountMatch[1]);
    const expected = caseCountMatch[2];
    return rows.reduce((total, row) => total + (String(row[column]) === expected ? 1 : 0), 0);
  }

  return null;
}

function computeAggregatedView(rows, selectFields) {
  const result = {};
  for (const field of selectFields) {
    const { expression, alias } = parseFieldExpression(field);
    result[alias] = computeAggregate(rows, expression);
  }
  return [result];
}

function computeGroupedView(rows, select, groupBy, order, limit) {
  const fields = splitCommaOutsideParens(select);
  const groups = new Map();

  for (const row of rows) {
    const key = groupBy.map(column => String(row[column])).join("|,");
    if (!groups.has(key)) {
      const groupRow = {};
      for (const column of groupBy) {
        groupRow[column] = row[column];
      }
      groupRow.__rows = [];
      groups.set(key, groupRow);
    }
    groups.get(key).__rows.push(row);
  }

  const result = [];
  for (const groupRow of groups.values()) {
    const groupRows = groupRow.__rows;
    const output = {};
    for (const field of fields) {
      const { expression, alias } = parseFieldExpression(field);
      if (groupBy.some(column => expression.toLowerCase() === column.toLowerCase())) {
        output[alias] = groupRow[expression];
        continue;
      }
      output[alias] = computeAggregate(groupRows, expression);
    }
    result.push(output);
  }

  if (order && order.column) {
    result.sort((a, b) => {
      const aValue = a[order.column];
      const bValue = b[order.column];
      if (aValue === bValue) return 0;
      return order.direction === "asc" ? (aValue < bValue ? -1 : 1) : (aValue > bValue ? -1 : 1);
    });
  }

  return limit ? result.slice(0, limit) : result;
}

async function selectSupabase(sql, params = []) {
  const supabase = ensureSupabase();
  if (!supabase) return null;
  const parsed = parseSelectQuery(sql.trim(), params);
  if (!parsed) return null;

  const { table, select, filters, order, limit, groupBy } = parsed;
  const qTable = qualifyTableName(table);
  
  // Select correct columns upfront (don't call .select() twice)
  const selectCols = (!hasAggregateSelect(select) && !groupBy && select !== "*") ? select : "*";
  let builder = supabase.from(qTable).select(selectCols);

  let filterConditions = [];
  if (filters && filters.length) {
    const supportedFilters = [];
    for (const condition of filters) {
      if (condition.operator === "todayUtc") {
        filterConditions.push(condition);
        continue;
      }
      supportedFilters.push(condition);
    }

    if (supportedFilters.length > 0) {
      builder = applyFilters(builder, supportedFilters);
    }
  }

  if (!hasAggregateSelect(select) && !groupBy) {
    if (order) builder = builder.order(order.column, { ascending: order.direction === "asc" });
    if (typeof limit === "number") builder = builder.limit(limit);
  }

  let data;
  let error;
  try {
    ({ data, error } = await builder);
  } catch (err) {
    console.error("[SUPABASE] exceção ao executar query:", err);
    try {
      console.error("[SUPABASE] SQL:", sql);
      console.error("[SUPABASE] params:", params);
    } catch (e) { /* ignore */ }
    return null;
  }

  if (error) {
    console.error("[SUPABASE] falha ao ler dados remotos:", error);
    try {
      console.error("[SUPABASE] SQL:" , sql);
      console.error("[SUPABASE] params:", params);
    } catch (e) { /* ignore */ }
    return null;
  }

  let rows = data || [];
  if (filterConditions.length > 0) {
    rows = filterRows(rows, filterConditions);
  }

  if (groupBy || hasAggregateSelect(select)) {
    if (groupBy) {
      return computeGroupedView(rows, select, groupBy, order, limit);
    }

    if (select === "*") return rows;
    const selectFields = splitCommaOutsideParens(select);
    return computeAggregatedView(rows, selectFields);
  }

  return rows;
}

async function insertSupabase(sql, params = []) {
  const supabase = ensureSupabase();
  if (!supabase) return null;
  const parsed = parseInsertQuery(sql, params);
  if (!parsed) return null;

  const { table, row, conflictColumns } = parsed;
  const qTable = qualifyTableName(table);
  if (conflictColumns && conflictColumns.length > 0) {
    const { error } = await supabase.from(qTable).upsert(row, { onConflict: conflictColumns.join(",") });
    if (error) throw error;
    return null;
  }

  const { error } = await supabase.from(qTable).insert(row);
  if (error) throw error;
  return null;
}

async function updateSupabase(sql, params = []) {
  const supabase = ensureSupabase();
  if (!supabase) return null;
  const parsed = parseUpdateQuery(sql, params);
  if (!parsed) return null;

  const { table, set, expressions, where } = parsed;
  const qTable = qualifyTableName(table);
  if (expressions.length === 0) {
    const { error } = await supabase.from(qTable).update(set).match(where);
    if (error) throw error;
    return null;
  }

  let builder = supabase.from(qTable).select("*");
  builder = applyFilters(builder, where);
  const { data, error: selectError } = await builder;
  if (selectError) throw selectError;
  if (!data || data.length === 0) return null;

  for (const row of data) {
    const updated = { ...row, ...set };
    for (const expr of expressions) {
      if (expr.operator === "+") {
        updated[expr.column] = Number(row[expr.column] || 0) + Number(expr.amount || 0);
      } else if (expr.operator === "-") {
        updated[expr.column] = Number(row[expr.column] || 0) - Number(expr.amount || 0);
      }
    }
    const key = row.id ? { id: row.id } : where;
    const { error: updateError } = await supabase.from(qTable).update(updated).match(key);
    if (updateError) throw updateError;
  }

  return null;
}

async function deleteSupabase(sql, params = []) {
  const supabase = ensureSupabase();
  if (!supabase) return null;
  const parsed = parseDeleteQuery(sql, params);
  if (!parsed) return null;

  const { table, where } = parsed;
  const qTable = qualifyTableName(table);
  const { error } = await supabase.from(qTable).delete().match(where);
  if (error) throw error;
  return null;
}

async function query(sql, params = []) {
  const normalized = sql.trim().replace(/;$/, "");
  const transformed = transformDotNumberToJson(normalized);
  const lower = transformed.toLowerCase();

  if (lower.startsWith("select")) {
    return await selectSupabase(transformed, params);
  }

  if (lower.startsWith("insert")) {
    await insertSupabase(transformed, params);
    return [];
  }

  if (lower.startsWith("update")) {
    await updateSupabase(transformed, params);
    return [];
  }

  if (lower.startsWith("delete")) {
    await deleteSupabase(transformed, params);
    return [];
  }

  throw new Error(`SQL não suportado pelo wrapper Supabase: ${sql}`);
}

async function get(queryString, params = []) {
  const results = await query(queryString, params);
  return results && results.length > 0 ? results[0] : null;
}

async function all(queryString, params = []) {
  return await query(queryString, params);
}

async function run(queryString, params = []) {
  await query(queryString, params);
  return { lastID: null, changes: 1 };
}

module.exports = {
  run,
  get,
  all
};
