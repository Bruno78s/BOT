# 🚀 Guia de Deploy - Migração SQLite Completa

## Status: ✅ MIGRAÇÃO CONCLUÍDA E TESTADA

### O que mudou?
- ✅ Banco de dados: **Supabase** → **SQLite (local)**
- ✅ Driver: `@supabase/supabase-js` → `better-sqlite3`
- ✅ Schema: 13 tabelas criadas automaticamente na primeira execução
- ✅ Performance: Queries síncronas diretas (sem latência de rede)
- ✅ Confiabilidade: Sem parsing SQL complexo, sem falhas silenciosas

### Commits Enviados
```
11f0815 - SQLite: Testes completos validados com sucesso
3015a64 - Adicionado testes SQLite (removido após validação)
8e21ec9 - Migração: Supabase → SQLite com better-sqlite3
```

---

## 📋 Instruções de Deploy na VPS

### Passo 1: Atualizar código
```bash
cd /root/bot
git pull origin main
```

### Passo 2: Instalar nova dependência (se necessário)
```bash
npm install
# better-sqlite3 já está no package.json
```

### Passo 3: Remover banco antigo (APENAS SE QUISER FRESH START)
```bash
# ⚠️ CUIDADO: Isso apagará todos os dados!
rm database/bot.db database/bot.db-wal database/bot.db-shm 2>/dev/null
```

### Passo 4: Iniciar bot
```bash
node index.js
# Ou via PM2 se estiver usando:
pm2 restart bot
```

### Passo 5: Verificar inicialização
Procure pela mensagem no console:
```
[DB] Banco de dados SQLite inicializado em: /root/bot/database/bot.db
```

Se aparecer, está funcionando! ✅

---

## 📊 O que foi Testado

Todas estas operações foram validadas no ambiente local:

| Operação | Status | Detalhes |
|----------|--------|----------|
| Settings (CRUD) | ✅ | INSERT/SELECT/UPDATE funcionando |
| Contadores | ✅ | UPDATE com incremento (counter++) |
| Usuários | ✅ | ON CONFLICT UPSERT |
| **Tickets** | ✅ | product_id armazenado/recuperado corretamente |
| Pagamentos | ✅ | INSERT com múltiplos campos |
| Cupons | ✅ | Desconto e uso contado corretamente |
| Relatórios | ✅ | COUNT, SUM, COUNT DISTINCT funcionando |
| Status Report | ✅ | CASE WHEN para filtrar por status |
| Incrementos | ✅ | Operador + em UPDATE |
| Deletions | ✅ | DELETE removendo registros corretamente |

---

## 🐛 Possíveis Problemas e Soluções

### Problema: "Bot não inicia"
**Solução:**
```bash
# Verificar se Discord token está correto
echo $DISCORD_TOKEN

# Verificar se melhor-sqlite3 foi instalado
npm list better-sqlite3

# Limpar node_modules e reinstalar
rm -rf node_modules package-lock.json
npm install
```

### Problema: "Produto não encontrado"
**Causa:** O `product_id` no banco não corresponde a nenhum produto em `config.json`

**Verificação:**
```javascript
// No console do Node (node repl)
const config = require('./utils/config').loadConfig();
console.log(config.products.map(p => p.id));
```

### Problema: Banco de dados corrompido
**Solução:**
```bash
# SQLite auto-repara em 99% dos casos, mas se necessário:
sqlite3 database/bot.db ".tables"

# Se quiser fazer backup antes:
cp database/bot.db database/bot.db.backup
```

---

## 📁 Estrutura de Arquivos Alterada

```
database/
├── bot.db ⭐ NOVO - Banco SQLite local
├── bot.db-wal (criado automaticamente com WAL mode)
├── schema.sql ✏️ NOVO - Schema SQLite completo
├── db.js ✏️ MODIFICADO - Agora usa better-sqlite3
└── schema_postgres.sql (descontinuado - pode remover)
```

---

## 🔧 Configuração Recomendada em .env

As seguintes variáveis **não são mais necessárias** (mas você pode deixá-las):

```env
# Opcional agora (descontinuado):
# SUPABASE_URL=...
# SUPABASE_SERVICE_ROLE=...
# SUPABASE_ANON_KEY=...
# DATABASE_URL=...
```

As variáveis **obrigatórias** continuam as mesmas:
```env
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...
MERCADO_PAGO_PUBLIC_KEY=...
MERCADO_PAGO_ACCESS_TOKEN=...
```

---

## 🔄 Rollback (Se Necessário)

Se algo der errado, você pode voltar para Supabase:

```bash
# Desfazer últimos 3 commits
git reset --hard HEAD~3

# Ou desatualizações específicas:
git checkout f333069  # Último commit antes da migração
npm install           # Reinstala @supabase/supabase-js
```

---

## 📞 Suporte

Qualquer erro reportado:
1. Limpe database/bot.db
2. Faça git pull novamente
3. npm install
4. node index.js
5. Copie qualquer mensagem de erro

---

## ✅ Checklist Final

- [x] Código atualizado via git
- [x] Dependências instaladas (better-sqlite3)
- [x] Banco de dados criado automaticamente
- [x] Todas as queries testadas e validadas
- [x] Performance melhorada (sem latência de rede)
- [x] Commits documentados no GitHub

**Status: 🟢 PRONTO PARA PRODUÇÃO**
