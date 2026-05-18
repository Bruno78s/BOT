# Deploy em VPS Ubuntu 24h

Este guia configura o bot para rodar 24h em uma VPS Ubuntu usando `systemd`.

## 1. Preparar a VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential python3 make g++
```

## 2. Instalar Node.js LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 3. Clonar o projeto

```bash
sudo mkdir -p /opt/bznx-store
sudo chown -R $USER:$USER /opt/bznx-store
git clone https://github.com/Bruno78s/BOT.git /opt/bznx-store
cd /opt/bznx-store
```

## 4. Instalar dependências

```bash
npm ci
```

Se `npm ci` falhar por diferença de lockfile, use:

```bash
npm install
```

## 5. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Preencha pelo menos:

```env
DISCORD_TOKEN=token_do_bot
CLIENT_ID=id_do_bot
WEBHOOK_PORT=3000
```

Se usar pagamentos/webhooks, preencha também Mercado Pago e/ou Asaas.

## 6. Liberar porta do webhook

Se o bot usa webhooks de pagamento na porta `3000`:

```bash
sudo ufw allow 3000/tcp
sudo ufw allow OpenSSH
sudo ufw enable
```

## 7. Testar manualmente

```bash
npm start
```

Se conectar corretamente, pare com `CTRL + C`.

## 8. Criar serviço systemd

```bash
sudo nano /etc/systemd/system/bznx-store.service
```

Cole:

```ini
[Unit]
Description=BznX Store Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/bznx-store
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
User=root

[Install]
WantedBy=multi-user.target
```

## 9. Ativar inicialização automática

```bash
sudo systemctl daemon-reload
sudo systemctl enable bznx-store
sudo systemctl start bznx-store
```

## 10. Verificar status e logs

```bash
sudo systemctl status bznx-store
sudo journalctl -u bznx-store -f
```

## 11. Atualizar o bot depois de mudanças

```bash
cd /opt/bznx-store
git pull origin main
npm ci
sudo systemctl restart bznx-store
sudo journalctl -u bznx-store -f
```

## 12. Comandos úteis

```bash
sudo systemctl stop bznx-store
sudo systemctl start bznx-store
sudo systemctl restart bznx-store
sudo systemctl status bznx-store
```

## Observações importantes

- Ative no Discord Developer Portal as intents necessárias:
  - Server Members Intent
  - Presence Intent
  - Message Content Intent
- Não envie o arquivo `.env` para o GitHub.
- O banco SQLite fica dentro da pasta `database`; faça backup periódico se a VPS for reinstalada.
- Para webhooks públicos, configure um domínio ou IP público apontando para `http://IP_DA_VPS:3000`.
