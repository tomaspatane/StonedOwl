import { fetchFreeElectricidad } from './free-electricidad.js';
import { fetchRedditElectricidad } from './reddit-electricidad.js';
import { fetchSerperRedditElectricidad } from './serper-reddit.js';
import { fetchSerperElectricidad } from './serper-electricidad.js';
import { fetchSerperElectricidadTerritorial } from './serper-electricidad-territorial.js';

// A resolved Promise is not a successful source. Inspect every attempted request.
export function summarizeSourceHealth(result = {}) {
  if (result.disabled || result.diagnostics?.disabled) return { status: 'disabled', successful: 0, failed: 0 };
  const leaves = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    const children = Object.values(value).filter(item => item && typeof item === 'object');
    const before = leaves.length;
    children.forEach(visit);
    if (leaves.length > before) return;
    if (typeof value.ok === 'boolean') { leaves.push(value.ok); return; }
    if (value.error || value.fatal) { leaves.push(false); return; }
    Object.values(value).forEach(visit);
  };
  visit(result.diagnostics);
  const successful = leaves.filter(Boolean).length;
  const failed = leaves.length - successful;
  return { status: successful ? (failed ? 'degraded' : 'healthy') : 'failed', successful, failed };
}

export function captureHealth(sources = {}) {
  const families = Object.fromEntries(Object.entries(sources).map(([name, result]) => [name, summarizeSourceHealth(result)]));
  const required = Object.values(families).filter(item => item.status !== 'disabled');
  const usable = required.some(item => item.successful > 0);
  const healthy = required.length > 0 && required.every(item => item.status === 'healthy');
  return { status: healthy ? 'healthy' : usable ? 'degraded' : 'failed', usable, families,
    interpretation: 'Sin resultados no significa ausencia de problemas. Cobertura parcial de fuentes públicas; no mide prevalencia de reclamos.' };
}

async function guarded(task) {
  try { return await task(); }
  catch (error) { return { articles: [], diagnostics: { fatal: String(error?.message || error) } }; }
}

// Free sources first. A missing key or an exhausted paid provider can no longer
// remove the public source. Zero valid results is a valid empty search, not an error.
export async function fetchWebElectricity(span = '1d', apiKey = '', options = {}, fetchImpl = fetch) {
  const primary = await guarded(() => fetchFreeElectricidad(span, options, fetchImpl));
  if (summarizeSourceHealth(primary).successful > 0 || !apiKey) return { ...primary, mode: 'public-publisher-rss' };
  const fallback = await guarded(() => options.territorial || options.barrios?.length
    ? fetchSerperElectricidadTerritorial(span, apiKey, options, fetchImpl)
    : fetchSerperElectricidad(span, apiKey, fetchImpl));
  return { ...primary, articles: [...(primary.articles || []), ...(fallback.articles || [])],
    diagnostics: summarizeSourceHealth(fallback).status === 'healthy' ? fallback.diagnostics : { free: primary.diagnostics, paidFallback: fallback.diagnostics },
    attempts: { free: primary.diagnostics, paidFallback: fallback.diagnostics },
    mode: 'public-publisher-rss-with-serper-fallback' };
}

export async function fetchCitizenElectricity(span = '1d', apiKey = '', fetchImpl = fetch) {
  const primary = await guarded(() => fetchRedditElectricidad(span, fetchImpl));
  if (summarizeSourceHealth(primary).successful > 0 || !apiKey) return { ...primary, mode: 'direct-reddit' };
  const fallback = await guarded(() => fetchSerperRedditElectricidad(span, apiKey, fetchImpl));
  return { ...primary, articles: [...(primary.articles || []), ...(fallback.articles || [])],
    diagnostics: summarizeSourceHealth(fallback).status === 'healthy' ? fallback.diagnostics : { direct: primary.diagnostics, paidFallback: fallback.diagnostics },
    attempts: { direct: primary.diagnostics, paidFallback: fallback.diagnostics }, mode: 'direct-reddit-with-serper-fallback' };
}
