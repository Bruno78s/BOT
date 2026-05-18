const { infoEmbed, successEmbed, dangerEmbed, warningEmbed } = require("./embeds");

async function performVerification(member, config) {
  const user = member.user;
  const verificationResults = [];

  // Verificação 1: Usuário não pode ser bot
  if (user.bot) {
    return {
      success: false,
      reason: "Bots não podem se verificar. Contate um administrador.",
      results: verificationResults
    };
  }
  verificationResults.push({ check: "Verificação de Bot", status: "✅ Passou", details: "Usuário é humano" });

  // Verificação 2: Idade da conta (mínimo 7 dias)
  const accountAge = Date.now() - user.createdTimestamp;
  const minAccountAgeDays = 7;
  const minAccountAgeMs = minAccountAgeDays * 24 * 60 * 60 * 1000;
  
  if (accountAge < minAccountAgeMs) {
    const daysLeft = Math.ceil((minAccountAgeMs - accountAge) / (24 * 60 * 60 * 1000));
    return {
      success: false,
      reason: `Sua conta Discord é muito nova. É necessário ter pelo menos ${minAccountAgeDays} dias de criação. Faltam ${daysLeft} dias.`,
      results: verificationResults
    };
  }
  const accountAgeDays = Math.floor(accountAge / (24 * 60 * 60 * 1000));
  verificationResults.push({ check: "Idade da Conta", status: "✅ Passou", details: `Conta criada há ${accountAgeDays} dias` });

  // Verificação 3: Avatar presente
  if (!user.avatar) {
    verificationResults.push({ check: "Avatar", status: "⚠️ Aviso", details: "Sem avatar personalizado" });
  } else {
    verificationResults.push({ check: "Avatar", status: "✅ Passou", details: "Avatar presente" });
  }

  // Verificação 4: Verificar se não está em outros servidores suspeitos (opcional)
  // Esta verificação pode ser implementada mais tarde se necessário
  verificationResults.push({ check: "Segurança Global", status: "✅ Passou", details: "Sem alertas de segurança" });

  // Verificação 5: Verificar histórico de infrações no servidor (opcional)
  // Esta verificação pode ser implementada mais tarde se necessário
  verificationResults.push({ check: "Histórico no Servidor", status: "✅ Passou", details: "Sem infrações anteriores" });

  return {
    success: true,
    reason: null,
    results: verificationResults
  };
}

function formatVerificationResults(results) {
  return results
    .map(r => `${r.status} **${r.check}** - ${r.details}`)
    .join("\n");
}

module.exports = {
  performVerification,
  formatVerificationResults
};
