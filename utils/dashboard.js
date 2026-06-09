/**
 * Dashboard em Tempo Real - Estatísticas e métricas
 */

const { get, all } = require('../database/db');
const { EmbedBuilder } = require('discord.js');

class Dashboard {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minuto
  }

  /**
   * Obtém estatísticas do dia
   */
  async getDailyStats() {
    const cacheKey = 'daily';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.time < this.cacheTimeout) {
        return cached.data;
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const stats = get(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(amount), 0) as total_revenue,
        COUNT(DISTINCT user_id) as unique_customers
      FROM payments 
      WHERE status = 'approved' 
      AND created_at >= ?
    `, [todayTimestamp]);

    const result = {
      sales: stats?.total_sales || 0,
      revenue: stats?.total_revenue || 0,
      customers: stats?.unique_customers || 0,
      timestamp: Date.now()
    };

    this.cache.set(cacheKey, { data: result, time: Date.now() });
    return result;
  }

  /**
   * Obtém estatísticas da semana
   */
  async getWeeklyStats() {
    const cacheKey = 'weekly';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.time < this.cacheTimeout) {
        return cached.data;
      }
    }

    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    const stats = get(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(amount), 0) as total_revenue
      FROM payments 
      WHERE status = 'approved' 
      AND created_at >= ?
    `, [weekAgo]);

    const result = {
      sales: stats?.total_sales || 0,
      revenue: stats?.total_revenue || 0,
      timestamp: Date.now()
    };

    this.cache.set(cacheKey, { data: result, time: Date.now() });
    return result;
  }

  /**
   * Top produtos vendidos
   */
  async getTopProducts(limit = 5) {
    const products = all(`
      SELECT 
        product_id,
        COUNT(*) as sales_count,
        SUM(amount) as revenue
      FROM payments 
      WHERE status = 'approved'
      GROUP BY product_id
      ORDER BY sales_count DESC
      LIMIT ?
    `, [limit]);

    return products || [];
  }

  /**
   * Estatísticas de invites
   */
  async getInviteStats() {
    const stats = get(`
      SELECT 
        SUM(total) as total_invites,
        SUM(current) as active_invites,
        SUM(fake) as fake_invites
      FROM invite_stats
    `);

    return {
      total: stats?.total_invites || 0,
      active: stats?.active_invites || 0,
      fake: stats?.fake_invites || 0
    };
  }

  /**
   * Status do estoque
   */
  getStockStatus() {
    const products = this.config.products || [];
    const total = products.length;
    const outOfStock = products.filter(p => p.stock === 0).length;
    const lowStock = products.filter(p => p.stock > 0 && p.stock < 5).length;

    return {
      total,
      outOfStock,
      lowStock,
      healthy: total - outOfStock - lowStock
    };
  }

  /**
   * Gera embed completo do dashboard
   */
  async generateDashboardEmbed() {
    const [daily, weekly, invites, stock] = await Promise.all([
      this.getDailyStats(),
      this.getWeeklyStats(),
      this.getInviteStats(),
      this.getStockStatus()
    ]);

    const formatPrice = (val) => `R$ ${(val || 0).toFixed(2)}`;

    return new EmbedBuilder()
      .setColor(this.config.colors.primary)
      .setTitle(`${this.config.botName} | Dashboard em Tempo Real`)
      .setDescription('📊 Estatísticas atualizadas automaticamente')
      .addFields(
        {
          name: '📈 Hoje',
          value: [
            `Vendas: **${daily.sales}**`,
            `Receita: **${formatPrice(daily.revenue)}**`,
            `Clientes: **${daily.customers}**`
          ].join('\n'),
          inline: true
        },
        {
          name: '📊 Últimos 7 Dias',
          value: [
            `Vendas: **${weekly.sales}**`,
            `Receita: **${formatPrice(weekly.revenue)}**`
          ].join('\n'),
          inline: true
        },
        {
          name: '📨 Convites',
          value: [
            `Total: **${invites.total}**`,
            `Ativos: **${invites.active}**`,
            `Fake: **${invites.fake}**`
          ].join('\n'),
          inline: true
        },
        {
          name: '📦 Estoque',
          value: [
            `Total: **${stock.total}**`,
            `Esgotado: **${stock.outOfStock}** ⚠️`,
            `Baixo: **${stock.lowStock}** ⚡`,
            `OK: **${stock.healthy}** ✅`
          ].join('\n'),
          inline: false
        }
      )
      .setFooter({ text: `Atualizado: ${new Date().toLocaleTimeString('pt-BR')}` })
      .setTimestamp();
  }

  /**
   * Limpa cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = Dashboard;
