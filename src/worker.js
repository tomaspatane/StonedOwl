import baseWorker from '../worker-v07.js';

const STOPWORDS = new Set([
  'para','pero','como','esta','este','estos','estas','desde','sobre','entre','tras','ante','contra','hacia',
  'hasta','donde','cuando','quien','quienes','porque','aunque','tambien','todo','toda','todos','todas','cada',
  'segun','dice','dijo','sera','seria','fue','son','con','sin','por','del','las','los','una','uno','unos','unas',
  'que','sus','más','mas','hay','han','the','and','for','with','from','after','before','into','new','news'
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function cleanHeadline(title = '') {
  return String(title).replace(/\s+-\s+[^-]{2,80}$/u, '').trim();
}

function titleTokens(title = '') {
  return new Set(
    normalizeText(cleanHeadline(title))
      .replace(/[^a-z0-9ñáéíóúü\s]/giu, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 4 && !STOPWORDS.has(word))
  );
}

function overlapScore(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

function clusterArticles(articles = []) {
  const clusters = [];

  for (const article of articles.slice(0, 100)) {
    const tokens = titleTokens(article.title);
    if (!tokens.size) continue;

    let best = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const score = overlapScore(tokens, cluster.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = cluster;
      }
    }

    if (best && bestScore >= 0.34) {
      best.articles.push(article);
      for (const token of tokens) best.tokens.add(token);
    } else {
      clusters.push({ tokens: new Set(tokens), articles: [article] });
    }
  }

  return clusters
    .filter(cluster => cluster.articles.length >= 2)
    .map(cluster => {
      const sources = [...new Set(cluster.articles.map(article => article.source).filter(Boolean))];
      return {
        label: cleanHeadline(cluster.articles[0].title),
        articleCount: cluster.articles.length,
        sourceCount: sources.length,
        sources: sources.slice(0, 5),
        sampleUrl: cluster.articles[0].url || null
      };
    })
    .sort((a, b) => b.articleCount - a.articleCount)
    .slice(0, 5);
}

function sourceStats(articles = []) {
  const counts = new Map();
  for (const article of articles) {
    const source = article.source || article.provider || 'Fuente desconocida';
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = articles.length || 1;
  return {
    topSources: ranked.slice(0, 5).map(([source, count]) => ({ source, count })),
    concentrationPercent: ranked.length ? Math.round((ranked[0][1] / total) * 100) : 0
  };
}

function extractActors(articles = []) {
  const counts = new Map();
  const blocked = new Set(['Argentina','Gobierno','Ciudad','Buenos Aires','Caba','Último','Ultimo','Según','Segun']);

  for (const article of articles.slice(0, 100)) {
    const headline = cleanHeadline(article.title);
    const matches = headline.match(/\b[A-ZÁÉÍÓÚÑ][\p{L}ÁÉÍÓÚÑáéíóúñ.-]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}ÁÉÍÓÚÑáéíóúñ.-]{2,}){0,2}\b/gu) || [];
    const unique = new Set(matches.map(match => match.trim()).filter(match => !blocked.has(match) && match.length <= 45));
    for (const actor of unique) counts.set(actor, (counts.get(actor) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, mentions]) => ({ name, mentions }));
}

function liveInterpretation(articles = []) {
  const stories = clusterArticles(articles);
  const sources = sourceStats(articles);
  const actors = extractActors(articles);
  const dominant = stories[0] || null;

  let headline = 'Cobertura fragmentada: no hay una historia claramente dominante.';
  if (dominant) {
    headline = `La conversación se concentra en una historia repetida por ${dominant.sourceCount || dominant.articleCount} fuente${(dominant.sourceCount || dominant.articleCount) === 1 ? '' : 's'}.`;
  }

  return {
    headline,
    articleCount: articles.length,
    distinctStoryCount: Math.max(0, articles.length - stories.reduce((sum, story) => sum + Math.max(0, story.articleCount - 1), 0)),
    stories,
    actors,
    ...sources
  };
}

function historicalHeadline({ latest, previous, growthPercent, newArticleCount, stories }) {
  if (!latest || Number(latest.active_provider_count || 0) === 0) {
    return { status: 'unavailable', headline: 'No hay cobertura suficiente para interpretar este monitoreo.' };
  }
  if (!previous) {
    return { status: 'learning', headline: 'Primera base histórica: StonedOwl todavía está aprendiendo el comportamiento normal del tema.' };
  }

  const growth = typeof growthPercent === 'number' ? growthPercent : 0;
  if (growth >= 20 || newArticleCount >= 8) {
    return { status: 'rising', headline: `El tema se está acelerando: aparecieron ${newArticleCount} resultados nuevos desde la captura anterior.` };
  }
  if (growth <= -20) {
    return { status: 'cooling', headline: `La cobertura perdió intensidad (${growthPercent}% frente a la captura anterior).` };
  }
  if (newArticleCount > 0) {
    return { status: 'active', headline: `El tema sigue activo: ${newArticleCount} resultado${newArticleCount === 1 ? '' : 's'} nuevo${newArticleCount === 1 ? '' : 's'} desde la captura anterior.` };
  }
  if (stories?.length) {
    return { status: 'stable', headline: 'Sin salto de volumen: la conversación sigue concentrada en historias ya instaladas.' };
  }
  return { status: 'stable', headline: 'Sin cambios relevantes desde la captura anterior.' };
}

async function monitorInterpretation(db, monitor) {
  const latest = monitor.latest || null;
  const previous = monitor.previous || null;
  if (!latest) return { status: 'learning', headline: 'Todavía no hay capturas suficientes para interpretar este tema.' };

  const { results: currentArticles } = await db.prepare(`
    SELECT a.title, a.url, a.source, a.provider, a.published_at,
           ma.first_seen_at, ma.last_seen_at
    FROM monitor_articles ma
    JOIN articles a ON a.id = ma.article_id
    WHERE ma.monitor_id = ? AND ma.last_seen_at = ?
    ORDER BY COALESCE(a.published_at, ma.first_seen_at) DESC
    LIMIT 100
  `).bind(monitor.id, latest.captured_at).all();

  let newArticleCount = 0;
  let newArticles = [];
  if (previous?.captured_at) {
    const { results } = await db.prepare(`
      SELECT a.title, a.url, a.source, a.provider, a.published_at, ma.first_seen_at
      FROM monitor_articles ma
      JOIN articles a ON a.id = ma.article_id
      WHERE ma.monitor_id = ?
        AND ma.first_seen_at > ?
        AND ma.first_seen_at <= ?
      ORDER BY ma.first_seen_at DESC
      LIMIT 20
    `).bind(monitor.id, previous.captured_at, latest.captured_at).all();
    newArticles = results;
    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM monitor_articles
      WHERE monitor_id = ? AND first_seen_at > ? AND first_seen_at <= ?
    `).bind(monitor.id, previous.captured_at, latest.captured_at).first();
    newArticleCount = Number(row?.count || 0);
  }

  const stories = clusterArticles(currentArticles);
  const sourceData = sourceStats(currentArticles);
  const actors = extractActors(currentArticles);
  const state = historicalHeadline({
    latest,
    previous,
    growthPercent: monitor.growthPercent,
    newArticleCount,
    stories
  });

  const signals = [];
  if (stories[0]) signals.push(`Historia dominante: ${stories[0].label}`);
  if (actors[0]) signals.push(`Actor más repetido: ${actors[0].name}`);
  if (sourceData.concentrationPercent >= 35) signals.push(`Cobertura concentrada: el medio principal reúne ${sourceData.concentrationPercent}% de los resultados actuales.`);
  if (newArticleCount) signals.push(`${newArticleCount} resultados aparecieron por primera vez desde la captura anterior.`);

  return {
    ...state,
    newArticleCount,
    newArticles: newArticles.slice(0, 5),
    stories,
    actors,
    signals: signals.slice(0, 4),
    ...sourceData
  };
}

async function augmentRadar(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.clone().json();
  if (!response.ok || !Array.isArray(data.monitors)) return response;

  const monitors = [];
  for (const monitor of data.monitors) {
    try {
      monitors.push({ ...monitor, interpretation: await monitorInterpretation(env.DB, monitor) });
    } catch (error) {
      console.error(JSON.stringify({ message: 'interpretation failed', monitorId: monitor.id, error: String(error?.message || error) }));
      monitors.push({ ...monitor, interpretation: { status: 'error', headline: 'No se pudo generar la interpretación de esta captura.' } });
    }
  }

  return json({ ...data, monitors });
}

async function augmentNews(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.clone().json();
  if (!response.ok || !Array.isArray(data.articles)) return response;
  return json({ ...data, interpretation: liveInterpretation(data.articles) });
}

function injectInsightUi(response) {
  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.append('<script src="/insight.js"></script>', { html: true });
      }
    })
    .transform(response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/radar') return augmentRadar(request, env, ctx);
    if (url.pathname === '/api/news' || url.pathname === '/api/gdelt') return augmentNews(request, env, ctx);

    const response = await baseWorker.fetch(request, env, ctx);
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('text/html')) return injectInsightUi(response);
    return response;
  },

  async scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  }
};
