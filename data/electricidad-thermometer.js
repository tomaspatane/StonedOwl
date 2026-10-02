const STATUS_ORDER = ['verde', 'amarillo', 'naranja', 'rojo'];

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function statusFromScore(score = 0) {
  if (score >= 65) return 'rojo';
  if (score >= 40) return 'naranja';
  if (score >= 20) return 'amarillo';
  return 'verde';
}

function statusRank(status) {
  const rank = STATUS_ORDER.indexOf(status);
  return rank >= 0 ? rank : 0;
}

function scoreForStatus(rawScore, status) {
  const score = Math.max(0, Math.min(100, Number(rawScore) || 0));
  if (status === 'verde') return Math.min(score, 19);
  if (status === 'amarillo') return Math.max(20, Math.min(score, 39));
  if (status === 'naranja') return Math.max(40, Math.min(score, 64));
  return Math.max(65, score);
}

function sourceIdentity(mention = {}) {
  if (mention.sourceType === 'citizen' || mention.sourceType === 'territorial_web') {
    if (mention.author) return `${mention.provider || mention.sourceType}:${mention.author}`;
    if (mention.url) return `${mention.sourceType}:${normalize(String(mention.url).replace(/[?#].*$/, ''))}`;
  }
  return mention.source || mention.provider || mention.url || mention.title || '';
}

function isOfficial(mention = {}) {
  return Boolean(mention.official || mention.sourceType === 'official' || normalize(mention.provider).includes('enre'));
}

function isScheduledOfficial(mention = {}) {
  if (!isOfficial(mention)) return false;
  const text = normalize([
    mention.enreType,
    mention.title,
    mention.snippet,
    ...(mention.signalPhrases || [])
  ].filter(Boolean).join(' '));
  return /\bprogramad[oa]\b|\bprogramado\b/.test(text);
}

function isStrongLocal(mention = {}) {
  return ['direct_local_report', 'local_report'].includes(mention.evidenceQuality);
}

function isWeakLocal(mention = {}) {
  return mention.evidenceQuality === 'weak_local_report';
}

function independentCount(mentions = []) {
  return new Set(mentions.map(sourceIdentity).filter(Boolean)).size;
}

function sumAffected(mentions = []) {
  return mentions.reduce((sum, mention) => sum + (Number(mention.affectedUsers) || 0), 0);
}

export function calibrateElectricityRow(row = {}) {
  const evidence = Array.isArray(row.evidence) ? row.evidence : [];
  const rawScore = Math.max(0, Math.min(100, Number(row.score) || 0));
  const baseStatus = statusFromScore(rawScore);
  const reasons = [];

  if (!evidence.length) {
    return {
      ...row,
      rawScore,
      score: 0,
      status: 'verde',
      confidence: 'baja',
      calibrationVersion: 'electricidad-v1',
      guardrailApplied: rawScore > 0,
      statusReasonCodes: ['sin_evidencia_util'],
      evidenceSummary: {
        independentSources: 0,
        strongLocalSources: 0,
        officialRecords: 0,
        affectedUsersUnplanned: 0,
        affectedUsersScheduled: 0
      }
    };
  }

  const official = evidence.filter(isOfficial);
  const scheduled = official.filter(isScheduledOfficial);
  const unplanned = official.filter((mention) => !isScheduledOfficial(mention));
  const strong = evidence.filter((mention) => !isOfficial(mention) && isStrongLocal(mention));
  const weak = evidence.filter((mention) => !isOfficial(mention) && isWeakLocal(mention));

  const independentSources = independentCount(evidence);
  const strongIndependent = independentCount(strong);
  const affectedUsersUnplanned = sumAffected(unplanned);
  const affectedUsersScheduled = sumAffected(scheduled);
  const hasOfficial = official.length > 0;
  const hasUnplannedOfficial = unplanned.length > 0;
  const hasScheduledOnly = scheduled.length > 0 && unplanned.length === 0;
  const maxWeakWeight = weak.reduce((max, mention) => Math.max(max, Number(mention.maxWeight) || 0), 0);

  let floorRank = 0;
  let ceilingRank = 3;

  if (strongIndependent >= 1) {
    floorRank = Math.max(floorRank, 1);
    reasons.push('reporte_local_fuerte');
  }
  if (strongIndependent >= 2) {
    floorRank = Math.max(floorRank, 2);
    reasons.push('dos_fuentes_locales_independientes');
  }

  if (weak.length > 0 && strong.length === 0 && !hasOfficial && maxWeakWeight >= 4) {
    floorRank = Math.max(floorRank, 1);
    ceilingRank = Math.min(ceilingRank, 1);
    reasons.push('incidente_local_infraestructura_sin_impacto_confirmado');
  }

  if (hasScheduledOnly) {
    floorRank = Math.max(floorRank, 1);
    if (affectedUsersScheduled >= 2000) {
      floorRank = Math.max(floorRank, 2);
      ceilingRank = Math.min(ceilingRank, 2);
      reasons.push('corte_programado_masivo');
    } else {
      ceilingRank = Math.min(ceilingRank, 1);
      reasons.push('corte_programado_confirmado');
    }
  }

  if (hasUnplannedOfficial) {
    floorRank = Math.max(floorRank, 1);
    reasons.push('incidente_oficial_confirmado');
    if (affectedUsersUnplanned >= 250) {
      floorRank = Math.max(floorRank, 2);
      reasons.push('impacto_oficial_250_mas_usuarios');
    }
    if (affectedUsersUnplanned >= 5000) {
      floorRank = Math.max(floorRank, 3);
      reasons.push('impacto_oficial_5000_mas_usuarios');
    }
  }

  if (hasOfficial && strongIndependent >= 1) {
    floorRank = Math.max(floorRank, 2);
    reasons.push('reporte_ciudadano_mas_confirmacion_oficial');
  }

  const orangeAllowed =
    (hasUnplannedOfficial && affectedUsersUnplanned >= 250) ||
    (hasScheduledOnly && affectedUsersScheduled >= 2000) ||
    (hasOfficial && strongIndependent >= 1) ||
    strongIndependent >= 2;

  if (!orangeAllowed) {
    ceilingRank = Math.min(ceilingRank, 1);
    if (statusRank(baseStatus) >= 2) reasons.push('guardrail_naranja_requiere_corrobacion');
  }

  const redAllowed =
    affectedUsersUnplanned >= 5000 ||
    (hasUnplannedOfficial && strongIndependent >= 2 && independentSources >= 3 && rawScore >= 65) ||
    (!hasOfficial && strongIndependent >= 5 && rawScore >= 65);

  if (!redAllowed) {
    ceilingRank = Math.min(ceilingRank, 2);
    if (statusRank(baseStatus) >= 3) reasons.push('guardrail_rojo_requiere_crisis_corrobada');
  }

  let finalRank = statusRank(baseStatus);
  finalRank = Math.max(finalRank, floorRank);
  finalRank = Math.min(finalRank, ceilingRank);
  const status = STATUS_ORDER[finalRank];

  let confidence = 'baja';
  if (hasOfficial || strongIndependent >= 3) confidence = 'alta';
  else if (strongIndependent >= 2) confidence = 'media';

  const score = scoreForStatus(rawScore, status);
  const guardrailApplied = status !== baseStatus || score !== rawScore;

  if (!reasons.length) reasons.push('score_sin_override');

  return {
    ...row,
    rawScore,
    score,
    status,
    confidence,
    calibrationVersion: 'electricidad-v1',
    guardrailApplied,
    statusReasonCodes: [...new Set(reasons)],
    evidenceSummary: {
      independentSources,
      strongLocalSources: strongIndependent,
      officialRecords: official.length,
      scheduledOfficialRecords: scheduled.length,
      unplannedOfficialRecords: unplanned.length,
      weakLocalRecords: weak.length,
      affectedUsersUnplanned,
      affectedUsersScheduled
    }
  };
}

export function calibrateElectricityRadar(radar = []) {
  return radar.map(calibrateElectricityRow).sort((a, b) => b.score - a.score || (b.mentions || 0) - (a.mentions || 0));
}
