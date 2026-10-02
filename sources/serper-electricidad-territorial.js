import { CABA_BARRIOS, findBarrioExact } from '../data/caba-barrios.js';

export const TERRITORIAL_QUERY_TEMPLATES = [
  { id: 'sin_luz', text: 'sin luz' },
  { id: 'corte_luz', text: 'corte de luz' }
];

function safeDomain(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function canonicalUrl(url = '') {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '').replace(/[?#].*$/, '');
  }
}

function timeFilter(span) {
  if (span === '1w') return 'qdr:w';
  if (span === '3d') return 'qdr:d3';
  return 'qdr:d';
}

export function selectTerritorialBatch({ now = new Date(), batchSize = 12 } = {}) {
  const size = Math.max(1, Math.min(CABA_BARRIOS.length, Number(batchSize) || 12));
  const bucketCount = Math.ceil(CABA_BARRIOS.length / size);
  const hourNumber = Math.floor(now.getTime() / 3600000);
  const bucketIndex = ((hourNumber % bucketCount) + bucketCount) % bucketCount;
  const start = bucketIndex * size;
  return {
    bucketIndex,
    bucketCount,
    barrios: CABA_BARRIOS.slice(start, start + size)
  };
}

function resolveRequestedBarrios(names = []) {
  const resolved = [];
  for (const name of names) {
    const barrio = typeof name === 'string' ? findBarrioExact(name) : name;
    if (barrio && !resolved.some((item) => item.name === barrio.name)) resolved.push(barrio);
  }
  return resolved;
}

export function buildTerritorialPlan({ barrios = null, now = new Date(), batchSize = 12, templates = TERRITORIAL_QUERY_TEMPLATES } = {}) {
  const selected = Array.isArray(barrios) && barrios.length
    ? { bucketIndex: null, bucketCount: null, barrios: resolveRequestedBarrios(barrios) }
    : selectTerritorialBatch({ now, batchSize });

  const queries = [];
  for (const barrio of selected.barrios) {
    for (const template of templates) {
      queries.push({
        id: `${template.id}:${barrio.name}`,
        templateId: template.id,
        targetBarrio: barrio.name,
        targetComuna: barrio.comuna,
        q: `${template.text} ${barrio.name} CABA`
      });
    }
  }

  return { ...selected, queries };
}

async function searchOne(item, span, apiKey, fetchImpl) {
  const response = await fetchImpl('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q: item.q, gl: 'ar', hl: 'es', num: 10, tbs: timeFilter(span) })
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Serper territorial HTTP ${response.status}: ${raw.slice(0, 180)}`);
  const data = JSON.parse(raw);
  const organic = Array.isArray(data.organic) ? data.organic : [];
  const articles = organic.map((result) => {
    const url = canonicalUrl(result.link || '');
    return {
      title: result.title || '',
      snippet: result.snippet || '',
      url,
      source: safeDomain(url),
      provider: 'Google Web Territorial (Serper)',
      date: result.date || '',
      sourceType: 'territorial_web',
      query: item.q,
      queryTemplateId: item.templateId,
      targetBarrio: item.targetBarrio,
      targetComuna: item.targetComuna
    };
  }).filter((result) => result.title && result.url);

  return { ...item, rawCount: organic.length, articles };
}

export async function fetchSerperElectricidadTerritorial(span = '1d', apiKey = '', options = {}, fetchImpl = fetch) {
  if (!apiKey) {
    return {
      articles: [],
      diagnostics: { disabled: true, reason: 'SERPER_API_KEY no configurada' },
      plan: buildTerritorialPlan(options),
      disabled: true
    };
  }

  const plan = buildTerritorialPlan(options);
  const settled = await Promise.allSettled(plan.queries.map((item) => searchOne(item, span, apiKey, fetchImpl)));
  const articles = [];
  const diagnostics = [];

  settled.forEach((result, index) => {
    const item = plan.queries[index];
    if (result.status === 'fulfilled') {
      articles.push(...result.value.articles);
      diagnostics.push({ q: item.q, targetBarrio: item.targetBarrio, templateId: item.templateId, ok: true, rawCount: result.value.rawCount });
    } else {
      diagnostics.push({ q: item.q, targetBarrio: item.targetBarrio, templateId: item.templateId, ok: false, error: String(result.reason?.message || result.reason) });
    }
  });

  const seen = new Set();
  const deduped = articles.filter((article) => {
    const key = `${article.targetBarrio}|${canonicalUrl(article.url).toLowerCase()}`;
    if (!article.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    articles: deduped,
    diagnostics,
    plan: {
      bucketIndex: plan.bucketIndex,
      bucketCount: plan.bucketCount,
      barrios: plan.barrios.map((b) => ({ name: b.name, comuna: b.comuna })),
      queryCount: plan.queries.length
    },
    disabled: false
  };
}
