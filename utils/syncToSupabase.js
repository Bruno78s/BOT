/**
 * Sincronização de dados do bot para o Supabase do site
 * Roda periodicamente para manter site e bot sincronizados
 */

const { isSupabaseEnabled, getSupabase } = require('./supabase');
const { all, get } = require('../database/db');

async function syncToSupabase() {
  if (!isSupabaseEnabled()) {
    return { success: false, message: 'Supabase não configurado' };
  }
  
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, message: 'Falha ao conectar ao Supabase' };
  }
  
  const results = {
    payments: 0,
    invites: 0,
    errors: []
  };
  
  try {
    // 1. Sincronizar pagamentos pendentes
    const pendingPayments = await all(
      "SELECT * FROM payments WHERE status = 'pending' AND synced = 0 OR synced IS NULL"
    );
    
    for (const payment of pendingPayments) {
      try {
        const { error } = await supabase
          .from('payments')
          .upsert({
            id: payment.id,
            guild_id: payment.guild_id,
            channel_id: payment.channel_id,
            user_id: payment.user_id,
            product_id: payment.product_id,
            provider: payment.provider,
            provider_payment_id: payment.provider_payment_id,
            preference_id: payment.preference_id,
            status: payment.status,
            amount: payment.amount,
            checkout_url: payment.checkout_url,
            created_at: new Date(payment.created_at).toISOString(),
            updated_at: payment.updated_at ? new Date(payment.updated_at).toISOString() : null,
            source: 'discord_bot'
          }, {
            onConflict: 'id'
          });
        
        if (error) throw error;
        
        // Marcar como sincronizado
        await get(
          "UPDATE payments SET synced = 1 WHERE id = ?",
          [payment.id]
        );
        
        results.payments++;
      } catch (err) {
        results.errors.push(`Payment ${payment.id}: ${err.message}`);
      }
    }
    
    // 2. Sincronizar invites
    const inviteStats = await all("SELECT * FROM invite_stats");
    
    for (const stat of inviteStats) {
      try {
        const { error } = await supabase
          .from('discord_invites')
          .upsert({
            guild_id: stat.guild_id,
            user_id: stat.user_id,
            total: stat.total || 0,
            current: stat.current || 0,
            fake: stat.fake || 0,
            left: stat.left || 0,
            redeemed: stat.redeemed || 0,
            updated_at: new Date(stat.updated_at).toISOString()
          }, {
            onConflict: 'guild_id,user_id'
          });
        
        if (error) throw error;
        results.invites++;
      } catch (err) {
        results.errors.push(`Invite ${stat.user_id}: ${err.message}`);
      }
    }
    
    // 3. Buscar pagamentos aprovados do site para atualizar local
    const { data: sitePayments, error: siteError } = await supabase
      .from('payments')
      .select('*')
      .eq('status', 'approved')
      .eq('source', 'website')
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (!siteError && sitePayments) {
      for (const payment of sitePayments) {
        // Verificar se já existe local
        const existing = await get(
          "SELECT * FROM payments WHERE provider_payment_id = ?",
          [payment.provider_payment_id]
        );
        
        if (!existing) {
          // Inserir pagamento do site no bot
          await get(
            `INSERT INTO payments (
              guild_id, channel_id, user_id, product_id, provider,
              provider_payment_id, preference_id, status, amount,
              checkout_url, created_at, synced
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              payment.guild_id || process.env.GUILD_ID,
              payment.channel_id || 'website',
              payment.user_id,
              payment.product_id,
              payment.provider || 'mercadopago',
              payment.provider_payment_id,
              payment.preference_id,
              'approved',
              payment.amount,
              payment.checkout_url,
              new Date(payment.created_at).getTime(),
              1
            ]
          );
        }
      }
    }
    
    return {
      success: true,
      message: `Sincronizado: ${results.payments} pagamentos, ${results.invites} invites`,
      results
    };
    
  } catch (error) {
    return {
      success: false,
      message: `Erro na sincronização: ${error.message}`,
      results
    };
  }
}

module.exports = {
  syncToSupabase
};
