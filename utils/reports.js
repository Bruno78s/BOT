/**
 * Sistema de Relatórios Automáticos
 * Gera e envia relatórios diários/semanais
 */

const { EmbedBuilder } = require('discord.js');
const { all, get } = require('../database/db');

class ReportSystem {
  constructor(config) {
    this.config = config;
  }

  /**
   * Gera relatório diário
   */
  async generateDailyReport() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const yesterdayStart = yesterday.getTime();
    const yesterdayEnd = yesterdayStart + (24 * 60 * 60 * 1000);

    // Vendas do dia
    const sales = get(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as revenue,
        COUNT(DISTINCT user_id) as customers
      FROM payments 
      WHERE status = 'approved' 
      AND created_at >= ? AND created_at < ?
    `, [yesterdayStart, yesterdayEnd]);

    // Produtos mais vendidos
    const topProducts = all(`
      SELECT product_id, COUNT(*) as count
      FROM payments 
      WHERE status = 'approved' AND created_at >= ? AND created_at < ?
      GROUP BY product_id
      ORDER BY count DESC
      LIMIT 3
    `, [yesterdayStart, yesterdayEnd]);

    // Novos convites
    const invites = get(`
      SELECT COUNT(*) as count
      FROM invite_joins
      WHERE joined_at >= ? AND joined_at < ?
    `, [yesterdayStart, yesterdayEnd]);

    const dateStr = yesterday.toLocaleDateString('pt-BR');
    
    return new EmbedBuilder()
      .setColor(this.config.colors.success)
      .setTitle(`📊 Relatório Diário - ${dateStr}`)
      .setDescription('Resumo do dia anterior')
      .addFields(
        {
          name: '💰 Vendas',
          value: [
            `Total: **${sales?.count || 0}**`,
            `Receita: **R$ ${((sales?.revenue || 0)).toFixed(2)}**`,
            `Clientes: **${sales?.customers || 0}**`
          ].join('\n'),
          inline: true
        },
        {
          name: '📨 Convites',
          value: `Novos: **${invites?.count || 0}**`,
          inline: true
        },
        {
          name: '🔥 Top Produtos',
          value: topProducts.length > 0 
            ? topProducts.map((p, i) => `${i+1}. ${p.product_id}: ${p.count}`).join('\n')
            : 'Nenhuma venda',
          inline: false
        }
      )
      .setTimestamp();
  }

  /**
   * Gera relatório semanal
   */
  async generateWeeklyReport() {
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    // Estatísticas da semana
    const stats = get(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(amount), 0) as total_revenue,
        AVG(amount) as avg_ticket,
        COUNT(DISTINCT user_id) as unique_customers
      FROM payments 
      WHERE status = 'approved' AND created_at >= ?
    `, [weekAgo]);

    // Comparar com semana anterior
    const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
    const lastWeek = get(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as revenue
      FROM payments 
      WHERE status = 'approved' AND created_at >= ? AND created_at < ?
    `, [twoWeeksAgo, weekAgo]);

    const salesGrowth = lastWeek?.count > 0 
      ? ((stats?.total_sales - lastWeek.count) / lastWeek.count * 100).toFixed(1)
      : 0;

    return new EmbedBuilder()
      .setColor(this.config.colors.primary)
      .setTitle('📈 Relatório Semanal')
      .setDescription('Últimos 7 dias')
      .addFields(
        {
          name: '💰 Performance',
          value: [
            `Vendas: **${stats?.total_sales || 0}**`,
            `Receita: **R$ ${(stats?.total_revenue || 0).toFixed(2)}**`,
            `Ticket Médio: **R$ ${(stats?.avg_ticket || 0).toFixed(2)}**`,
            `Clientes: **${stats?.unique_customers || 0}**`
          ].join('\n'),
          inline: true
        },
        {
          name: '📊 Crescimento',
          value: `vs Semana Anterior: **${salesGrowth > 0 ? '+' : ''}${salesGrowth}%**`,
          inline: true
        }
      )
      .setTimestamp();
  }

  /**
   * Gera relatório de estoque
   */
  generateStockReport() {
    const products = this.config.products || [];
    const critical = products.filter(p => p.stock === 0);
    const low = products.filter(p => p.stock > 0 && p.stock < 5);

    return new EmbedBuilder()
      .setColor(this.config.colors.warning)
      .setTitle('⚠️ Relatório de Estoque')
      .setDescription('Produtos que precisam de atenção')
      .addFields(
        {
          name: '❌ Esgotado',
          value: critical.length > 0
            ? critical.map(p => `• ${p.name}`).join('\n').substring(0, 1000)
            : 'Nenhum',
          inline: false
        },
        {
          name: '⚡ Estoque Baixo',
          value: low.length > 0
            ? low.map(p => `• ${p.name} (${p.stock} restantes)`).join('\n').substring(0, 1000)
            : 'Nenhum',
          inline: false
        }
      )
      .setTimestamp();
  }

  /**
   * Envia relatório para canal
   */
  async sendReport(channel, type = 'daily') {
    try {
      let embed;
      
      switch (type) {
        case 'daily':
          embed = await this.generateDailyReport();
          break;
        case 'weekly':
          embed = await this.generateWeeklyReport();
          break;
        case 'stock':
          embed = this.generateStockReport();
          break;
        default:
          throw new Error('Tipo de relatório inválido');
      }

      await channel.send({ embeds: [embed] });
      return { success: true };
    } catch (error) {
      console.error('[REPORTS] Erro ao enviar relatório:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ReportSystem;
