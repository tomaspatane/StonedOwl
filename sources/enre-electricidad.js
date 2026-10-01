const ENDPOINTS = [
  { company: 'EDESUR', code: 'EDS', url: 'https://www.enre.gov.ar/paginacorte/js/data_EDS.js' },
  { company: 'EDENOR', code: 'EDN', url: 'https://www.enre.gov.ar/paginacorte/js/data_EDN.js' }
];

function normalizeLooseJs(raw = '') {
  let body = String(raw).replace(/^\uFEFF/, '').trim();
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) throw new Error('ENRE payload sin objeto reconocible');
  body = body.slice(firstBrace, lastBrace + 1);

  try { return JSON.parse(body); } catch {}

  const jsonish = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'((?:\\.|[^'\\])*)'/g, (_, value) => {
      const unescaped = value.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      return JSON.stringify(unescaped);
    })
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bNaN\b/g, 'null')
    .replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(jsonish);
}

export function parseEnrePayload(raw = '') {
  return normalizeLooseJs(raw);
}

function affectedUsers(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

function cutType(key = '') {
  const value = String(key).toLowerCase();
  if (value.includes('baja')) return 'baja_tension';
  if (value.includes('media')) return 'media_tension';
  if (value.includes('prevent')) return 'preventivo';
  if (value.includes('program')) return 'programado';
  if (value.includes('comunic')) return 'programado_comunicado';
  return 'interrupcion';
}

function looksLikeCut(item) {
  return item && typeof item === 'object' && [
    'partido', 'localidad', 'barrio', 'usuarios', 'subestacion_alimentador', 'normalizacion'
  ].some((key) => Object.prototype.hasOwnProperty.call(item, key));
}

export function flattenEnreCuts(data = {}, company = 'ENRE', sourceUrl = '') {
  const records = [];
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(data || {})) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!looksLikeCut(item)) continue;
      const locality = String(item.localidad || item.barrio || '').trim();
      const partido = String(item.partido || '').trim();
      const users = affectedUsers(item.usuarios);
      const type = cutType(key);
      const substation = String(item.subestacion_alimentador || item.subestacion || '').trim();
      const normalization = String(item.normalizacion || '').trim();
      const streets = Array.isArray(item.calles) ? item.calles.join(', ') : String(item.calles || '').trim();
      const place = locality || partido || 'zona sin detalle';
      const impactWeight = users >= 5000 ? 5 : users >= 1000 ? 5 : users >= 250 ? 4 : 3;

      records.push({
        title: `ENRE ${company}: ${type.replace(/_/g, ' ')} en ${place}`,
        snippet: [
          users ? `Usuarios afectados: ${users}` : '',
          partido ? `Partido/Comuna: ${partido}` : '',
          substation ? `Subestación/alimentador: ${substation}` : '',
          normalization ? `Normalización estimada: ${normalization}` : '',
          streets ? `Zona: ${streets}` : ''
        ].filter(Boolean).join('. '),
        url: sourceUrl,
        source: `ENRE/${company}`,
        provider: 'ENRE',
        date: now,
        sourceType: 'official',
        official: true,
        company,
        enreType: type,
        locality,
        partido,
        affectedUsers: users,
        maxWeight: impactWeight
      });
    }
  }

  return records;
}

async function fetchOne(endpoint, fetchImpl) {
  const cacheBust = `${endpoint.url}?_=${Date.now()}`;
  const response = await fetchImpl(cacheBust, {
    headers: {
      accept: 'application/javascript, text/javascript, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (compatible; StonedOwl/0.10; +https://github.com/tomaspatane/StonedOwl)'
    }
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${endpoint.company} HTTP ${response.status}: ${raw.slice(0, 180)}`);
  const data = parseEnrePayload(raw);
  const records = flattenEnreCuts(data, endpoint.company, endpoint.url);
  return {
    company: endpoint.company,
    records,
    totals: {
      withoutSupply: data.totalUsuariosSinSuministro ?? null,
      withSupply: data.totalUsuariosConSuministro ?? null,
      yesterdayAffected: data.totalUsuariosAyer ?? null,
      updatedAt: data.ultimaActualizacion ?? null
    }
  };
}

export async function fetchEnreElectricidad(fetchImpl = fetch) {
  const settled = await Promise.allSettled(ENDPOINTS.map((endpoint) => fetchOne(endpoint, fetchImpl)));
  const records = [];
  const diagnostics = {};
  const totals = {};

  settled.forEach((result, index) => {
    const endpoint = ENDPOINTS[index];
    if (result.status === 'fulfilled') {
      records.push(...result.value.records);
      totals[endpoint.company] = result.value.totals;
      diagnostics[endpoint.company] = { ok: true, count: result.value.records.length, url: endpoint.url };
    } else {
      diagnostics[endpoint.company] = { ok: false, error: String(result.reason?.message || result.reason), url: endpoint.url };
    }
  });

  return { records, diagnostics, totals };
}
