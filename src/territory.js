import { extractGeo } from './geo-caba.js';

const MONITOR_LABELS = {
  'hospitales-caba': 'Hospitales',
  'salud-caba': 'Salud',
  'subte-caba': 'Subte',
  'servicios-caba': 'Servicios y cortes',
  'educacion-caba': 'Educación',
  'seguridad-caba': 'Seguridad',
  'limpieza-caba': 'Limpieza',
  'vivienda-obras-caba': 'Vivienda y obras',
  'espacio-publico-caba': 'Espacio público'
};

function topCategory(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  return { name: entries[0][0], count: entries[0][1] };
}

function pushCount(map, key, row) {
  if (!map.has(key)) map.set(key, { incidents: new Set(), categories: {}, entities: new Set(), stations: new Set() });
  const item = map.get(key);
  item.incidents.add(row.article_id || row.url);
  const label = MONITOR_LABELS[row.monitor_id] || row.monitor_name || row.monitor_id || 'Otro';
  const categoryKey = `${row.article_id || row.url}:${label}`;
  if (!item._categorySeen) item._categorySeen = new Set();
  if (!item._categorySeen.has(categoryKey)) {
    item._categorySeen.add(categoryKey);
    item.categories[label] = (item.categories[label] || 0) + 1;
  }
  for (const entity of row.geo.entities || []) item.entities.add(entity);
  for (const station of row.geo.stations || []) item.stations.add(station);
}

function finalize(map, keyName) {
  return [...map.entries()].map(([key, value]) => ({
    [keyName]: keyName === 'commune' ? Number(key) : key,
    incidentCount: value.incidents.size,
    predominantProblem: topCategory(value.categories),
    entities: [...value.entities].slice(0, 4),
    stations: [...value.stations].slice(0, 4)
  })).sort((a, b) => b.incidentCount - a.incidentCount || String(a[keyName]).localeCompare(String(b[keyName]), 'es'));
}

export function summarizeTerritory(rows = []) {
  const communes = new Map();
  const barrios = new Map();
  const geolocatedArticles = new Set();
  const allArticles = new Set();

  for (const raw of rows) {
    const id = raw.article_id || raw.url;
    if (!id) continue;
    allArticles.add(id);
    const geo = extractGeo(`${raw.title || ''}`);
    const row = { ...raw, geo };
    if (geo.communes.length || geo.barrios.length) geolocatedArticles.add(id);
    for (const commune of geo.communes) pushCount(communes, commune, row);
    for (const barrio of geo.barrios) pushCount(barrios, barrio, row);
  }

  return {
    communes: finalize(communes, 'commune'),
    barrios: finalize(barrios, 'barrio'),
    coverage: {
      totalArticles: allArticles.size,
      geolocatedArticles: geolocatedArticles.size,
      geolocatedPercent: allArticles.size ? Math.round((geolocatedArticles.size / allArticles.size) * 100) : 0
    }
  };
}

export { MONITOR_LABELS };
