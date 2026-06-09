/**
 * Sistema de Previsão de Estoque
 * Analisa histórico de vendas e prevê quando repor
 */

const { all, get } = require('../database/db');

class StockPrediction {
  constructor(config) {
    this.config = config;
  }

  /**
   * Analisa vendas de um produto nos últimos dias
   */
  async analyzeProductSales(productId, days = 30) {
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);

    const sales = all(`
      SELECT 
        DATE(created_at/1000, 'unixepoch') as date,
        COUNT(*) as count
      FROM payments 
      WHERE product_id = ? 
      AND status = 'approved'
      AND created_at >= ?
      GROUP BY DATE(created_at/1000, 'unixepoch')
      ORDER BY date
    `, [productId, since]);

    return sales || [];
  }

  /**
   * Calcula velocidade de venda (unidades por dia)
   */
  async calculateSalesVelocity(productId, days = 30) {
    const sales = await this.analyzeProductSales(productId, days);
    
    if (sales.length === 0) return 0;
    
    const totalSold = sales.reduce((sum, s) => sum + s.count, 0);
    const avgPerDay = totalSold / days;
    
    return avgPerDay;
  }

  /**
   * Previsão de esgotamento
   */
  async predictStockout(productId) {
    const product = this.config.products.find(p => p.id === productId);
    if (!product) return null;

    const currentStock = product.stock;
    if (currentStock === 0) {
      return { status: 'out', daysRemaining: 0, urgency: 'critical' };
    }

    const velocity = await this.calculateSalesVelocity(productId, 14); // Últimos 14 dias
    
    if (velocity === 0) {
      return { status: 'stable', daysRemaining: Infinity, velocity: 0, urgency: 'low' };
    }

    const daysRemaining = Math.floor(currentStock / velocity);
    
    let urgency = 'low';
    if (daysRemaining <= 3) urgency = 'critical';
    else if (daysRemaining <= 7) urgency = 'high';
    else if (daysRemaining <= 14) urgency = 'medium';

    return {
      productId,
      productName: product.name,
      currentStock,
      velocity: velocity.toFixed(2),
      daysRemaining,
      status: daysRemaining <= 7 ? 'warning' : 'stable',
      urgency,
      predictedDate: new Date(Date.now() + (daysRemaining * 24 * 60 * 60 * 1000)).toLocaleDateString('pt-BR')
    };
  }

  /**
   * Analisa todos os produtos
   */
  async analyzeAllProducts() {
    const predictions = [];
    
    for (const product of this.config.products) {
      const prediction = await this.predictStockout(product.id);
      if (prediction) {
        predictions.push(prediction);
      }
    }

    // Ordenar por urgência
    const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    predictions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    return predictions;
  }

  /**
   * Sugere quantidade para repor
   */
  suggestRestockQuantity(productId, daysToCover = 30) {
    return new Promise(async (resolve) => {
      const velocity = await this.calculateSalesVelocity(productId, 30);
      const suggested = Math.ceil(velocity * daysToCover);
      
      resolve({
        productId,
        suggestedQuantity: Math.max(suggested, 5), // Mínimo 5 unidades
        daysOfCoverage: daysToCover,
        basedOnVelocity: velocity.toFixed(2)
      });
    });
  }

  /**
   * Gera alerta de estoque
   */
  async generateStockAlert() {
    const predictions = await this.analyzeAllProducts();
    
    const critical = predictions.filter(p => p.urgency === 'critical');
    const high = predictions.filter(p => p.urgency === 'high');
    const medium = predictions.filter(p => p.urgency === 'medium');

    return {
      summary: {
        critical: critical.length,
        high: high.length,
        medium: medium.length,
        total: predictions.length
      },
      details: {
        critical,
        high,
        medium
      },
      timestamp: Date.now()
    };
  }

  /**
   * Relatório completo de previsão
   */
  async generatePredictionReport() {
    const alert = await this.generateStockAlert();
    const suggestions = [];

    // Sugerir reposição para produtos críticos
    for (const product of alert.details.critical) {
      const suggestion = await this.suggestRestockQuantity(product.productId);
      suggestions.push({
        ...product,
        suggestion: suggestion
      });
    }

    return {
      alert,
      suggestions,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = StockPrediction;
