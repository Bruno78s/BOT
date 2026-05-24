const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require("discord.js");
const { infoEmbed, successEmbed, dangerEmbed } = require("../utils/embeds");
const { getSettings, upsertSettings } = require("../utils/settings");
const { isAdmin } = require("../utils/permissions");
const { closeTicket, registerRating, createTicket, listTicketByChannel } = require("../utils/tickets");
const { logToDb, logToChannel } = require("../utils/logger");
const { notifySale } = require("../utils/notifications");
const { performVerification, formatVerificationResults } = require("../utils/verification");
const { logTicketEvent, logFeedbackEvent, logSecurityEvent } = require("../utils/advancedLogger");
const { buildCartEmbed, buildTermsEmbed, formatPrice, readConfigFile, writeConfigFile, buildTermsSnapshot } = require("../utils/salesFlow");
const { createCheckoutPayment, getPendingPaymentByChannel, getCredentialMode } = require("../utils/mercadoPago");
const { get, run, all } = require("../database/db");
const { validateCoupon, calculateDiscount, useCoupon, getCoupon, listCoupons, createCoupon, deleteCoupon } = require("../utils/coupons");
const { logSeguranca, logPedido } = require("../utils/channelLogger");
const { getInviteStats, getInviteLeaderboard, getRedeemableInvites, resetRedeemableInvites, setRedeemedInvites } = require("../utils/invites");

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function formatStars(rating) {
  return "⭐".repeat(rating) + "☆".repeat(5 - rating);
}

function parsePriceInput(value) {
  return Number(String(value).trim().replace(/\./g, "").replace(",", "."));
}

function getCurrentProducts(config) {
  return readConfigFile().products || config.products || [];
}

function buildProductAdminView(config, description = "Selecione um produto para gerenciar ou cadastre um novo item.") {
  const products = getCurrentProducts(config);
  const menuOptions = products.map((product) => ({
    label: product.name.slice(0, 100),
    description: `${formatPrice(product.price)} | Est: ${product.stock > 0 ? product.stock : "Esgotado"} | ${product.deliveryUrl ? "🚀 Auto" : "📋 Ticket"}`.slice(0, 100),
    value: `edit_product_${product.id}`
  }));

  menuOptions.push({
    label: "Adicionar Novo Produto",
    description: "Criar um novo produto",
    value: "add_new_product"
  });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${config.botName} | Produtos`)
    .setDescription(description)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("product_menu")
      .setPlaceholder("Selecione um produto")
      .addOptions(menuOptions.slice(0, 25))
  );

  return { embed, components: [row, buildMainMenuBackRow()] };
}

function buildProductBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_products_back")
      .setLabel("Voltar para produtos")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildMainMenuBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_main_back")
      .setLabel("Voltar ao Menu Principal")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function sendPurchaseAuditLog(interaction, config, ticket, product) {
  const logChannelId = "1469735330511851732";
  const logChannel = await interaction.client.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel?.isTextBased()) return;

  const acceptedAt = ticket.terms_accepted_at ? new Date(ticket.terms_accepted_at).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"}) : "Não registrado";
  const content = [
    "BznX Store - Registro de Compra",
    "",
    `Cliente: ${interaction.user.tag} (${interaction.user.id})`,
    `Canal: #${interaction.channel.name} (${interaction.channel.id})`,
    `Produto: ${product?.name || ticket.product_id || "Não identificado"}`,
    `Plano: ${product?.tier || "Não identificado"}`,
    `Valor: ${product ? formatPrice(product.price) : "Não identificado"}`,
    `Termos aceitos em: ${acceptedAt}`,
    "",
    ticket.terms_snapshot || "Termos não registrados no ticket.",
    "",
    `Finalizado em: ${new Date().toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})}`
  ].join("\n");

  const file = new AttachmentBuilder(Buffer.from(content, "utf8"), {
    name: `compra-${interaction.channel.id}.txt`
  });

  await logChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle(`${config.botName} | Registro de Compra`)
        .setDescription([
          `**Cliente:** <@${interaction.user.id}>`,
          `**Produto:** ${product?.name || ticket.product_id || "Não identificado"}`,
          `**Canal:** <#${interaction.channel.id}>`,
          `**Termos:** ${ticket.terms_accepted_at ? "Aceitos" : "Não registrados"}`
        ].join("\n"))
        .setTimestamp()
    ],
    files: [file]
  });
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction, config) {
    try {
      // Log TODAS as interações no início
      console.log(`[INTERACTION START] Tipo: ${interaction.type}, ID: ${interaction.id}, CustomId: ${interaction.customId || 'N/A'}`);
      
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        console.log(`[INTERACTION] Button/Menu clicked: ${interaction.customId} by ${interaction.user.tag} in #${interaction.channelId}`);
        console.log(`[DEBUG] Verificando handlers para: ${interaction.customId}`);
      }
      
      if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command) {
        await command.execute(interaction, config);
        return;
      }
    }

    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        await command.autocomplete(interaction, config);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "initial_config_modal") {
        const adminRoleId = interaction.fields.getTextInputValue("admin_role_id");
        const supportRoleId = interaction.fields.getTextInputValue("support_role_id");
        const salesCategoryId = interaction.fields.getTextInputValue("sales_category_id");
        const supportCategoryId = interaction.fields.getTextInputValue("support_category_id");
        const logChannelId = interaction.fields.getTextInputValue("log_channel_id");

        await upsertSettings(interaction.guild.id, {
          admin_role_id: adminRoleId,
          support_role_id: supportRoleId,
          sales_category_id: salesCategoryId,
          support_category_id: supportCategoryId,
          log_channel_id: logChannelId
        });

        await interaction.reply({
          content: "Configuração inicial realizada com sucesso! O bot agora está pronto para uso.",
          ephemeral: true
        });
        return;
      }

      if (interaction.customId === "admin_invites_set_modal") {
        const userId = interaction.fields.getTextInputValue("invite_user_id").replace(/\D/g, "");
        const amount = Number(interaction.fields.getTextInputValue("invite_amount"));

        if (!userId || !Number.isInteger(amount) || amount < 0) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Dados inválidos", "Informe um ID de usuário válido e uma quantidade positiva.")],
            ephemeral: true
          });
        }

        const stats = await setRedeemedInvites(interaction.guild.id, userId, amount);
        return interaction.reply({
          embeds: [successEmbed(config, "Invites ajustados", `Usuário: <@${userId}>\nDisponíveis agora: **${getRedeemableInvites(stats)}**\nTotal histórico: **${stats.total || 0}**`)],
          ephemeral: true
        });
      }

      if (interaction.customId === "add_product_modal") {
        const name = interaction.fields.getTextInputValue("product_name").trim();
        const priceStockRaw = interaction.fields.getTextInputValue("product_price_stock");
        const catTierRaw = interaction.fields.getTextInputValue("product_category_tier");
        const description = interaction.fields.getTextInputValue("product_description").trim();
        const deliveryUrl = interaction.fields.getTextInputValue("product_delivery_url")?.trim() || "";

        const [priceStr, stockStr] = priceStockRaw.split("|").map(s => s.trim());
        const price = parsePriceInput(priceStr);
        const stock = parseInt(stockStr);

        const [category, tier] = catTierRaw.split("|").map(s => s.trim().toLowerCase());

        if (!Number.isFinite(price) || price < 0 || Number.isNaN(stock) || stock < 0) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Valor inválido", "Use formato: `9.99 | 10` para preço e estoque.")],
            ephemeral: true
          });
        }

        if (!category || !tier) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Formato inválido", "Use formato: `bots | premium` para categoria e tier.")],
            ephemeral: true
          });
        }

        const group = name.toLowerCase().replace(/\s+(basic|premium|platinum|diamond|plus)$/i, "").replace(/\s+/g, "-");
        const newProduct = {
          id: name.toLowerCase().replace(/\s+/g, "-"),
          name,
          category,
          group,
          tier,
          channelId: interaction.channel.id,
          price,
          stock,
          description
        };
        if (deliveryUrl) newProduct.deliveryUrl = deliveryUrl;

        const configData = readConfigFile();
        configData.products.push(newProduct);
        writeConfigFile(configData);

        config.products.push({ ...newProduct });

        const deliveryInfo = deliveryUrl ? `\n📦 Entrega automática: ✅` : `\n📦 Entrega: Via ticket`;
        await interaction.reply({
          embeds: [successEmbed(config, "Produto adicionado", `**${name}** criado com sucesso!\nPreço: ${formatPrice(price)} | Estoque: ${stock}${deliveryInfo}`)],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId === "admin_payment_modal") {
        const pix = interaction.fields.getTextInputValue("payment_pix");
        const bank = interaction.fields.getTextInputValue("payment_bank");
        const beneficiary = interaction.fields.getTextInputValue("payment_beneficiary");
        const qrCode = interaction.fields.getTextInputValue("payment_qr_code");
        const configData = readConfigFile();

        configData.payment.pix = pix;
        configData.payment.bank = bank;
        configData.payment.beneficiary = beneficiary;
        configData.payment.qrCode = qrCode;
        writeConfigFile(configData);

        await interaction.reply({
          embeds: [successEmbed(config, "Pagamento atualizado", "As informações de pagamento foram salvas no config.json.")],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId === "admin_channels_modal") {
        const ticketPanelChannelId = interaction.fields.getTextInputValue("ticket_panel_channel_id");
        const botDeliveryChannelId = interaction.fields.getTextInputValue("bot_delivery_channel_id");
        const siteDeliveryChannelId = interaction.fields.getTextInputValue("site_delivery_channel_id");
        const feedbackChannelId = interaction.fields.getTextInputValue("feedback_channel_id");
        const statsChannelId = interaction.fields.getTextInputValue("stats_channel_id");
        const configData = readConfigFile();

        configData.ticketPanelChannelId = ticketPanelChannelId;
        configData.deliveryChannels = {
          bots: botDeliveryChannelId,
          sites: siteDeliveryChannelId
        };
        configData.feedbackChannelId = feedbackChannelId;
        configData.statsChannelId = statsChannelId;
        writeConfigFile(configData);

        await interaction.reply({
          embeds: [successEmbed(config, "Canais atualizados", "Os canais principais foram salvos no config.json.")],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId.startsWith("edit_delivery_modal_")) {
        const productId = interaction.customId.replace("edit_delivery_modal_", "");
        const deliveryUrl = interaction.fields.getTextInputValue("delivery_url").trim();

        const configData = readConfigFile();
        const productIndex = configData.products.findIndex(p => p.id === productId);
        if (productIndex === -1) {
          return interaction.reply({ content: "Produto não encontrado", ephemeral: true });
        }

        if (deliveryUrl) {
          configData.products[productIndex].deliveryUrl = deliveryUrl;
        } else {
          delete configData.products[productIndex].deliveryUrl;
        }
        writeConfigFile(configData);

        const memProduct = config.products.find(p => p.id === productId);
        if (memProduct) {
          if (deliveryUrl) memProduct.deliveryUrl = deliveryUrl;
          else delete memProduct.deliveryUrl;
        }

        const status = deliveryUrl
          ? `✅ Entrega automática configurada!\nLink: ${deliveryUrl}`
          : "❌ Entrega automática removida. O cliente abrirá ticket de entrega.";

        await interaction.reply({
          embeds: [successEmbed(config, "Entrega atualizada", `**${configData.products[productIndex].name}**\n\n${status}`)],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId.startsWith("edit_product_modal_")) {
        const productId = interaction.customId.replace("edit_product_modal_", "");
        const price = parsePriceInput(interaction.fields.getTextInputValue("product_price"));
        const stock = parseInt(interaction.fields.getTextInputValue("product_stock"));

        const configPath = require("path").join(__dirname, "..", "config.json");
        const fs = require("fs");
        const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
        
        const productIndex = configData.products.findIndex(p => p.id === productId);
        if (productIndex === -1) {
          return interaction.reply({ content: "Produto não encontrado", ephemeral: true });
        }

        if (!Number.isFinite(price) || price < 0 || Number.isNaN(stock) || stock < 0) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Valor inválido", "Use um preço válido, como X,99 ou X.99, e um estoque válido.")],
            ephemeral: true
          });
        }

        configData.products[productIndex].price = price;
        configData.products[productIndex].stock = stock;

        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

        await interaction.reply({
          embeds: [successEmbed(config, "Produto atualizado", `Preço: ${formatPrice(price)}, Estoque: ${stock}. Clique em Voltar para editar outro produto.`)],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId === "coupon_modal") {
        const couponCode = interaction.fields.getTextInputValue("coupon_code").trim();
        const ticket = await listTicketByChannel(interaction.channel.id);
        const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
        
        if (!product) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")],
            ephemeral: true
          });
        }

        let discount = 0;
        let coupon = null;
        let finalPrice = product.price;

        if (couponCode) {
          const validation = await validateCoupon(interaction.guild.id, couponCode, product.price, product.id);
          
          if (!validation.valid) {
            return interaction.reply({
              embeds: [dangerEmbed(config, "Cupom inválido", validation.reason)],
              ephemeral: true
            });
          }

          coupon = validation.coupon;
          discount = calculateDiscount(product.price, coupon);
          finalPrice = product.price - discount;
        }

        const gatewayRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("select_payment_gateway")
            .setPlaceholder("Selecione o método de pagamento...")
            .addOptions([
              {
                label: " PIX",
                description: `Pagar com PIX via QR CODE e Copia e cola ${coupon ? `(Desconto: ${formatPrice(discount)})` : ""}`,
                value: "mercadopago"
              },
              ])
        );

        const description = coupon 
          ? `Cupom **${coupon.code}** aplicado! Desconto de ${formatPrice(discount)}.`
          : "Nenhum cupom aplicado.";

        await interaction.reply({
          embeds: [infoEmbed(config, "Selecione o Pagamento", `Escolha o método de pagamento para **${product.name}**.\n\n${description}\n\n**Total:** ${formatPrice(finalPrice)} (${coupon ? `De ${formatPrice(product.price)}` : ""})`)],
          components: [gatewayRow],
          ephemeral: true
        });

        if (coupon) {
          await run("UPDATE tickets SET coupon_id = ? WHERE channel_id = ?", [coupon.id, interaction.channel.id]);
        }

        return;
      }

      if (interaction.customId.startsWith("create_coupon_modal")) {
        try {
          const code = interaction.fields.getTextInputValue("coupon_code").trim();
          const discountType = interaction.fields.getTextInputValue("coupon_discount_type").trim();
          const discountValueStr = interaction.fields.getTextInputValue("coupon_discount_value").trim();
          const maxUses = interaction.fields.getTextInputValue("coupon_max_uses").trim();
          const minAmount = interaction.fields.getTextInputValue("coupon_min_amount").trim();
          const modalProductId = interaction.customId.includes(":") ? interaction.customId.split(":")[1] : "all";
          const productId = modalProductId === "all" ? "" : modalProductId;

          if (!["percentage", "fixed"].includes(discountType)) {
            return interaction.reply({
              embeds: [dangerEmbed(config, "Tipo inválido", "O tipo deve ser 'percentage' ou 'fixed'.")],
              ephemeral: true
            });
          }

          const discountValue = parsePriceInput(discountValueStr.replace("%", ""));
          if (!Number.isFinite(discountValue) || discountValue <= 0) {
            return interaction.reply({
              embeds: [dangerEmbed(config, "Valor inválido", "O valor do desconto deve ser positivo (ex: 5 ou 5%).")],
              ephemeral: true
            });
          }

          const options = {};
          if (maxUses) {
            options.maxUses = parseInt(maxUses);
            if (Number.isNaN(options.maxUses) || options.maxUses <= 0) {
              return interaction.reply({
                embeds: [dangerEmbed(config, "Valor inválido", "O máximo de usos deve ser um número positivo.")],
                ephemeral: true
              });
            }
          }
          if (minAmount) {
            options.minAmount = parsePriceInput(minAmount);
            if (!Number.isFinite(options.minAmount) || options.minAmount <= 0) {
              return interaction.reply({
                embeds: [dangerEmbed(config, "Valor inválido", "O valor mínimo deve ser um número positivo.")],
                ephemeral: true
              });
            }
          }
          if (productId) {
            const product = config.products.find(p => p.id === productId);
            if (!product) {
              return interaction.reply({
                embeds: [dangerEmbed(config, "Produto não encontrado", "O ID do produto informado não existe.")],
                ephemeral: true
              });
            }
            options.productId = productId;
          }

          await createCoupon(interaction.guild.id, code, discountType, discountValue, options);
          await interaction.reply({
            embeds: [successEmbed(config, "Cupom criado", `Cupom **${code.toUpperCase()}** criado com sucesso!${productId ? ` Válido para: ${config.products.find(p => p.id === productId)?.name || 'Produto específico'}` : ' Válido para todos os produtos'}`)],
            ephemeral: true
          });
          return;
        } catch (error) {
          console.error("[Coupon] Erro ao criar cupom:", error);
          return interaction.reply({
            embeds: [dangerEmbed(config, "Erro ao criar cupom", error.message || "Erro desconhecido.")],
            ephemeral: true
          });
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("product_select_")) {
        const productId = interaction.values[0].replace("cart_start_", "");
        const settings = await getSettings(interaction.guild.id) || {};
        const product = config.products.find((p) => p.id === productId);

        if (!product) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Produto não encontrado", "Este produto não está disponível no momento.")],
            ephemeral: true
          });
        }

        if (product.stock <= 0) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Produto esgotado", "Este produto está temporariamente sem estoque.")],
            ephemeral: true
          });
        }

        const result = await createTicket({
          guild: interaction.guild,
          member: interaction.member,
          type: "sales",
          config,
          settings,
          productId
        });

        if (result.error) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Carrinho não criado", result.error)],
            ephemeral: true
          });
        }

        await interaction.reply({
          embeds: [successEmbed(config, "Carrinho criado", `Acesse seu carrinho em ${result.channel}.`)],
          ephemeral: true
        });

        await logToDb(interaction.guild.id, "info", "Carrinho criado", {
          channelId: result.channel.id,
          userId: interaction.user.id,
          productId
        });

        await logTicketEvent(interaction.client, config, "Carrinho Criado", result.channel.id, {
          description: `Carrinho criado por ${interaction.user.tag}.`,
          fields: [
            { name: "Canal", value: `<#${result.channel.id}>`, inline: true },
            { name: "Usuário", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Produto", value: product.name, inline: true },
            { name: "Valor", value: formatPrice(product.price), inline: true }
          ]
        });

        await notifySale(interaction.client, config, product, interaction.guild, interaction.user.id);
        return;
      }

      if (interaction.customId === "support_ticket_select") {
        const reasonMap = {
          support: "suporte",
          service_issue: "problema-servico"
        };
        const reason = reasonMap[interaction.values[0]] || "suporte";
        const settings = await getSettings(interaction.guild.id) || {};

        const result = await createTicket({
          guild: interaction.guild,
          member: interaction.member,
          type: "support",
          config,
          settings,
          productId: null,
          reason
        });

        if (result.error) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Ticket não criado", result.error)],
            ephemeral: true
          });
        }

        await interaction.reply({
          embeds: [successEmbed(config, "Ticket criado", `Acesse seu atendimento em ${result.channel}.`)],
          ephemeral: true
        });

        await logTicketEvent(interaction.client, config, "Ticket de Suporte Criado", result.channel.id, {
          description: `Ticket criado por ${interaction.user.tag}.`,
          fields: [
            { name: "Canal", value: `<#${result.channel.id}>`, inline: true },
            { name: "Usuário", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Motivo", value: reason, inline: true }
          ]
        });
        return;
      }

      if (interaction.customId === "select_payment_gateway") {
        await interaction.deferReply({ ephemeral: true });

        const ticket = await listTicketByChannel(interaction.channel.id);
        const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
        if (!product) {
          return interaction.editReply({
            embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")],
            components: []
          });
        }

        const gateway = interaction.values[0];
        
        let coupon = null;
        let discount = 0;
        let finalPrice = product.price;
        
        if (ticket.coupon_id) {
          coupon = await get("SELECT * FROM coupons WHERE id = ?", [ticket.coupon_id]);
          if (coupon) {
            discount = calculateDiscount(product.price, coupon);
            finalPrice = Math.round((product.price - discount) * 100) / 100;
          }
        }

        let checkout = null;

        try {
          checkout = await createCheckoutPayment({
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            userId: interaction.user.id,
            product: { ...product, price: finalPrice },
            user: interaction.user
          });
        } catch (error) {
          console.error(`Erro ao criar pagamento ${gateway}:`, error.response?.data || error);
          const errorDescription = error?.message || error?.error || error?.cause?.[0]?.description || error?.response?.data?.errors?.[0]?.description || "Erro desconhecido";
          return interaction.editReply({
            embeds: [dangerEmbed(config, "Pagamento indisponível", `Erro ao processar pagamento via ${gateway === "asaas" ? "Asaas" : "Mercado Pago"}.\n\nDetalhe: ${errorDescription}`)],
            components: []
          });
        }

        if (coupon) {
          await useCoupon(coupon.id);
        }

        const localPaymentRecord = await getPendingPaymentByChannel(interaction.channel.id);
        await logPedido(interaction.client, config, {
          userId: interaction.user.id,
          productName: product.name,
          amount: finalPrice,
          orderId: localPaymentRecord?.id || "?",
          channelId: interaction.channel.id,
        }).catch(() => null);

        const files = [];
        let qrCodeAttached = false;
        if (checkout.qrCodeBase64) {
          const qrBuffer = Buffer.from(checkout.qrCodeBase64, "base64");
          files.push(new AttachmentBuilder(qrBuffer, { name: "pix-qrcode.png" }));
          qrCodeAttached = true;
        }

        const descLines = [
          `> 👤 **Cliente:** <@${interaction.user.id}>`,
          `> 📦 **Produto:** ${product.name}`,
          coupon ? `> 🏷️ **Desconto:** ${formatPrice(discount)} (cupom **${coupon.code.toUpperCase()}**)` : null,
          `> 💰 **Valor:** ${formatPrice(finalPrice)}`,
          "",
          "─────────────────────────────",
          "",
          checkout.copyPasteCode
            ? `📋 **Copia e Cola PIX:**\n\`\`\`\n${checkout.copyPasteCode}\n\`\`\``
            : null,
          "",
          "─────────────────────────────",
          "",
          "> 🔄 **Status:** ⏳ Aguardando pagamento...",
          "> ✅ A confirmação será **automática** após o pagamento!",
        ].filter(Boolean).join("\n");

        const paymentEmbed = new EmbedBuilder()
          .setColor(0x00b4d8)
          .setAuthor({ name: `${config.botName} • Pagamento`, iconURL: interaction.client.user.displayAvatarURL() })
          .setTitle("💳 Pagamento via PIX")
          .setDescription(descLines)
          .setFooter({ text: `${config.botName} • Pagamento 100% seguro.`, iconURL: interaction.client.user.displayAvatarURL() })
          .setTimestamp();

        if (qrCodeAttached) {
          paymentEmbed.setImage("attachment://pix-qrcode.png");
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("ticket_cancel_purchase")
            .setLabel("❌ Cancelar Pedido")
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ content: "✅ PIX gerado! Veja abaixo.", ephemeral: true });

        await interaction.channel.send({
          embeds: [paymentEmbed],
          components: [row],
          files
        });
        return;
      }

      if (interaction.customId === "admin_menu") {
        const settings = await getSettings(interaction.guild.id);
        if (!isAdmin(interaction.member, settings)) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Acesso negado", "Apenas administradores podem usar este menu.")],
            ephemeral: true
          });
        }

        const selectedValue = interaction.values[0];

        if (selectedValue === "admin_products") {
          const { embed, components } = buildProductAdminView(config);
          return interaction.update({ embeds: [embed], components });
        }
        
        if (selectedValue === "admin_payments") {
          const payments = await all("SELECT * FROM payments WHERE guild_id = ? ORDER BY created_at DESC LIMIT 25", [interaction.guild.id]);
          const stats = await get(`
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN status='approved' THEN amount ELSE 0 END) as receita,
              SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as aprovados,
              SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pendentes
            FROM payments WHERE guild_id = ?`, [interaction.guild.id]);

          if (!payments || payments.length === 0) {
            const embed = new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle("💰 Histórico de Pagamentos")
              .setDescription("> Nenhum pagamento encontrado.");
            return interaction.update({ embeds: [embed], components: [buildMainMenuBackRow()] });
          }

          const statusEmoji = { approved: "✅", pending: "⏳", rejected: "❌", cancelled: "⛔" };
          const paymentOptions = payments.slice(0, 25).map(p => ({
            label: `#${p.id} — ${formatPrice(p.amount)}`,
            description: `${statusEmoji[p.status] || "⭕"} ${p.status.toUpperCase()} | ${new Date(p.created_at).toLocaleDateString('pt-BR')} | <@${p.user_id}>`,
            value: `view_payment_${p.id}`
          }));

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("payment_menu")
              .setPlaceholder("Selecione um pagamento para detalhar...")
              .addOptions(paymentOptions)
          );

          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("💰 Histórico de Pagamentos")
            .setDescription("> Últimos 25 pagamentos registrados.")
            .addFields([
              { name: "✅ Aprovados", value: `${stats?.aprovados || 0}`, inline: true },
              { name: "⏳ Pendentes", value: `${stats?.pendentes || 0}`, inline: true },
              { name: "💵 Receita Total", value: formatPrice(stats?.receita || 0), inline: true },
            ])
            .setFooter({ text: `${config.botName} • Pagamentos` })
            .setTimestamp();

          return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
        }
        
        if (selectedValue === "admin_coupons") {
          const coupons = await listCoupons(interaction.guild.id);

          if (!coupons || coupons.length === 0) {
            const embed = new EmbedBuilder()
              .setColor(config.colors.primary)
              .setTitle(`${config.botName} | Cupons`)
              .setDescription("Nenhum cupom cadastrado.");

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("add_coupon")
                .setLabel("Criar Cupom")
                .setStyle(ButtonStyle.Success)
            );

            return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
          }

          const couponOptions = coupons.slice(0, 25).map(c => ({
            label: `${c.code.toUpperCase()} - ${c.discount_type === 'percentage' ? c.discount_value + '%' : formatPrice(c.discount_value)}`,
            description: `Usos: ${c.used_count}/${c.max_uses || '∞'} | ${c.enabled ? '✅ Ativo' : '❌ Inativo'} | ${c.product_id ? config.products.find(p => p.id === c.product_id)?.name || 'Produto específico' : 'Todos os produtos'}`,
            value: `edit_coupon_${c.id}`
          }));

          couponOptions.push({
            label: "Criar Novo Cupom",
            description: "Criar um novo cupom de desconto",
            value: "add_new_coupon"
          });

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("coupon_menu")
              .setPlaceholder("Selecione um cupom...")
              .addOptions(couponOptions)
          );

          const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${config.botName} | Cupons`)
            .setDescription(`Total de cupons: ${coupons.length}`);

          return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
        }

        if (selectedValue === "admin_invites") {
          const leaderboard = await getInviteLeaderboard(interaction.guild.id, 10);
          const ranking = leaderboard.length
            ? leaderboard.map((row, index) => `${index + 1}. <@${row.user_id}> • Disponíveis: **${getRedeemableInvites(row)}** • Total: **${row.total || 0}** • Fake: **${row.fake || 0}** • Saiu: **${row.left || 0}**`).join("\n")
            : "Nenhum convite registrado ainda.";

          const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${config.botName} | Invites`)
            .setDescription([
              "> Ranking de convites válidos e ferramentas de reset.",
              "",
              ranking
            ].join("\n"));

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("admin_invites_view_user")
              .setLabel("Ver Invites de Usuário")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("admin_invites_detailed")
              .setLabel("Informações Completas")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("admin_invites_set")
              .setLabel("Definir/Resetar")
              .setStyle(ButtonStyle.Secondary)
          );

          return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
        }
        
        if (selectedValue === "admin_settings") {
          const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${config.botName} | Configurações`)
            .setDescription([
              "> Escolha qual área deseja configurar.",
              "",
              "> **Canais:** atendimento, entregas, feedbacks e estatísticas.",
              "> **Pagamento:** PIX, banco, beneficiário e QR Code."
            ].join("\n"));

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("admin_edit_channels")
              .setLabel("Editar Canais")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("admin_edit_payment")
              .setLabel("Editar Pagamento")
              .setStyle(ButtonStyle.Secondary)
          );

          const restartRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("admin_restart_bot")
              .setLabel("Reiniciar Bot")
              .setStyle(ButtonStyle.Danger)
          );

          return interaction.update({ embeds: [embed], components: [row, restartRow, buildMainMenuBackRow()] });
        }
      }

      if (interaction.customId === "invite_user_select") {
        const selectedValue = interaction.values[0];
        const userId = selectedValue.replace("invite_user_", "");

        const stats = await getInviteStats(interaction.guild.id, userId);
        const joins = await all("SELECT * FROM invite_joins WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC", [interaction.guild.id, userId]);

        const member = interaction.guild.members.cache.get(userId);
        const user = member?.user;

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Invites de ${user?.tag || userId}`)
          .setDescription([
            `> **Usuário:** ${user ? `<@${userId}>` : userId}`,
            `> **Total:** ${stats.total || 0}`,
            `> **Disponíveis:** ${getRedeemableInvites(stats)}`,
            `> **Resgatados/Resetados:** ${stats.redeemed || 0}`,
            `> **Fake:** ${stats.fake || 0}`,
            `> **Saiu:** ${stats.left || 0}`,
            `> **Entrou válido:** ${stats.current || 0}`,
            "",
            `> **Últimas entradas (${joins.length} total):**`
          ].join("\n"));

        const recentJoins = joins.slice(0, 10).map((join, index) => {
          const joinedUser = interaction.guild.members.cache.get(join.user_id)?.user;
          const joinedDate = new Date(join.joined_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
          const leftDate = join.left_at ? new Date(join.left_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}) : 'Ainda no servidor';
          return `${index + 1}. ${joinedUser?.tag || join.user_id} - ${join.is_fake ? '🚫 Fake' : '✅ Válido'} - Entrou: ${joinedDate} - Saiu: ${leftDate}`;
        }).join("\n");

        embed.addFields({ name: "Histórico Recente", value: recentJoins || "Nenhuma entrada registrada" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("admin_invites")
            .setLabel("Voltar")
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (interaction.customId === "coupon_menu" || interaction.customId === "coupon_product_select") {
        if (interaction.customId === "coupon_menu") {
          const selectedValue = interaction.values[0];
          
          if (selectedValue === "add_new_coupon") {
            const productOptions = [
              {
                label: "📦 Todos os produtos",
                description: "Cupom válido para qualquer produto",
                value: "coupon_product_all"
              }
            ];

            const bots = config.products.filter(p => p.category === "bots");
            const sites = config.products.filter(p => p.category === "sites");

            bots.forEach(p => {
              productOptions.push({
                label: `🤖 ${p.name} (${p.tier})`,
                description: `Bot - R$ ${p.price.toFixed(2)}`,
                value: `coupon_product_${p.id}`
              });
            });

            sites.forEach(p => {
              productOptions.push({
                label: `🌐 ${p.name} (${p.tier})`,
                description: `Site - R$ ${p.price.toFixed(2)}`,
                value: `coupon_product_${p.id}`
              });
            });

            const row = new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId("coupon_product_select")
                .setPlaceholder("Selecione o produto para o cupom...")
                .addOptions(productOptions.slice(0, 25))
            );

            const embed = new EmbedBuilder()
              .setColor(config.colors.primary)
              .setTitle(`${config.botName} | Selecionar Produto`)
              .setDescription("Escolha para qual produto o cupom será válido. Se selecionar 'Todos os produtos', o cupom funcionará em qualquer compra.");

            return interaction.update({ embeds: [embed], components: [row] });
          }

          if (selectedValue.startsWith("edit_coupon_")) {
            const couponId = selectedValue.replace("edit_coupon_", "");
            const coupon = await get("SELECT * FROM coupons WHERE id = ? AND guild_id = ?", [couponId, interaction.guild.id]);
            
            if (!coupon) {
              return interaction.update({ content: "Cupom não encontrado", components: [] });
            }

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`toggle_coupon_${couponId}`)
                .setLabel(coupon.enabled ? "Desativar" : "Ativar")
                .setStyle(coupon.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`delete_coupon_${couponId}`)
                .setLabel("Deletar")
                .setStyle(ButtonStyle.Danger)
            );

            return interaction.update({
              embeds: [new EmbedBuilder()
                .setColor(config.colors.primary)
                .setTitle(`${config.botName} | Gerenciar Cupom`)
                .setDescription(`**Código:** ${coupon.code.toUpperCase()}
**Tipo:** ${coupon.discount_type === 'percentage' ? 'Porcentagem' : 'Valor fixo'}
**Desconto:** ${coupon.discount_type === 'percentage' ? coupon.discount_value + '%' : formatPrice(coupon.discount_value)}
**Usos:** ${coupon.used_count}/${coupon.max_uses || '∞'}
**Valor mínimo:** ${coupon.min_amount ? formatPrice(coupon.min_amount) : 'N/A'}
**Produto:** ${coupon.product_id ? config.products.find(p => p.id === coupon.product_id)?.name || 'Produto específico' : 'Todos os produtos'}
**Status:** ${coupon.enabled ? '✅ Ativo' : '❌ Inativo'}`)],
              components: [row]
            });
          }
        }

        if (interaction.customId === "coupon_product_select") {
          const selectedValue = interaction.values[0];
          const productId = selectedValue === "coupon_product_all" ? "" : selectedValue.replace("coupon_product_", "");

          const modal = new ModalBuilder()
            .setCustomId(`create_coupon_modal:${productId || "all"}`)
            .setTitle("Criar Cupom");

          const codeInput = new TextInputBuilder()
            .setCustomId("coupon_code")
            .setLabel("Código do cupom")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("Ex: PROMO10");

          const discountTypeInput = new TextInputBuilder()
            .setCustomId("coupon_discount_type")
            .setLabel("Tipo de desconto (percentage/fixed)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue("percentage");

          const discountValueInput = new TextInputBuilder()
            .setCustomId("coupon_discount_value")
            .setLabel("Valor do desconto")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("Ex: 10 (para 10% ou R$ 10)");

          const maxUsesInput = new TextInputBuilder()
            .setCustomId("coupon_max_uses")
            .setLabel("Máximo de usos (opcional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("Ex: 100");

          const minAmountInput = new TextInputBuilder()
            .setCustomId("coupon_min_amount")
            .setLabel("Valor mínimo (opcional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("Ex: 50");

          const firstRow = new ActionRowBuilder().addComponents(codeInput);
          const secondRow = new ActionRowBuilder().addComponents(discountTypeInput);
          const thirdRow = new ActionRowBuilder().addComponents(discountValueInput);
          const fourthRow = new ActionRowBuilder().addComponents(maxUsesInput);
          const fifthRow = new ActionRowBuilder().addComponents(minAmountInput);

          modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);
          return interaction.showModal(modal);
        }
      }

      if (interaction.customId === "payment_menu") {
        const paymentId = interaction.values[0].replace("view_payment_", "");
        const payment = await get("SELECT * FROM payments WHERE id = ?", [paymentId]);
        
        if (!payment) {
          return interaction.update({ content: "Pagamento não encontrado", components: [] });
        }

        const product = config.products.find(p => p.id === payment.product_id);
        const statusEmoji = payment.status === "approved" ? "✅" : payment.status === "pending" ? "⏳" : "❌";

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Detalhes do Pedido #${payment.id}`)
          .setDescription([
            `> **Cliente:** <@${payment.user_id}>`,
            `> **Produto:** ${product?.name || payment.product_id}`,
            `> **Valor:** ${formatPrice(payment.amount)}`,
            `> **Gateway:** ${payment.provider}`,
            `> **Status:** ${statusEmoji} ${payment.status}`,
            `> **Pagamento ID:** ${payment.provider_payment_id || payment.preference_id || "N/A"}`,
            `> **Canal:** <#${payment.channel_id}>`,
            `> **Data:** ${new Date(payment.created_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`
          ].join("\n"));

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("back_to_payments")
            .setLabel("Voltar")
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (interaction.customId === "back_to_payments") {
        const payments = await all("SELECT * FROM payments WHERE guild_id = ? ORDER BY created_at DESC LIMIT 25", [interaction.guild.id]);
        
        if (!payments || payments.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${config.botName} | Pagamentos`)
            .setDescription("Nenhum pagamento encontrado.");
          
          return interaction.update({ embeds: [embed], components: [] });
        }

        const paymentOptions = payments.slice(0, 25).map(p => ({
          label: `Pedido #${p.id} - ${formatPrice(p.amount)}`,
          description: `${p.provider} | ${p.status} | ${new Date(p.created_at).toLocaleDateString('pt-BR')}`,
          value: `view_payment_${p.id}`
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("payment_menu")
            .setPlaceholder("Selecione um pagamento...")
            .addOptions(paymentOptions)
        );

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Pagamentos Recentes`)
          .setDescription(`Total de pagamentos: ${payments.length}`);

        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (interaction.customId === "product_menu") {
        const selectedValue = interaction.values[0];
        
        if (selectedValue === "add_new_product") {
          const modal = new ModalBuilder()
            .setCustomId("add_product_modal")
            .setTitle("Adicionar Produto");

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("product_name")
                .setLabel("Nome do Produto")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("product_price_stock")
                .setLabel("Preço e Estoque (ex: 9.99 | 10)")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("9.99 | 10")
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("product_category_tier")
                .setLabel("Categoria e Tier (ex: bots | premium)")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("bots | premium")
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("product_description")
                .setLabel("Descrição")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("product_delivery_url")
                .setLabel("Link de entrega (vazio = abre ticket)")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("https://... (opcional)")
                .setRequired(false)
            )
          );

          return interaction.showModal(modal);
        }

        if (selectedValue.startsWith("edit_product_")) {
          const productId = selectedValue.replace("edit_product_", "");
          const product = config.products.find(p => p.id === productId);
          
          if (!product) {
            return interaction.update({ content: "Produto não encontrado", components: [] });
          }

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`edit_product_price_${productId}`)
              .setLabel("Editar Preço/Estoque")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`edit_product_delivery_${productId}`)
              .setLabel("Editar Entrega")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`delete_product_${productId}`)
              .setLabel("Deletar Produto")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("admin_products_back")
              .setLabel("Voltar")
              .setStyle(ButtonStyle.Secondary)
          );

          const deliveryStatus = product.deliveryUrl
            ? `✅ Entrega automática: [Link](${product.deliveryUrl})`
            : "❌ Sem entrega automática (abre ticket)";

          return interaction.update({
            embeds: [new EmbedBuilder()
              .setColor(config.colors.primary)
              .setTitle(`${config.botName} | Gerenciar Produto`)
              .setDescription([
                `Gerenciando: **${product.name}**`,
                `Preço: R$ ${product.price.toFixed(2)} | Estoque: ${product.stock}`,
                `Categoria: ${product.category} | Tier: ${product.tier}`,
                "",
                `📦 ${deliveryStatus}`
              ].join("\n"))],
            components: [row]
          });
        }
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "cart_apply_coupon") {
        const modal = new ModalBuilder()
          .setCustomId("coupon_modal")
          .setTitle("Aplicar Cupom");

        const couponInput = new TextInputBuilder()
          .setCustomId("coupon_code")
          .setLabel("Código do cupom")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Ex: DESCONTO10")
          .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(couponInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "select_payment_gateway_menu") {
        console.log("[DEBUG] Botão Fazer Pagamento clicado");
        try {
          await interaction.deferReply({ ephemeral: true });
          const ticket = await listTicketByChannel(interaction.channel.id);
          const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
          if (!product) {
            return interaction.editReply({
              embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")]
            });
          }
          const gatewayRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("select_payment_gateway")
              .setPlaceholder("Selecione o método de pagamento...")
              .addOptions([{ label: "PIX", description: "Pagar com PIX", value: "mercadopago" }])
          );
          await interaction.editReply({
            embeds: [infoEmbed(config, "Selecione o Pagamento", `Escolha o método para **${product.name}**.\n\n**Total:** ${formatPrice(product.price)}`)],
            components: [gatewayRow]
          });
          return;
        } catch (error) {
          console.error("[DEBUG] Erro no handler select_payment_gateway_menu:", error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "Erro ao gerar pagamento.", ephemeral: true });
          }
          return;
        }
      }

      if (interaction.customId === "admin_main_back") {
        const adminMenuRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("admin_menu")
            .setPlaceholder("Selecione uma opção")
            .addOptions([
              { label: "Produtos", description: "Gerenciar produtos", value: "admin_products" },
              { label: "Pagamentos", description: "Ver pagamentos recentes", value: "admin_payments" },
              { label: "Cupons", description: "Gerenciar cupons de desconto", value: "admin_coupons" },
              { label: "Invites", description: "Ranking e ferramentas de invites", value: "admin_invites" },
              { label: "Configurações", description: "Configurar canais e pagamento", value: "admin_settings" }
            ])
        );

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Painel Admin`)
          .setDescription("Selecione uma opção abaixo para gerenciar o servidor.");

        return interaction.update({ embeds: [embed], components: [adminMenuRow] });
      }

      if (interaction.customId === "admin_products_back") {
        const { embed, components } = buildProductAdminView(config, "Selecione um produto para gerenciar ou cadastre um novo item.");
        return interaction.update({ embeds: [embed], components });
      }

      if (interaction.customId === "admin_invites") {
        const leaderboard = await getInviteLeaderboard(interaction.guild.id, 10);
        const ranking = leaderboard.length
          ? leaderboard.map((row, index) => `${index + 1}. <@${row.user_id}> • Disponíveis: **${getRedeemableInvites(row)}** • Total: **${row.total || 0}** • Fake: **${row.fake || 0}** • Saiu: **${row.left || 0}**`).join("\n")
          : "Nenhum convite registrado ainda.";

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Invites`)
          .setDescription([
            "> Ranking de convites válidos e ferramentas de reset.",
            "",
            ranking
          ].join("\n"));

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("admin_invites_view_user")
            .setLabel("Ver Invites de Usuário")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("admin_invites_detailed")
            .setLabel("Informações Completas")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("admin_invites_set")
            .setLabel("Definir/Resetar")
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({ embeds: [embed], components: [row, buildMainMenuBackRow()] });
      }

      if (interaction.customId === "start_config") {
        const modal = new ModalBuilder()
          .setCustomId("initial_config_modal")
          .setTitle("Configuração Inicial");

        const adminRoleInput = new TextInputBuilder()
          .setCustomId("admin_role_id")
          .setLabel("ID do Cargo de Administrador")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const supportRoleInput = new TextInputBuilder()
          .setCustomId("support_role_id")
          .setLabel("ID do Cargo de Suporte")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const salesCategoryInput = new TextInputBuilder()
          .setCustomId("sales_category_id")
          .setLabel("ID da Categoria de Vendas")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const supportCategoryInput = new TextInputBuilder()
          .setCustomId("support_category_id")
          .setLabel("ID da Categoria de Suporte")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const logChannelInput = new TextInputBuilder()
          .setCustomId("log_channel_id")
          .setLabel("ID do Canal de Logs")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(adminRoleInput);
        const secondRow = new ActionRowBuilder().addComponents(supportRoleInput);
        const thirdRow = new ActionRowBuilder().addComponents(salesCategoryInput);
        const fourthRow = new ActionRowBuilder().addComponents(supportCategoryInput);
        const fifthRow = new ActionRowBuilder().addComponents(logChannelInput);

        modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);

        return interaction.showModal(modal);
      }

      if (interaction.customId === "admin_edit_payment") {
        const modal = new ModalBuilder()
          .setCustomId("admin_payment_modal")
          .setTitle("Editar Pagamento");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("payment_pix")
              .setLabel("Chave PIX")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.payment.pix || ""))
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("payment_bank")
              .setLabel("Banco")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.payment.bank || ""))
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("payment_beneficiary")
              .setLabel("Beneficiário")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.payment.beneficiary || ""))
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("payment_qr_code")
              .setLabel("QR Code ou link")
              .setStyle(TextInputStyle.Paragraph)
              .setValue(String(config.payment.qrCode || ""))
              .setRequired(false)
          )
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "admin_invites_view_user") {
        const leaderboard = await getInviteLeaderboard(interaction.guild.id, 25);

        if (!leaderboard || leaderboard.length === 0) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Nenhum invite", "Nenhum convite registrado ainda.")],
            ephemeral: true
          });
        }

        const userOptions = leaderboard.map(row => ({
          label: `${interaction.guild.members.cache.get(row.user_id)?.user?.tag || row.user_id}`,
          description: `Total: ${row.total || 0} | Disponíveis: ${getRedeemableInvites(row)}`,
          value: `invite_user_${row.user_id}`
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("invite_user_select")
            .setPlaceholder("Selecione um usuário...")
            .addOptions(userOptions)
        );

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Selecionar Usuário`)
          .setDescription("Selecione um usuário para ver seus invites.");

        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (interaction.customId === "admin_invites_detailed") {
        const allJoins = await all("SELECT * FROM invite_joins WHERE guild_id = ? ORDER BY joined_at DESC", [interaction.guild.id]);

        if (!allJoins || allJoins.length === 0) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Nenhum dado", "Nenhum convite registrado ainda.")],
            ephemeral: true
          });
        }

        const content = allJoins.map(join => {
          const user = interaction.guild.members.cache.get(join.user_id)?.user;
          const inviter = interaction.guild.members.cache.get(join.inviter_id)?.user;
          const joinedDate = new Date(join.joined_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
          const leftDate = join.left_at ? new Date(join.left_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}) : 'Ainda no servidor';

          return [
            `Usuário: ${user?.tag || join.user_id} (${join.user_id})`,
            `Convidado por: ${inviter?.tag || join.inviter_id || 'Desconhecido'} (${join.inviter_id || 'N/A'})`,
            `Código do invite: ${join.invite_code || 'N/A'}`,
            `Conta fake: ${join.is_fake ? 'Sim' : 'Não'}`,
            `Entrou em: ${joinedDate}`,
            `Saiu em: ${leftDate}`,
            ''
          ].join('\n');
        }).join('\n');

        const chunks = content.match(/[\s\S]{1,1900}/g) || [];

        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${config.botName} | Informações Completas de Invites`)
            .setDescription(`Total de registros: ${allJoins.length}`)
          ],
          ephemeral: true
        });

        for (const chunk of chunks) {
          await interaction.followUp({ content: chunk, ephemeral: true });
        }

        return;
      }

      if (interaction.customId === "admin_invites_set") {
        const modal = new ModalBuilder()
          .setCustomId("admin_invites_set_modal")
          .setTitle("Definir Invites Resetados");

        const userInput = new TextInputBuilder()
          .setCustomId("invite_user_id")
          .setLabel("ID ou menção do usuário")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const amountInput = new TextInputBuilder()
          .setCustomId("invite_amount")
          .setLabel("Quantidade já resetada/resgatada")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("Ex: 5");

        modal.addComponents(
          new ActionRowBuilder().addComponents(userInput),
          new ActionRowBuilder().addComponents(amountInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "add_coupon") {
        const productOptions = [
          {
            label: "📦 Todos os produtos",
            description: "Cupom válido para qualquer produto",
            value: "coupon_product_all"
          }
        ];

        const bots = config.products.filter(p => p.category === "bots");
        const sites = config.products.filter(p => p.category === "sites");

        bots.forEach(p => {
          productOptions.push({
            label: `🤖 ${p.name} (${p.tier})`,
            description: `Bot - R$ ${p.price.toFixed(2)}`,
            value: `coupon_product_${p.id}`
          });
        });

        sites.forEach(p => {
          productOptions.push({
            label: `🌐 ${p.name} (${p.tier})`,
            description: `Site - R$ ${p.price.toFixed(2)}`,
            value: `coupon_product_${p.id}`
          });
        });

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("coupon_product_select")
            .setPlaceholder("Selecione o produto para o cupom...")
            .addOptions(productOptions.slice(0, 25))
        );

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`${config.botName} | Selecionar Produto`)
          .setDescription("Escolha para qual produto o cupom será válido. Se selecionar 'Todos os produtos', o cupom funcionará em qualquer compra.");

        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (interaction.customId.startsWith("toggle_coupon_")) {
        const couponId = interaction.customId.replace("toggle_coupon_", "");
        const coupon = await get("SELECT * FROM coupons WHERE id = ? AND guild_id = ?", [couponId, interaction.guild.id]);
        
        if (!coupon) {
          return interaction.reply({ content: "Cupom não encontrado", ephemeral: true });
        }

        const { updateCoupon } = require("../utils/coupons");
        await updateCoupon(couponId, { enabled: !coupon.enabled });

        await interaction.reply({
          embeds: [successEmbed(config, "Cupom atualizado", `Cupom **${coupon.code.toUpperCase()}** foi ${!coupon.enabled ? 'ativado' : 'desativado'}.`)],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId.startsWith("delete_coupon_")) {
        const couponId = interaction.customId.replace("delete_coupon_", "");
        const coupon = await get("SELECT * FROM coupons WHERE id = ? AND guild_id = ?", [couponId, interaction.guild.id]);
        
        if (!coupon) {
          return interaction.reply({ content: "Cupom não encontrado", ephemeral: true });
        }

        await deleteCoupon(couponId);

        await interaction.reply({
          embeds: [successEmbed(config, "Cupom deletado", `Cupom **${coupon.code.toUpperCase()}** foi deletado.`)],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId.startsWith("edit_product_delivery_")) {
        const productId = interaction.customId.replace("edit_product_delivery_", "");
        const product = config.products.find(p => p.id === productId);
        
        if (!product) {
          return interaction.reply({ content: "Produto não encontrado", ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`edit_delivery_modal_${productId}`)
          .setTitle(`Entrega: ${product.name}`.slice(0, 45));

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("delivery_url")
              .setLabel("Link de entrega (deixe vazio para remover)")
              .setStyle(TextInputStyle.Paragraph)
              .setValue(product.deliveryUrl || "")
              .setRequired(false)
              .setPlaceholder("https://drive.google.com/... ou link do produto")
          )
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("edit_product_price_")) {
        const productId = interaction.customId.replace("edit_product_price_", "");
        const product = config.products.find(p => p.id === productId);
        
        if (!product) {
          return interaction.reply({ content: "Produto não encontrado", ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`edit_product_modal_${productId}`)
          .setTitle(`Editar ${product.name}`);

        const priceInput = new TextInputBuilder()
          .setCustomId("product_price")
          .setLabel("Preço (R$)")
          .setStyle(TextInputStyle.Short)
          .setValue(product.price.toString())
          .setRequired(true);

        const stockInput = new TextInputBuilder()
          .setCustomId("product_stock")
          .setLabel("Estoque")
          .setStyle(TextInputStyle.Short)
          .setValue(product.stock.toString())
          .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(priceInput);
        const secondRow = new ActionRowBuilder().addComponents(stockInput);

        modal.addComponents(firstRow, secondRow);

        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("delete_product_")) {
        const productId = interaction.customId.replace("delete_product_", "");
        const product = config.products.find(p => p.id === productId);
        
        if (!product) {
          return interaction.reply({ content: "Produto não encontrado", ephemeral: true });
        }

        const configPath = require("path").join(__dirname, "..", "config.json");
        const fs = require("fs");
        const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
        
        const productIndex = configData.products.findIndex(p => p.id === productId);
        if (productIndex === -1) {
          return interaction.reply({ content: "Produto não encontrado", ephemeral: true });
        }

        configData.products.splice(productIndex, 1);
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

        await interaction.reply({
          embeds: [successEmbed(config, "Produto deletado", `Produto ${product.name} deletado com sucesso! O bot precisa ser reiniciado para aplicar as mudanças. Clique em Voltar para editar outro produto.`)],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId === "admin_edit_channels") {
        const modal = new ModalBuilder()
          .setCustomId("admin_channels_modal")
          .setTitle("Editar Canais");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("ticket_panel_channel_id")
              .setLabel("Canal de atendimento")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.ticketPanelChannelId || ""))
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("bot_delivery_channel_id")
              .setLabel("Canal de entregas de bots")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.deliveryChannels?.bots || ""))
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("site_delivery_channel_id")
              .setLabel("Canal de entregas de sites")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.deliveryChannels?.sites || ""))
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("feedback_channel_id")
              .setLabel("Canal de feedbacks")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.feedbackChannelId || ""))
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("stats_channel_id")
              .setLabel("Canal de estatísticas")
              .setStyle(TextInputStyle.Short)
              .setValue(String(config.statsChannelId || ""))
              .setRequired(true)
          )
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "admin_restart_bot") {
        const embed = new EmbedBuilder()
          .setColor(config.colors.danger)
          .setTitle(`${config.botName} | Reiniciar Bot`)
          .setDescription([
            "> Confirme apenas se você estiver usando um gerenciador de processo.",
            "> Se o bot foi iniciado com `node .`, ele será desligado e você precisará ligar manualmente.",
            "",
            "> Deseja reiniciar agora?"
          ].join("\n"))
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("admin_restart_confirm")
            .setLabel("Confirmar Reinício")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("admin_restart_cancel")
            .setLabel("Cancelar")
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({
          embeds: [embed],
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === "admin_restart_cancel") {
        return interaction.update({
          embeds: [successEmbed(config, "Reinício cancelado", "Nenhuma ação foi executada.")],
          components: []
        });
      }

      if (interaction.customId === "admin_restart_confirm") {
        await interaction.update({
          embeds: [successEmbed(config, "Reiniciando", "O processo do bot será encerrado em instantes.")],
          components: []
        });

        setTimeout(() => {
          process.exit(0);
        }, 1500);
        return;
      }

      if (interaction.customId === "cart_read_terms") {
        const ticket = await listTicketByChannel(interaction.channel.id);
        const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
        if (!product) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")],
            ephemeral: true
          });
        }

        return interaction.reply({
          embeds: [buildTermsEmbed(config, interaction.user, product)],
          ephemeral: true
        });
      }

      if (interaction.customId === "cart_accept_terms") {
        const ticket = await listTicketByChannel(interaction.channel.id);
        const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
        if (!product) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Produto não encontrado", "Não foi possível identificar o produto deste carrinho.")],
            ephemeral: true
          });
        }

        const acceptedAt = Date.now();
        const termsSnapshot = buildTermsSnapshot(interaction.user, product);
        await run(
          "UPDATE tickets SET terms_accepted_at = ?, terms_snapshot = ? WHERE channel_id = ?",
          [acceptedAt, termsSnapshot, interaction.channel.id]
        );

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("cart_apply_coupon")
            .setLabel("Aplicar Cupom")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("select_payment_gateway_menu")
            .setLabel("Fazer Pagamento")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("ticket_cancel_purchase")
            .setLabel("Cancelar")
            .setStyle(ButtonStyle.Danger)
        );

        const cartEmbed = buildCartEmbed(config, interaction.user, product);
        cartEmbed.setDescription(
          `Termos aceitos em **${new Date(acceptedAt).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})}**.\n\n` +
          "Clique em **Fazer Pagamento** para gerar o PIX."
        );

        await interaction.message.edit({
          embeds: [cartEmbed],
          components: [confirmRow]
        });

        await interaction.deferUpdate();
        return;
      }

      if (interaction.customId === "verify_button") {
        const { channelId, unverifiedRoleId, verifiedRoleId } = config.verification;

        if (interaction.channelId !== channelId) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Canal incorreto", "Use este botão apenas no canal de verificação.")],
            ephemeral: true
          });
        }

        const member = interaction.member;
        const unverifiedRole = await interaction.guild.roles.fetch(unverifiedRoleId).catch(() => null);
        const verifiedRole = await interaction.guild.roles.fetch(verifiedRoleId).catch(() => null);

        if (!unverifiedRole || !verifiedRole) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Configuração de erro", "Cargos de verificação não configurados corretamente.")],
            ephemeral: true
          });
        }

        if (member.roles.cache.has(verifiedRoleId)) {
          return interaction.reply({
            embeds: [infoEmbed(config, "Já verificado", "Você já está verificado e tem acesso ao servidor.")],
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });

        await interaction.editReply({
          embeds: [
            infoEmbed(
              config,
              "🔍 Verificando...",
              "Por favor, aguarde enquanto verificamos sua conta..."
            )
          ]
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        const verificationResult = await performVerification(member, config);

        if (!verificationResult.success) {
          return interaction.editReply({
            embeds: [
              dangerEmbed(
                config,
                "❌ Verificação Falhou",
                verificationResult.reason
              )
            ]
          });
        }

        try {
          
          await member.roles.remove(unverifiedRole);
          await member.roles.add(verifiedRole);

          const resultsText = formatVerificationResults(verificationResult.results);

          await interaction.editReply({
            embeds: [
              successEmbed(
                config,
                "✅ Verificação Concluída com Sucesso",
                [
                  "Bem-vindo ao servidor! Você agora tem acesso a todos os canais.",
                  "",
                  "### 📋 Resultado da Verificação:",
                  resultsText,
                  "",
                  " Aproveite sua estadia!"
                ].join("\n")
              )
            ]
          });

          await logSecurityEvent(
            interaction.client,
            config,
            "Verificação Concluída",
            member.id,
            {
              description: `Usuário ${member.user.tag} foi verificado com sucesso via botão.`,
              fields: [
                { name: "Usuário", value: `${member.user.tag}`, inline: true },
                { name: "Cargo", value: `<@&${verifiedRoleId}>`, inline: true },
                { name: "Resultados", value: resultsText.substring(0, 100) + "...", inline: false }
              ]
            }
          );
          await logSeguranca(interaction.client, config, {
            evento: "Usuário Verificado",
            userId: member.id,
            detalhes: `${member.user.tag} passou pela verificação com sucesso.`,
          }).catch(() => null);
        } catch (error) {
          console.error("Erro ao verificar usuário:", error);
          return interaction.editReply({
            embeds: [
              dangerEmbed(
                config,
                "Erro na verificação",
                "Não foi possível completar a verificação. Contate um administrador."
              )
            ]
          });
        }
      }

      if (interaction.customId === "ticket_claim") {
        const settings = await getSettings(interaction.guild.id) || {};

        const member = interaction.member;
        const hasSupportRole = settings.support_role_id && member.roles.cache.has(settings.support_role_id);
        if (!hasSupportRole && !member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Sem permissão", "Apenas staff pode assumir tickets.")],
            ephemeral: true
          });
        }

        const channel = interaction.channel;
        await channel.send({
          content: `🎫 **Ticket assumido por ${member.user.tag}**`
        });

        await interaction.reply({
          embeds: [successEmbed(config, "Ticket assumido", "Você assumiu este ticket com sucesso.")],
          ephemeral: true
        });
      }

      if (interaction.customId === "ticket_confirm_purchase") {
        const pendingPayment = await getPendingPaymentByChannel(interaction.channel.id);
        if (pendingPayment) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Pagamento pendente", "Aguarde a confirmação automática do PIX antes de finalizar a compra.")],
            ephemeral: true
          });
        }

        const ticket = await listTicketByChannel(interaction.channel.id);
        const product = ticket?.product_id ? config.products.find((p) => p.id === ticket.product_id) : null;
        const deliveryChannelId = product?.category === "sites" ? config.deliveryChannels?.sites : config.deliveryChannels?.bots;
        const deliveryChannel = deliveryChannelId ? await interaction.client.channels.fetch(deliveryChannelId).catch(() => null) : null;
        const channel = interaction.channel;

        await channel.send({
          content: "**Compra finalizada.** Sua solicitação foi registrada e a entrega será acompanhada pela equipe."
        });

        if (deliveryChannel?.send && product) {
          await deliveryChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(config.colors.success)
                .setTitle(`${config.botName} | Compra Realizada`)
                .setDescription([
                  `> **Cliente:** <@${ticket.user_id}>`,
                  `> **Produto:** ${product.name}`,
                  `> **Valor:** ${formatPrice(product.price)}`,
                  `> **Canal:** <#${interaction.channel.id}>`
                ].join("\n"))
                .setTimestamp()
            ]
          });
        }

        await logTicketEvent(interaction.client, config, "Compra Finalizada", interaction.channel.id, {
          description: `Compra finalizada no canal ${interaction.channel.name}.`,
          fields: [
            { name: "Produto", value: product?.name || "Não identificado", inline: true },
            { name: "Cliente", value: ticket?.user_id ? `<@${ticket.user_id}>` : "Não identificado", inline: true },
            { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true }
          ]
        });

        await sendPurchaseAuditLog(interaction, config, ticket, product).catch((error) => {
          console.error("Erro ao enviar registro de compra:", error);
        });

        await interaction.reply({
          embeds: [successEmbed(config, "Compra finalizada", "A entrega foi registrada no canal correto.")],
          ephemeral: true
        });
      }

      if (interaction.customId === "order_open_delivery_ticket") {
        const payment = await get("SELECT * FROM payments WHERE channel_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1", [interaction.channel.id]);
        if (!payment) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Pedido não encontrado", "Não foi possível encontrar o pedido aprovado neste carrinho.")],
            ephemeral: true
          });
        }

        const existingDeliveryTicket = await get("SELECT channel_id FROM tickets WHERE user_id = ? AND type = 'delivery' AND status = 'open' LIMIT 1", [interaction.user.id]);
        if (existingDeliveryTicket) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Ticket já existe", "Você já possui um ticket de entrega aberto: <#" + existingDeliveryTicket.channel_id + ">.")],
            ephemeral: true
          });
        }

        const result = await createTicket({
          guild: interaction.guild,
          member: interaction.member,
          type: "delivery",
          config,
          productId: payment.product_id,
          paymentId: payment.id
        });

        if (result.error) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Erro ao criar ticket", result.error)],
            ephemeral: true
          });
        }

        await interaction.reply({
          embeds: [successEmbed(config, "Ticket de entrega criado", "Seu ticket de entrega foi aberto: <#" + result.channel.id + ">.")],
          ephemeral: true
        });
      }

      if (interaction.customId === "order_copy_summary") {
        const payment = await get("SELECT * FROM payments WHERE channel_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1", [interaction.channel.id]);
        if (!payment) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Pedido não encontrado", "Não foi possível encontrar o pedido aprovado neste carrinho.")],
            ephemeral: true
          });
        }

        const product = config.products.find(p => p.id === payment.product_id);
        const summary = [
          `ID do Pedido: #${payment.id}`,
          `Produto: ${product?.name || payment.product_id}`,
          `Valor: ${formatPrice(payment.amount)}`,
          `Pagamento: ${payment.provider_payment_id || payment.preference_id || "N/A"}`,
          `Data: ${new Date(payment.created_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`
        ].join("\n");

        return interaction.reply({
          content: "📋 **Resumo do Pedido**\n```\n" + summary + "\n```",
          ephemeral: true
        });
      }

      if (interaction.customId === "order_close_cart") {
        const ticket = await listTicketByChannel(interaction.channel.id);
        if (!ticket || ticket.user_id !== interaction.user.id) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Sem permissão", "Apenas o cliente deste carrinho pode fechar o carrinho.")],
            ephemeral: true
          });
        }

        const channel = interaction.channel;
        await channel.send({
          embeds: [dangerEmbed(config, "Carrinho fechado", "Este carrinho será fechado em 3 segundos.")]
        });

        await interaction.reply({
          embeds: [successEmbed(config, "Carrinho encerrado", "O carrinho foi fechado com sucesso.")],
          ephemeral: true
        });

        setTimeout(() => {
          channel.delete("Carrinho fechado pelo cliente").catch(() => null);
        }, 3000);
      }

      if (interaction.customId === "ticket_cancel_purchase") {
        const ticket = await listTicketByChannel(interaction.channel.id);
        if (!ticket || ticket.user_id !== interaction.user.id) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Sem permissão", "Apenas o cliente deste carrinho pode cancelar a compra.")],
            ephemeral: true
          });
        }

        const channel = interaction.channel;
        await channel.send({
          embeds: [dangerEmbed(config, "Compra cancelada", "Este carrinho será fechado em 3 segundos.")]
        });

        await interaction.reply({
          embeds: [successEmbed(config, "Carrinho encerrado", "A compra foi cancelada com sucesso.")],
          ephemeral: true
        });

        setTimeout(() => {
          channel.delete("Compra cancelada pelo cliente").catch(() => null);
        }, 3000);
      }

      if (interaction.customId === "ticket_close") {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("ticket_close_confirm")
            .setLabel("Confirmar fechamento")
            .setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({
          embeds: [infoEmbed(config, "<a:atencaocc:1472985634678505603> Confirmação <a:atencaocc:1472985634678505603>", "Deseja realmente fechar este ticket?")],
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === "ticket_close_confirm") {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: true });
        }

        const ticketData = await listTicketByChannel(interaction.channel.id);
        const shouldRequestRating = ticketData?.type === "support";
        const result = await closeTicket(interaction.channel, interaction.user.id, config, {
          requestRating: shouldRequestRating
        });
        if (result.error) {
          return interaction.editReply({
            embeds: [dangerEmbed(config, "Erro", result.error)],
          });
        }

        await interaction.editReply({
          embeds: [
            successEmbed(
              config,
              "Fechamento iniciado",
              shouldRequestRating
                ? "Ticket encerrado. Aguarde a avaliação."
                : "Ticket encerrado sem solicitação de avaliação."
            )
          ]
        });

        const settings = await getSettings(interaction.guild.id);
        const logChannel = settings ? interaction.guild.channels.cache.get(settings.log_channel_id) : null;
        await logToDb(interaction.guild.id, "info", "Ticket fechado", {
          channelId: interaction.channel.id,
          userId: interaction.user.id
        });
        const durationText = formatDuration(Date.now() - result.ticket.created_at);
        await logToChannel(logChannel, config, "info", "Ticket encerrado.", {
          title: `${config.botName} | Ticket fechado`,
          fields: [
            { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true },
            { name: "Usuario", value: `<@${result.ticket.user_id}>`, inline: true },
            { name: "Staff", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Duração", value: durationText, inline: true },
            { name: "Avaliação", value: shouldRequestRating ? "Aguardando usuário" : "Não solicitada", inline: true },
            { name: "Transcrição", value: "Não disponível", inline: true }
          ],
          footer: "BznX Store • Logs"
        });

        await logTicketEvent(
          interaction.client,
          config,
          "Ticket Fechado",
          interaction.channel.id,
          {
            description: `Ticket fechado por ${interaction.user.tag}.`,
            fields: [
              { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true },
              { name: "Usuário", value: `<@${result.ticket.user_id}>`, inline: true },
              { name: "Staff", value: `<@${interaction.user.id}>`, inline: true },
              { name: "Duração", value: durationText, inline: true }
            ]
          }
        );
      }

      if (interaction.customId.startsWith("ticket_rate_")) {
        const rating = Number(interaction.customId.split("_").pop());
        const result = await registerRating(interaction.channel, rating, config);
        if (result.error) {
          return interaction.reply({
            embeds: [dangerEmbed(config, "Erro", result.error)],
            ephemeral: true
          });
        }

        await interaction.reply({
          embeds: [successEmbed(config, "Avaliação recebida", `Nota registrada: ${rating} estrelas.`)],
          ephemeral: true
        });

        const settings = await getSettings(interaction.guild.id);
        const logChannel = settings ? interaction.guild.channels.cache.get(settings.log_channel_id) : null;
        await logToDb(interaction.guild.id, "info", "Avaliação registrada", {
          channelId: interaction.channel.id,
          userId: result.ticket.user_id,
          rating
        });
        await logToChannel(logChannel, config, "info", "Avaliação recebida.", {
          title: `${config.botName} | Feedback`,
          fields: [
            { name: "Canal", value: `<#${interaction.channel.id}>`, inline: true },
            { name: "Usuário", value: `<@${result.ticket.user_id}>`, inline: true },
            { name: "Nota", value: formatStars(rating), inline: true }
          ],
          footer: "BznX Store • Logs"
        });

        await logFeedbackEvent(
          interaction.client,
          config,
          rating,
          interaction.channel.id,
          result.ticket.user_id
        );
      }

    }
    } catch (error) {
      console.error('[INTERACTION ERROR]', error);
      throw error;
    }
  }
};
