function getMinAccountAgeDays(config) {
  return Number(process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS || config.verification?.minAccountAgeDays || 7);
}

function getManualReviewScore(config) {
  return Number(process.env.VERIFICATION_MANUAL_REVIEW_SCORE || config.verification?.manualReviewScore || 65);
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
    /http(s)?:\/\//i,
    /(.)\1{6,}/i,
    /[|]{3,}|_{5,}/i
  ];
  return suspiciousPatterns.some((pattern) => pattern.test(name));
}

function hasDefaultAvatar(user) {
  return !user.avatar;
}

function calculateVerificationRisk(member, config) {
  const user = member.user;
  const minAccountAgeDays = getMinAccountAgeDays(config);
  const accountAgeDays = getAccountAgeDays(user);
  const results = [];
  let score = 0;

  if (user.bot) {
    score += 100;
    results.push({ check: "Conta humana", status: "❌ Reprovou", details: "Bots não podem usar o portal" });
  } else {
    results.push({ check: "Conta humana", status: "✅ Passou", details: "Usuário não é bot" });
  }

  if (accountAgeDays < minAccountAgeDays) {
    score += 70;
    results.push({ check: "Idade da conta", status: "❌ Reprovou", details: `Conta criada há ${accountAgeDays} dia(s)` });
  } else if (accountAgeDays < minAccountAgeDays * 2) {
    score += 20;
    results.push({ check: "Idade da conta", status: "⚠️ Atenção", details: `Conta recente: ${accountAgeDays} dia(s)` });
  } else {
    results.push({ check: "Idade da conta", status: "✅ Passou", details: `Conta criada há ${accountAgeDays} dia(s)` });
  }

  if (hasDefaultAvatar(user)) {
    score += 15;
    results.push({ check: "Avatar", status: "⚠️ Atenção", details: "Sem avatar personalizado" });
  } else {
    results.push({ check: "Avatar", status: "✅ Passou", details: "Avatar personalizado encontrado" });
  }

  if (hasSuspiciousUsername(user)) {
    score += 45;
    results.push({ check: "Nome público", status: "❌ Reprovou", details: "Nome contém link, promessa falsa ou padrão suspeito" });
  } else {
    results.push({ check: "Nome público", status: "✅ Passou", details: "Sem links ou termos suspeitos" });
  }

  const joinedRecently = member.joinedTimestamp && Date.now() - member.joinedTimestamp < 30 * 1000;
  if (joinedRecently) {
    score += 5;
    results.push({ check: "Entrada", status: "ℹ️ Monitorado", details: "Verificação feita logo após entrada" });
  }

  const cappedScore = Math.min(score, 100);
  results.push({ check: "Score de risco", status: cappedScore >= 65 ? "⚠️ Revisão" : "✅ Baixo", details: `${cappedScore}/100` });

  return { score: cappedScore, results, accountAgeDays, minAccountAgeDays };
}

async function performVerification(member, config) {
  const risk = calculateVerificationRisk(member, config);
  const manualReviewScore = getManualReviewScore(config);

  if (member.user.bot) {
    return {
      success: false,
      reason: "Bots não podem se verificar. Contate um administrador.",
      results: risk.results,
      score: risk.score
    };
  }

  if (risk.accountAgeDays < risk.minAccountAgeDays) {
    const daysLeft = Math.max(1, risk.minAccountAgeDays - risk.accountAgeDays);
    return {
      success: false,
      reason: `Sua conta Discord é muito nova. É necessário ter pelo menos ${risk.minAccountAgeDays} dias de criação. Faltam ${daysLeft} dia(s).`,
      results: risk.results,
      score: risk.score
    };
  }

  if (risk.score >= manualReviewScore) {
    return {
      success: false,
      reason: "Sua conta foi enviada para revisão manual por sinais de risco. Abra um ticket se achar que isso foi um engano.",
      results: risk.results,
      score: risk.score
    };
  }

  return {
    success: true,
    reason: null,
    results: risk.results,
    score: risk.score
  };
}

function formatVerificationResults(results) {
  return results
    .map((result) => `${result.status} **${result.check}** - ${result.details}`)
    .join("\n");
}

module.exports = {
  calculateVerificationRisk,
  performVerification,
  formatVerificationResults,
  getMinAccountAgeDays,
  getAccountAgeDays
};
