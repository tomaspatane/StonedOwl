import { detectBarrios, normalizePlaceText } from './caba-barrios.js';
import { evidenceDateStatus } from './electricidad-evidence.js';

// Editorial leads are independent from thermometer thresholds. They do not establish
// current outage status, growth, government responsibility or independent corroboration.
export function buildEditorialCases({ signals = [], evaluations = [], now = Date.now(), span = '1d' } = {}) {
  const inputs = signals.map(article => ({ article, accepted: true }));
  for (const item of evaluations) {
    const article = item.article || item;
    const classification = item.classification || item;
    if (classification.acceptedForBarrio) continue;
    const text = normalizePlaceText(`${article.title || ''} ${article.snippet || ''}`);
    const reasons = classification.reasonCodes || [];
    if (reasons.some(r => ['commercial_result', 'index_result', 'conflicting_non_caba_title'].includes(r))) continue;
    // Recover a narrow, observed reporting formulation as a lead for reading the source.
    if (!/sin suministro electrico|interrupciones en el servicio electrico/.test(text)) continue;
    if (!detectBarrios(text).length) continue;
    if (evidenceDateStatus(article.date, now, span) !== 'recent') continue;
    inputs.push({ article, accepted: false });
  }
  const seen = new Set();
  return inputs.flatMap(({ article, accepted }) => {
    let url;
    try { url = new URL(article.url); } catch { return []; }
    if (!['http:', 'https:'].includes(url.protocol)) return [];
    const official = article.official === true || article.evidenceQuality === 'official';
    const barrios = article.barrio ? [article.barrio] : (article.barrios || detectBarrios(`${article.title || ''} ${article.snippet || ''}`)).map(b => b.name);
    if (!barrios.length) return [];
    const key = official ? `${url.href}|${barrios.join('|')}|${article.enreType}|${article.title}|${article.snippet}` : url.origin + url.pathname;
    if (seen.has(key)) return [];
    seen.add(key);
    const dateStatus = official ? 'official_snapshot' : evidenceDateStatus(article.date, now, span);
    const dated = official || dateStatus === 'recent';
    const pending = !accepted || !dated;
    return [{
      id: key, topic: 'Electricidad', barrios,
      title: article.title || 'Problema eléctrico reportado',
      reportedFact: article.snippet || article.title || '',
      evidenceStatus: pending ? 'por_verificar' : 'fuente_identificada',
      evidenceLabel: pending ? 'Pista para verificar' : 'Documentado en una fuente',
      evidence: [{ url: url.href, source: article.source || article.provider || url.hostname, date: article.date || null }],
      dateStatus, affectedUsers: official ? article.affectedUsers ?? null : null,
      eventType: article.enreType === 'programado' ? 'programado' : 'reporte',
      responsibility: { operator: official ? article.company || null : null, government: null, status: 'por_verificar' },
      question: article.enreType === 'programado'
        ? '¿Se informó a los usuarios y se cumplió el plazo anunciado?'
        : '¿Qué respuesta recibieron los afectados y qué solución se ofreció?',
      nextStep: pending ? 'Abrir la fuente y confirmar hecho, lugar y fecha antes de usarlo.' : 'Comprobar situación actual, respuesta del prestador y competencia de cada organismo.',
      missing: ['Estado actual del incidente', 'Responsabilidad de gestión y respuesta documentada', ...(pending ? ['Lectura y verificación de la fuente original'] : [])],
      trend: 'no_evaluada', readyToPublish: false
    }];
  });
}
