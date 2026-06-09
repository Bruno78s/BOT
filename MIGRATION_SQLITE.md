# Migração: Supabase → SQLite

## Resumo
Bot migrado de Supabase (wrapper com parsing SQL complexo) para SQLite puro com `better-sqlite3`.

## Mudanças Realizadas

### Banco de Dados
- ✅ Criado novo schema SQLite: `database/schema.sql` (13 tabelas)
- ✅ Reescrito `database/db.js` para usar `better-sqlite3` (sync)
- ✅ Banco de dados criado automaticamente em `database/bot.db` na primeira execução

### Dependências
- ✅ `npm install better-sqlite3` - motor SQLite puro
- ✅ Removido uso de `@supabase/supabase-js` (mas ainda em package.json - remover se necessário)

### Código
- ✅ Removido `require("../utils/syncToSupabase")` de `events/ready.js`
- ✅ Removido `require("../utils/supabase")` de `events/ready.js`
- ✅ Removido cron job de sincronização com Supabase (a cada 5 minutos)

## Arquivos Descontinuados (Opcional)
Os seguintes arquivos não são mais usados e podem ser removidos:
- `utils/supabase.js` - cliente Supabase
- `utils/syncToSupabase.js` - sincronização remota
- `utils/dbWrapper.js` - wrapper da db (não usado)
- `database/schema_postgres.sql` - schema antigo de Postgres

## Variáveis de Ambiente
As seguintes variáveis não são mais necessárias (mas podem ser deixadas em `.env`):
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE=...
SUPABASE_ANON_KEY=...
DATABASE_URL=...
```

## Como Testar
1. Remover `database/bot.db` se existir (para teste fresh)
2. Iniciar bot: `node index.js`
3. Verificar logs: `[DB] Banco de dados SQLite inicializado em: ...`
4. Testar operações: compras, tickets, etc.

## Benefícios
- ✅ Sem latência de rede
- ✅ Sem conversão SQL complexa
- ✅ Sem timeout de Supabase
- ✅ Banco local = backup automático com Git
- ✅ Queries síncronas = código mais simples

## Rollback
Se necessário reverter:
1. `git checkout database/db.js`
2. `git checkout events/ready.js`
3. `npm uninstall better-sqlite3` (opcional)
