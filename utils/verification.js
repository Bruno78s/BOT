function getMinAccountAgeDays(config) {
  return Number(process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS || config.verification?.minAccountAgeDays || 7);
}

function getAccountAgeDays(user) {
  return Math.floor((Date.now() - user.createdTimestamp) / (24 * 60 * 60 * 1000));
}

function hasSuspiciousUsername(user) {
  const name = `${user.username || ""} ${user.globalName || ""}`.toLowerCase();
  const suspiciousPatterns = [
    /discord\.gg/i,
    /free\s*(nitro|gift|skin|robux)/i,
    /steamcommunity/i,
    /airdrop/i,
    /http(s)?:\/\//i
  ];
  return suspiciousPatterns.some((pattern) => pattern.test(name));
}

async function performVerification(member, config) {
  const user = member.user;
  const verificationResults = [];
  const minAccountAgeDays = getMinAccountAgeDays(config);
  const accountAgeDays = getAccountAgeDays(user);

  if (user.bot) {
    return {
      success: false,
      reason: "Bots não podem se verificar. Contate um administrador.",
      results: verificationResults
    };
  }
  verificationResults.push({ check: "Conta humana", status: "✅ Passou", details: "Usuário não é bot" });

  if (accountAgeDays < minAccountAgeDays) {
    const daysLeft = Math.max(1, minAccountAgeDays - accountAgeDays);
    verificationResults.push({
      check: "Idade da conta",
      status: "❌ Reprovou",
      details: `Conta criada há ${accountAgeDays} dia(s)`
    });
    return {
      success: false,
      reason: `Sua conta Discord é muito nova. É necessário ter pelo menos ${minAccountAgeDays} dias de criação. Faltam ${daysLeft} dia(s).`,
      results: verificationResults
    };
  }
  verificationResults.push({ check: "Idade da conta", status: "✅ Passou", details: `Conta criada há ${accountAgeDays} dia(s)` });

  if (!user.avatar) {
    verificationResults.push({ check: "Avatar", status: "⚠️ Atenção", details: "Sem avatar personalizado" });
  } else {
    verificationResults.push({ check: "Avatar", status: "✅ Passou", details: "Avatar personalizado encontrado" });
  }

  if (hasSuspiciousUsername(user)) {
    verificationResults.push({ check: "Nome público", status: "❌ Reprovou", details: "Nome contém link ou termo suspeito" });
    return {
      success: false,
      reason: "Sua conta possui sinais suspeitos no nome público. Ajuste seu perfil e tente novamente.",
      results: verificationResults
    };
  }
  verificationResults.push({ check: "Nome público", status: "✅ Passou", details: "Sem links ou termos suspeitos" });

  verificationResults.push({ check: "Segurança", status: "✅ Passou", details: "Nenhum bloqueio automático encontrado" });

  return {
    success: true,
    reason: null,
    results: verificationResults
  };
}

function formatVerificationResults(results) {
  return results
    .map((result) => `${result.status} **${result.check}** - ${result.details}`)
    .join("\n");
}

module.exports = {
  performVerification,
  formatVerificationResults,
  getMinAccountAgeDays,
  getAccountAgeDays
};
