# 🚀 Deploy SQLite - Instruções para VPS

## Correções Aplicadas (Commit: 69517d2)

O bot estava falhando porque o novo `database/db.js` com `better-sqlite3` é **síncrono**, mas o código ainda tentava usar `.catch()` como se fossem Promises.

**Corrigido:**
- ✅ Removido `await` antes de `get()` - retorna valor direto
- ✅ Removido `await` antes de `run()` - retorna `{lastID, changes}`
- ✅ Removido `await` antes de `all()` - retorna array direto
- ✅ Corrigido `statsPanel.js` - usar try-catch em vez de `.catch()`
- ✅ Funções async mantidas (createTicket, listTicketByChannel, etc.)

---

## Passos para Deploy na VPS

### 1. Fazer pull das atualizações
```bash
cd ~/bot
git pull origin main
```

### 2. Limpar banco antigo (IMPORTANTE!)
```bash
# Isso vai forçar recriação do banco com o novo schema
rm ~/bot/database/bot.db ~/bot/database/bot.db-wal ~/bot/database/bot.db-shm 2>/dev/null || true

# Verificar que foi removido
ls -la ~/bot/database/
# Você deve ver APENAS: db.js e schema.sql
```

### 3. Reinstalar dependências (opcional, mas seguro)
```bash
npm install
# better-sqlite3 já deve estar lá
```

### 4. Reiniciar bot
```bash
# Se usando PM2:
pm2 restart bot

# Ou manual:
pm2 stop bot
pm2 start bot

# Verificar logs:
pm2 logs bot
```

---

## Verificação de Sucesso

Procure por estas mensagens nos logs:

```
✅ ESPERADO:
[DB] Banco de dados SQLite inicializado em: /home/ubuntu/bot/database/bot.db

❌ NÃO DEVE VER MAIS:
TypeError: Cannot read properties of undefined (reading 'catch')
```

---

## Se Algo der Errado

### Problema: "Cannot read properties of undefined"
**Solução:**
```bash
# 1. Para bot
pm2 stop bot

# 2. Limpe tudo
rm -rf ~/bot/database/bot.db*

# 3. Atualize código
git pull origin main

# 4. Reinstale
npm install

# 5. Inicie novamente
pm2 start bot

# 6. Veja os logs
pm2 logs bot
```

### Problema: "Module not found: better-sqlite3"
**Solução:**
```bash
npm install better-sqlite3
pm2 restart bot
```

### Problema: Permissão negada em database/
**Solução:**
```bash
chmod -R 755 ~/bot/database/
chmod 644 ~/bot/database/*.sql
pm2 restart bot
```

---

## Rollback (Se necessário reverter)

```bash
git reset --hard HEAD~1  # Desfazer o fix
npm install              # Reinstalar @supabase/supabase-js se necessário
pm2 restart bot
```

---

## Informações Técnicas

- **Banco:** SQLite local em `database/bot.db` (criado automaticamente)
- **WAL Mode:** Habilitado para performance
- **Foreign Keys:** Habilitadas
- **Schema:** 13 tabelas definidas em `database/schema.sql`

---

## Checklist de Deploy

- [ ] git pull origin main
- [ ] rm database/bot.db*
- [ ] npm install
- [ ] pm2 restart bot
- [ ] Verificar logs: "[DB] Banco de dados SQLite inicializado"
- [ ] Testar operações: /slash commands, compras, tickets
- [ ] Confirmar: Não há erros "Cannot read properties"

**Status: ✅ Pronto para Deploy**

