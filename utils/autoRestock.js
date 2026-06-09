/**
 * Sistema de Restock Automático
 * Repõe estoque automaticamente quando necessário
 */

const { EmbedBuilder } = require('discord.js');
const { readConfigFile, writeConfigFile } = require('./salesFlow');
const StockPrediction = require('./stockPrediction');

class AutoRestock {
  constructor(config, client) {
    this.config = config;
    this.client = client;
    this.prediction = new StockPrediction(config);
    this.enabled = process.env.AUTO_RESTOCK_ENABLED === 'true';
    this.threshold = parseInt(process.env.AUTO_RESTOCK_THRESHOLD) || 5;
    this.defaultQuantity = parseInt(process.env.AUTO_RESTOCK_QUANTITY) || 20;
  }

  /**
   * Verifica produtos que precisam de restock
   */
  async checkRestockNeeded() {
    if (!this.enabled) {
      return { success: false, message: 'Restock automático desabilitado' };
    }

    const alerts = await this.prediction.generateStockAlert();
    const productsToRestock = [
      ...alerts.details.critical,
      ...alerts.details.high.filter(p => p.daysRemaining <= this.threshold)
    ];

    return {
      success: true,
      needsRestock: productsToRestock.length > 0,
      products: productsToRestock,
      count: productsToRestock.length
    };
  }

  /**
   * Executa restock de um produto
   */
  async restockProduct(productId, quantity = null) {
    try {
      const config = readConfigFile();
      const productIndex = config.products.findIndex(p => p.id === productId);
      
      if (productIndex === -1) {
        throw new Error('Produto não encontrado');
      }

      const product = config.products[productIndex];
      const restockQty = quantity || this.defaultQuantity;
      const previousStock = product.stock;
      
      // Atualizar estoque
      config.products[productIndex].stock += restockQty;
      
      // Salvar configuração
      writeConfigFile(config);
      
      // Atualizar config local
      this.config.products[productIndex].stock += restockQty;

      return {
        success: true,
        product: product.name,
        previousStock,
        newStock: config.products[productIndex].stock,
        added: restockQty,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[AUTO_RESTOCK] Erro ao reabastecer:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Executa restock automático para todos os produtos necessários
   */
  async runAutoRestock() {
    const check = await this.checkRestockNeeded();
    
    if (!check.needsRestock) {
      return { success: true, message: 'Nenhum produto precisa de restock', restocked: [] };
    }

    const results = [];
    const errors = [];

    for (const product of check.products) {
      // Calcular quantidade sugerida baseada na velocidade de venda
      const suggestion = await this.prediction.suggestRestockQuantity(product.productId, 30);
      const quantity = Math.max(suggestion.suggestedQuantity, this.defaultQuantity);
      
      const result = await this.restockProduct(product.productId, quantity);
      
      if (result.success) {
        results.push(result);
      } else {
        errors.push({ product: product.productName, error: result.error });
      }
    }

    return {
      success: errors.length === 0,
      message: `Restock concluído: ${results.length} produtos`,
      restocked: results,
      errors: errors.length > 0 ? errors : null
    };
  }

  /**
   * Notifica admin sobre restock realizado
   */
  async notifyRestock(channelId, results) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setColor(this.config.colors.success)
        .setTitle('🔄 Restock Automático Concluído')
        .setDescription(`${results.restocked.length} produtos foram reabastecidos`)
        .addFields(
          results.restocked.map(r => ({
            name: r.product,
            value: `De ${r.previousStock} → **${r.newStock}** (+${r.added})`,
            inline: true
          }))
        )
        .setTimestamp();

      if (results.errors) {
        embed.addFields({
          name: '⚠️ Erros',
          value: results.errors.map(e => `• ${e.product}: ${e.error}`).join('\n'),
          inline: false
        });
      }

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[AUTO_RESTOCK] Erro ao notificar:', error);
    }
  }

  /**
   * Gera embed de configuração
   */
  getConfigEmbed() {
    return new EmbedBuilder()
      .setColor(this.config.colors.primary)
      .setTitle('🔧 Configuracao de Restock Automatico')
      .addFields(
        {
          name: 'Status',
          value: this.enabled ? '✅ Ativado' : '❌ Desativado',
          inline: true
        },
        {
          name: 'Limite',
          value: `${this.threshold} dias de estoque restante`,
          inline: true
        },
        {
          name: 'Quantidade Padrão',
          value: `${this.defaultQuantity} unidades`,
          inline: true
        }
      )
      .setDescription('Para ativar, defina no .env:\n\nAUTO_RESTOCK_ENABLED=true\nAUTO_RESTOCK_THRESHOLD=5\nAUTO_RESTOCK_QUANTITY=20')
      .setTimestamp();
  }
}

module.exports = AutoRestock;
