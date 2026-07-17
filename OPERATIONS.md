# Operação segura do BznX Bot

## Configuração privada e inventário

- `config.json` contém somente dados públicos e o estoque inicial de novos ambientes.
- `config.private.json` contém links de entrega automática e nunca deve ser versionado.
- O estoque operacional fica em `database/bot.db`, na tabela `product_inventory`.
- Em uma instalação antiga, execute `npm run migrate:private-config` uma vez antes de iniciar o bot.

## Comandos do Discord

A inicialização não apaga nem publica comandos automaticamente. Publique mudanças com:

```powershell
npm run deploy:commands
```

Use `REGISTER_COMMANDS_ON_STARTUP=true` apenas quando a publicação durante o boot for realmente necessária.

## Webhooks

- Mercado Pago exige `x-signature`, `x-request-id` e `MERCADO_PAGO_WEBHOOK_SECRET` válidos.
- Stripe exige `stripe-signature` e `STRIPE_WEBHOOK_SECRET` válidos.
- `POST /site/venda` exige `x-api-key: <BZNX_INTEGRATION_API_KEY>` ou `Authorization: Bearer <BZNX_INTEGRATION_API_KEY>`.
- Configure `TRUST_PROXY=true` somente quando existir um proxy reverso confiável na frente do bot.

## Backup e recuperação

- Backups automáticos são gravados somente como `.enc`, usando AES-256-GCM.
- Configure `BACKUP_ENCRYPTION_KEY` com pelo menos 16 caracteres e guarde uma cópia fora do servidor.
- Para recuperar dados, coloque o arquivo como `database/data/exported-data.enc` e reinicie o bot.
- O arquivo de recuperação é removido após uma restauração bem-sucedida para não ser aplicado novamente.

## Monitoramento

`GET /health` retorna `503` quando o banco ou o Discord não estão prontos. O payload também informa quantas entregas financeiras ficaram com status `failed` e precisam de revisão manual.