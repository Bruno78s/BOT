[OPEN] payment-webhook-confirmation

# Debug Session: payment-webhook-confirmation

## Sintoma
- O usuário conclui o pagamento no provedor.
- O site confirma normalmente.
- O bot não confirma automaticamente nem atualiza o status no Discord.

## Escopo
- Fluxo Mercado Pago / webhook / atualização local / liberação pós-pagamento.

## Hipóteses
1. O webhook do Mercado Pago não está chegando no processo do bot.
2. O webhook chega, mas o payload não contém ou não resolve corretamente `channel_id` / `external_reference`.
3. O webhook chega e busca o pagamento remoto, mas falha ao localizar ou atualizar o registro local no banco.
4. O status é atualizado no banco, mas a etapa de pós-confirmação no Discord falha antes de liberar acesso/cargo/mensagem.
5. O fluxo real que funciona no site usa um identificador/status diferente do tratado pelo bot.

## Evidências Coletadas
- Log do ambiente Ubuntu/PM2 mostra:
  - pagamentos PIX sendo criados normalmente com status `pending`;
  - nenhuma evidência de entrada do webhook nos trechos enviados;
  - erro recorrente `[PIX EXPIRY] TypeError: expiredPayments is not iterable` em `events/ready.js:102`.
- Leitura do código em `events/ready.js` mostra `const expiredPayments = all(...)` sem `await`.
- Leitura do código em `database/db.js` mostra `get/all/run` definidos como `async`, embora a base use `better-sqlite3` síncrono e grande parte do projeto consuma essas funções de forma síncrona.
- Teste na VPS:
  - `curl http://127.0.0.1:3000/health` retorna `200` com JSON do Express do bot.
  - `curl -X POST https://bznx-store.duckdns.org/api/pix/webhook ...` retorna `201 Created` com body `{"received":false}`.
  - Esse response não existe no código do bot e difere do handler local, que retorna `200` via `res.sendStatus(200)`.
- Conclusão forte: a URL pública `/api/pix/webhook` não está chegando no Express do bot; está sendo atendida por outro serviço/proxy/regra.

## Status das Hipóteses
- H1 webhook não chega no bot: confirmada.
- H2 webhook chega mas não resolve `channel_id`: rejeitada nesta etapa, porque nem chega ao handler do bot.
- H3 lookup/update local quebra por contrato incorreto do DB: confirmada parcialmente por evidência runtime (`Promise` sendo usada como coleção/objeto em múltiplos pontos).
- H4 pós-confirmação no Discord falha: inconclusiva.
- H5 site e bot tratam eventos diferentes: inconclusiva.

## Instrumentação
- `utils/mercadoPago.js`
  - `E:create-pix-payment`
  - `C:pix-payment-db-insert`
- `utils/webhookServer.js`
  - `A:webhook-entry`
  - `B:webhook-routing`
  - `B:webhook-fetch-payment`
  - `C:local-payment-miss`
  - `C:local-payment-found`
  - `D:confirm-approved-entry`
  - `D:confirm-approved-error`

## Próxima Reprodução
- Reiniciar o bot com esta instrumentação ativa.
- Gerar um novo PIX.
- Pagar esse PIX.
- Ler `.dbg/trae-debug-log-payment-webhook-confirmation.ndjson`.

## Resultado
- Pendente.
