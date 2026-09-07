function parseDiagnostics(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function activeProviders(snapshot) {
  const diagnostics = parseDiagnostics(snapshot?.diagnostics_json);
  if (!diagnostics) return null;
  return Object.entries(diagnostics)
    .filter(([, value]) => value?.ok === true)
    .map(([name]) => name)
    .sort();
}

export function comparableCoverage(latest, previous) {
  if (!latest || !previous) return false;
  const latestCount = Number(latest.active_provider_count || 0);
  const previousCount = Number(previous.active_provider_count || 0);
  if (latestCount <= 0 || previousCount <= 0) return false;

  const latestProviders = activeProviders(latest);
  const previousProviders = activeProviders(previous);
  if (latestProviders && previousProviders) {
    return latestProviders.join('|') === previousProviders.join('|');
  }
  return latestCount === previousCount;
}

export function growthPercent(current, previous) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function classifyMomentum({ latest, previous, newArticleCount = 0 }) {
  if (!latest || Number(latest.active_provider_count || 0) === 0) {
    return { status: 'unavailable', growthPercent: null, comparable: false };
  }
  if (!previous) {
    return { status: 'learning', growthPercent: null, comparable: false };
  }

  const comparable = comparableCoverage(latest, previous);
  if (!comparable) {
    return { status: 'coverage_changed', growthPercent: null, comparable: false };
  }

  const growth = growthPercent(Number(latest.article_count || 0), Number(previous.article_count || 0));
  if ((growth !== null && growth >= 20) || newArticleCount >= 8) {
    return { status: 'rising', growthPercent: growth, comparable: true };
  }
  if (growth !== null && growth <= -20) {
    return { status: 'cooling', growthPercent: growth, comparable: true };
  }
  if (newArticleCount > 0) {
    return { status: 'active', growthPercent: growth, comparable: true };
  }
  return { status: 'stable', growthPercent: growth, comparable: true };
}

export function explainMomentum(result) {
  switch (result.status) {
    case 'rising': return 'La cobertura se está acelerando frente a la captura anterior comparable.';
    case 'cooling': return 'La cobertura perdió intensidad frente a la captura anterior comparable.';
    case 'active': return 'El tema sigue activo y sumó resultados nuevos.';
    case 'stable': return 'No hubo un cambio relevante de intensidad en la muestra comparable.';
    case 'coverage_changed': return 'Cambió la cobertura técnica de proveedores; no se compara intensidad.';
    case 'learning': return 'Todavía falta una segunda captura comparable para medir tendencia.';
    default: return 'No hay cobertura suficiente para interpretar este monitoreo.';
  }
}
