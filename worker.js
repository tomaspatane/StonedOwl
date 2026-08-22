import baseWorker from '../worker-v07.js';

const STOPWORDS = new Set([
  'para','pero','como','esta','este','estos','estas','desde','sobre','entre','tras','ante','contra','hacia',
  'hasta','donde','cuando','quien','quienes','porque','aunque','tambien','todo','toda','todos','todas','cada',
  'segun','dice','dijo','sera','seria','fue','son','con','sin','por','del','las','los','una','uno','unos','unas',
  'que','sus','más','mas','hay','han','the','and','for','with','from','after','before','into','new','news',
  'ese','esa','esos','esas','aquel','aquella','mismo','misma','otro','otra','otros','otras'
]);

const GENERIC_ACTORS = new Set([
  'argentina','gobierno','ciudad','buenos aires','caba','ultimo','segun',
  'inflacion','precio','precios','economia','politica','salud','hospital','hospitales',
  'subte','tren','trenes','colectivo','colectivos','descuento','descuentos',
  'mercado','sociedad','pais','nacion','nacional',
  'america','america latina','latina','latinoamerica','region','mundo'
]);

const PROVIDER_NAMES = new Set(['bing news','google news','gdelt']);
const NAMED_ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };

function decodeEntities(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&#(\d+);/g, (match, decimal) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (match, name) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? match
    );
}

function normalizeText(value = '') {
  return decodeEntities(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cleanHeadline(title = '') {
  return decodeEntities(title)
    .replace(/\s+-\s+[^-]{2,80}$/u, '')
    .trim();
}

function stemToken(word = '') {
  if (/^\d+(?:[.,]\d+)?%?$/.test(word)) return word.replace(',', '.');
  if (word.length > 5 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function titleTokens(title = '') {
  const normalized = normalizeText(cleanHeadline(title))
    .replace(/(\d+),(\d+)/g, '$1.$2')
    .replace(/[^a-z0-9ñ.%\s]/giu, ' ');

  return new Set(
    normalized
      .split(/\s+/)
      .map(stemToken)
      .filter(word => {
        if (!word) return false;
        if (/^\d+(?:\.\d+)?%?$/.test(word)) return true;
        return word.length >= 4 && !STOPWORDS.has(word);
      })
  );
}

function tokenSimilarity(a, b) {
  if (!a.size || !b.size) return { shared:0, jaccard:0, overlap:0 };

  let shared = 0;

  for (const token of a) {
    if (b.has(token)) shared += 1;
  }

  const union = a.size + b.size - shared;
  const minSize = Math.min(a.size, b.size);

  return {
    shared,
    jaccard: union ? shared / union : 0,
    overlap: minSize ? shared / minSize : 0
  };
}

function articlesBelongTogether(a, b) {
  const score = tokenSimilarity(a, b);

  if (score.shared >= 3 && score.overlap >= 0.40) return true;
  if (score.shared >= 2 && score.jaccard >= 0.28) return true;

  return false;
}

function representativeArticle(indices, tokenSets, articles) {
  if (indices.length === 1) return articles[indices[0]];

  let bestIndex = indices[0];
  let bestScore = -1;

  for (const index of indices) {
    let score = 0;

    for (const other of indices) {
      if (index === other) continue;

      const similarity = tokenSimilarity(
        tokenSets[index],
        tokenSets[other]
      );

      score += similarity.overlap + similarity.jaccard;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return articles[bestIndex];
}

function mediaFromArticle(article = {}) {
  const source = decodeEntities(article.source || '').trim();
  const provider = decodeEntities(article.provider || '').trim();

  const sourceKey = normalizeText(source);
  const providerKey = normalizeText(provider);

  if (
    source &&
    sourceKey !== providerKey &&
    !PROVIDER_NAMES.has(sourceKey)
  ) {
    return source;
  }

  try {
    const hostname = new URL(article.url || '')
      .hostname
      .replace(/^www\./i, '')
      .trim();

    if (
      hostname &&
      hostname !== 'news.google.com' &&
      hostname !== 'bing.com' &&
      hostname !== 'www.bing.com'
    ) {
      return hostname;
    }
  } catch {}

  return '';
}

function clusterArticles(articles = []) {
  const sample = articles.slice(0, 100);

  if (!sample.length) return [];

  const tokenSets = sample.map(article => titleTokens(article.title));
  const parents = sample.map((_, index) => index);

  function find(index) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }

    return index;
  }

  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);

    if (rootA !== rootB) {
      parents[rootB] = rootA;
    }
  }

  for (let i = 0; i < sample.length; i += 1) {
    for (let j = i + 1; j < sample.length; j += 1) {
      if (articlesBelongTogether(tokenSets[i], tokenSets[j])) {
        union(i, j);
      }
    }
  }

  const components = new Map();

  for (let index = 0; index < sample.length; index += 1) {
    const root = find(index);

    if (!components.has(root)) {
      components.set(root, []);
    }

    components.get(root).push(index);
  }

  return [...components.values()]
    .filter(indices => indices.length >= 2)
    .map(indices => {
      const groupedArticles = indices.map(index => sample[index]);

      const representative = representativeArticle(
        indices,
        tokenSets,
        sample
      );

      const sources = [
        ...new Set(
          groupedArticles
            .map(mediaFromArticle)
            .filter(Boolean)
        )
      ];

      return {
        label: cleanHeadline(representative.title),
        articleCount: groupedArticles.length,
        sourceCount: sources.length,
        sources: sources.slice(0, 5),
        sampleUrl: representative.url || null
      };
    })
    .sort((a, b) =>
      b.sourceCount !== a.sourceCount
        ? b.sourceCount - a.sourceCount
        : b.articleCount - a.articleCount
    )
    .slice(0, 5);
}

function sourceStats(articles = []) {
  const counts = new Map();
  let unidentifiedCount = 0;

  for (const article of articles) {
    const source = mediaFromArticle(article);

    if (!source) {
      unidentifiedCount += 1;
      continue;
    }

    counts.set(
      source,
      (counts.get(source) || 0) + 1
    );
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1]);

  const total = articles.length || 1;

  return {
    topSources: ranked
      .slice(0, 5)
      .map(([source, count]) => ({ source, count })),

    concentrationPercent:
      ranked.length
        ? Math.round((ranked[0][1] / total) * 100)
        : 0,

    identifiedMediaCount: counts.size,
    unidentifiedArticleCount: unidentifiedCount
  };
}

function actorKey(value = '') {
  const normalized = normalizeText(value)
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';
  if (/\bsube\b/.test(normalized)) return 'sube';
  if (/\bindec\b/.test(normalized)) return 'indec';

  return normalized;
}

function actorDisplay(value = '', key = '') {
  if (key === 'sube') return 'SUBE';
  if (key === 'indec') return 'INDEC';

  return decodeEntities(value).trim();
}

function extractActors(articles = []) {
  const counts = new Map();

  for (const article of articles.slice(0, 100)) {
    const headline = cleanHeadline(article.title);

    const matches =
      headline.match(
        /\b[A-ZÁÉÍÓÚÑ][\p{L}ÁÉÍÓÚÑáéíóúñ.-]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}ÁÉÍÓÚÑáéíóúñ.-]{2,}){0,2}\b/gu
      ) || [];

    const unique = new Map();

    for (const match of matches) {
      const candidate = decodeEntities(match).trim();
      const key = actorKey(candidate);

      if (
        !key ||
        GENERIC_ACTORS.has(key) ||
        candidate.length > 45
      ) {
        continue;
      }

      const previous = unique.get(key);

      if (!previous || candidate.length > previous.length) {
        unique.set(key, candidate);
      }
    }

    for (const [key, display] of unique) {
      const current = counts.get(key) || {
        name: actorDisplay(display, key),
        mentions: 0
      };

      current.mentions += 1;

      if (
        key !== 'sube' &&
        key !== 'indec' &&
        display.length > current.name.length
      ) {
        current.name = actorDisplay(display, key);
      }

      counts.set(key, current);
    }
  }

  const keys = [...counts.keys()]
    .sort((a, b) => b.length - a.length);

  for (const shortKey of [...keys].reverse()) {
    if (!counts.has(shortKey) || shortKey.includes(' ')) {
      continue;
    }

    const longerKey = keys.find(key => {
      if (key === shortKey || !counts.has(key)) return false;

      return key
        .split(' ')
        .at(-1) === shortKey;
    });

    if (!longerKey) continue;

    const shortEntry = counts.get(shortKey);
    const longEntry = counts.get(longerKey);

    longEntry.mentions += shortEntry.mentions;
    counts.delete(shortKey);
  }

  return [...counts.values()]
    .filter(actor => actor.mentions >= 2)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 8);
}

function liveInterpretation(articles = []) {
  const stories = clusterArticles(articles);
  const sources = sourceStats(articles);
  const actors = extractActors(articles);
  const dominant = stories[0] || null;

  let headline =
    'Cobertura recuperada fragmentada: no hay una historia claramente dominante en la muestra.';

  if (dominant) {
    if (dominant.sourceCount > 0) {
      headline =
        `La cobertura recuperada se concentra en una historia repetida por ${dominant.sourceCount} ` +
        `medio${dominant.sourceCount === 1 ? '' : 's'} de la muestra.`;
    } else {
      headline =
        `La cobertura recuperada se concentra en una historia repetida en ${dominant.articleCount} ` +
        `resultado${dominant.articleCount === 1 ? '' : 's'}, pero no pudimos identificar con fiabilidad los medios.`;
    }
  }

  return {
    headline,
    articleCount: articles.length,

    distinctStoryCount: Math.max(
      0,
      articles.length -
        stories.reduce(
          (sum, story) =>
            sum + Math.max(0, story.articleCount - 1),
          0
        )
    ),

    stories,
    actors,
    ...sources
  };
}

function parseDiagnostics(value) {
  if (!value) return null;

  try {
    const parsed =
      typeof value === 'string'
        ? JSON.parse(value)
        : value;

    return parsed && typeof parsed === 'object'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function activeProviders(diagnosticsValue) {
  const diagnostics = parseDiagnostics(diagnosticsValue);

  if (!diagnostics) return null;

  return Object.entries(diagnostics)
    .filter(([, value]) => value?.ok === true)
    .map(([name]) => name)
    .sort();
}

function comparableCoverage(latest, previous) {
  if (!latest || !previous) return false;

  const latestCount = Number(
    latest.active_provider_count || 0
  );

  const previousCount = Number(
    previous.active_provider_count || 0
  );

  if (latestCount <= 0 || previousCount <= 0) {
    return false;
  }

  const latestProviders = activeProviders(
    latest.diagnostics_json
  );

  const previousProviders = activeProviders(
    previous.diagnostics_json
  );

  if (latestProviders && previousProviders) {
    return latestProviders.join('|') ===
      previousProviders.join('|');
  }

  return latestCount === previousCount;
}

function historicalHeadline({
  latest,
  previous,
  growthPercent,
  newArticleCount,
  stories,
  coverageComparable
}) {
  if (
    !latest ||
    Number(latest.active_provider_count || 0) === 0
  ) {
    return {
      status: 'unavailable',
      headline:
        'No hay cobertura suficiente para interpretar este monitoreo.'
    };
  }

  if (!previous) {
    return {
      status: 'learning',
      headline:
        'Primera base histórica: StonedOwl todavía está aprendiendo el comportamiento normal del tema.'
    };
  }

  if (!coverageComparable) {
    const previousCount = Number(
      previous.active_provider_count || 0
    );

    const latestCount = Number(
      latest.active_provider_count || 0
    );

    return {
      status: 'coverage_changed',
      headline:
        `Cambió la cobertura técnica entre capturas (${previousCount} → ${latestCount} proveedores activos). ` +
        'No comparamos intensidad hasta recuperar una base equivalente.'
    };
  }

  const growth =
    typeof growthPercent === 'number'
      ? growthPercent
      : 0;

  if (growth >= 20 || newArticleCount >= 8) {
    return {
      status: 'rising',
      headline:
        `La cobertura recuperada se está acelerando: aparecieron ${newArticleCount} ` +
        'resultados nuevos desde la captura anterior comparable.'
    };
  }

  if (growth <= -20) {
    return {
      status: 'cooling',
      headline:
        `La cobertura recuperada perdió intensidad (${growthPercent}% frente a la captura anterior comparable).`
    };
  }

  if (newArticleCount > 0) {
    return {
      status: 'active',
      headline:
        `La cobertura recuperada sigue activa: ${newArticleCount} ` +
        `resultado${newArticleCount === 1 ? '' : 's'} nuevo${newArticleCount === 1 ? '' : 's'} ` +
        'desde la captura anterior comparable.'
    };
  }

  if (stories?.length) {
    return {
      status: 'stable',
      headline:
        'Sin salto de volumen: la cobertura recuperada sigue concentrada en historias ya detectadas.'
    };
  }

  return {
    status: 'stable',
    headline:
      'Sin cambios relevantes en la muestra recuperada desde la captura anterior comparable.'
  };
}

async function snapshotWithDiagnostics(
  db,
  monitorId,
  capturedAt,
  fallback
) {
  if (!capturedAt) {
    return fallback || null;
  }

  const row = await db.prepare(`
    SELECT
      captured_at,
      article_count,
      source_count,
      active_provider_count,
      diagnostics_json
    FROM monitor_snapshots
    WHERE monitor_id = ?
      AND captured_at = ?
    LIMIT 1
  `)
    .bind(monitorId, capturedAt)
    .first();

  return row || fallback || null;
}

async function monitorInterpretation(db, monitor) {
  const latestBase = monitor.latest || null;
  const previousBase = monitor.previous || null;

  if (!latestBase) {
    return {
      status: 'learning',
      headline:
        'Todavía no hay capturas suficientes para interpretar este tema.'
    };
  }

  const latest = await snapshotWithDiagnostics(
    db,
    monitor.id,
    latestBase.captured_at,
    latestBase
  );

  const previous = previousBase
    ? await snapshotWithDiagnostics(
        db,
        monitor.id,
        previousBase.captured_at,
        previousBase
      )
    : null;

  const { results: currentArticles } = await db.prepare(`
    SELECT
      a.title,
      a.url,
      a.source,
      a.provider,
      a.published_at,
      ma.first_seen_at,
      ma.last_seen_at
    FROM monitor_articles ma
    JOIN articles a
      ON a.id = ma.article_id
    WHERE ma.monitor_id = ?
      AND ma.last_seen_at = ?
    ORDER BY
      COALESCE(a.published_at, ma.first_seen_at) DESC
    LIMIT 100
  `)
    .bind(
      monitor.id,
      latest.captured_at
    )
    .all();

  let newArticleCount = 0;
  let newArticles = [];

  if (previous?.captured_at) {
    const { results } = await db.prepare(`
      SELECT
        a.title,
        a.url,
        a.source,
        a.provider,
        a.published_at,
        ma.first_seen_at
      FROM monitor_articles ma
      JOIN articles a
        ON a.id = ma.article_id
      WHERE ma.monitor_id = ?
        AND ma.first_seen_at > ?
        AND ma.first_seen_at <= ?
      ORDER BY
        ma.first_seen_at DESC
      LIMIT 20
    `)
      .bind(
        monitor.id,
        previous.captured_at,
        latest.captured_at
      )
      .all();

    newArticles = results;

    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM monitor_articles
      WHERE monitor_id = ?
        AND first_seen_at > ?
        AND first_seen_at <= ?
    `)
      .bind(
        monitor.id,
        previous.captured_at,
        latest.captured_at
      )
      .first();

    newArticleCount = Number(
      row?.count || 0
    );
  }

  const stories = clusterArticles(
    currentArticles
  );

  const sourceData = sourceStats(
    currentArticles
  );

  const actors = extractActors(
    currentArticles
  );

  const coverageComparable = comparableCoverage(
    latest,
    previous
  );

  const state = historicalHeadline({
    latest,
    previous,
    growthPercent: monitor.growthPercent,
    newArticleCount,
    stories,
    coverageComparable
  });

  const signals = [];

  if (stories[0]) {
    signals.push(
      `Historia dominante en la muestra: ${stories[0].label}`
    );
  }

  if (actors[0]) {
    signals.push(
      `Actor o entidad más repetida: ${actors[0].name}`
    );
  }

  if (sourceData.concentrationPercent >= 35) {
    signals.push(
      `Cobertura concentrada: el medio principal reúne ${sourceData.concentrationPercent}% de los resultados actuales.`
    );
  }

  if (newArticleCount && coverageComparable) {
    signals.push(
      `${newArticleCount} resultados aparecieron por primera vez desde la captura anterior comparable.`
    );
  }

  if (previous && !coverageComparable) {
    signals.push(
      'La cobertura de proveedores cambió; los conteos se muestran como evidencia, no como momentum comparable.'
    );
  }

  return {
    ...state,
    coverageComparable,
    newArticleCount,
    newArticles: newArticles.slice(0, 5),
    stories,
    actors,
    signals: signals.slice(0, 4),
    ...sourceData
  };
}

async function readJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function responseWithJson(response, data) {
  const headers = new Headers(
    response.headers
  );

  headers.set(
    'content-type',
    'application/json; charset=utf-8'
  );

  headers.delete(
    'content-length'
  );

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status: response.status,
      statusText: response.statusText,
      headers
    }
  );
}

async function augmentRadar(
  request,
  env,
  ctx
) {
  const response = await baseWorker.fetch(
    request,
    env,
    ctx
  );

  const data = await readJson(
    response
  );

  if (
    !response.ok ||
    !data ||
    !Array.isArray(data.monitors)
  ) {
    return response;
  }

  const monitors = [];

  for (const monitor of data.monitors) {
    try {
      monitors.push({
        ...monitor,

        interpretation:
          await monitorInterpretation(
            env.DB,
            monitor
          )
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          message: 'interpretation failed',
          monitorId: monitor.id,
          error: String(
            error?.message || error
          )
        })
      );

      monitors.push({
        ...monitor,

        interpretation: {
          status: 'error',
          headline:
            'No se pudo generar la interpretación de esta captura.'
        }
      });
    }
  }

  return responseWithJson(
    response,
    {
      ...data,
      monitors
    }
  );
}

async function augmentNews(
  request,
  env,
  ctx
) {
  const response = await baseWorker.fetch(
    request,
    env,
    ctx
  );

  const data = await readJson(
    response
  );

  if (
    !response.ok ||
    !data ||
    !Array.isArray(data.articles)
  ) {
    return response;
  }

  try {
    return responseWithJson(
      response,
      {
        ...data,

        interpretation:
          liveInterpretation(
            data.articles
          )
      }
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message:
          'live interpretation failed',
        error: String(
          error?.message || error
        )
      })
    );

    return response;
  }
}

export {
  clusterArticles,
  comparableCoverage,
  decodeEntities,
  extractActors,
  historicalHeadline,
  liveInterpretation,
  mediaFromArticle,
  sourceStats
};

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    const url = new URL(
      request.url
    );

    if (url.pathname === '/api/radar') {
      return augmentRadar(
        request,
        env,
        ctx
      );
    }

    if (
      url.pathname === '/api/news' ||
      url.pathname === '/api/gdelt'
    ) {
      return augmentNews(
        request,
        env,
        ctx
      );
    }

    return baseWorker.fetch(
      request,
      env,
      ctx
    );
  },

  async scheduled(
    controller,
    env,
    ctx
  ) {
    return baseWorker.scheduled(
      controller,
      env,
      ctx
    );
  }
};
