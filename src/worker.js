import baseWorker from '../worker-v07.js';
import { groupStories } from './articles.js';
import { captureIncidentMonitors } from './incident-capture.js';
import { summarizeGeo } from './geo-caba.js';
import { classifyMomentum, explainMomentum } from './radar-signals.js';

async function countNewArticles(db, monitorId, previousAt, latestAt) {
  if (!db || !previousAt || !latestAt) return 0;
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM monitor_articles
    WHERE monitor_id = ?
      AND first_seen_at > ?
      AND first_seen_at <= ?
  `).bind(monitorId, previousAt, latestAt).first();
  return Number(row?.count || 0);
}

async function augmentRadar(response, env) {
  if (!response.ok) return response;
  const data = await response.clone().json().catch(() => null);
  if (!data?.ok || !Array.isArray(data.monitors)) return response;

  const monitors = [];
  for (const monitor of data.monitors) {
    const latest = monitor.latest || null;
    const previous = monitor.previous || null;
    const newArticleCount = previous && latest
      ? await countNewArticles(env.DB, monitor.id, previous.captured_at, latest.captured_at)
      : 0;
    const momentum = classifyMomentum({ latest, previous, newArticleCount });

    monitors.push({
      ...monitor,
      newArticleCount,
      momentum: {
        ...momentum,
        explanation: explainMomentum(momentum)
      }
    });
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ ...data, monitors }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function storyInput(article) {
  return {
    title: article.title,
    url: article.url,
    source: article.source || article.provider || 'Fuente',
    provider: article.provider,
    date: article.published_at || article.last_seen_at || article.first_seen_at,
    description: ''
  };
}

function geoLabel(geo = {}) {
  const parts = [];
  if (geo.entities?.length) parts.push(geo.entities.slice(0, 2).join(', '));
  else if (geo.stations?.length) parts.push(`Estación ${geo.stations.slice(0, 2).join(', ')}`);
  if (geo.barrios?.length) parts.push(geo.barrios.slice(0, 2).join(', '));
  if (geo.communes?.length) parts.push(`Comuna ${geo.communes.slice(0, 2).join('/')}`);
  return parts.join(' · ');
}

function summarizeMonitorStories(articles = []) {
  const valid = articles
    .map(storyInput)
    .filter(article => article.title && article.url && article.date);
  const grouped = groupStories(valid).slice(0, 8);
  const stories = grouped.map(story => ({ ...story, geo: summarizeGeo(story.articles) }));
  const dominant = stories[0] || null;
  const confirmed = Boolean(dominant && dominant.sourceCount >= 2);
  const dominantLocation = dominant ? geoLabel(dominant.geo) : '';

  return {
    geo: summarizeGeo(valid),
    stories,
    dominantSignal: dominant ? {
      title: dominant.title,
      articleCount: dominant.articleCount,
      sourceCount: dominant.sourceCount,
      latestPublishedAt: dominant.latestPublishedAt,
      confirmed,
      geo: dominant.geo,
      locationLabel: dominantLocation || null,
      assessment: confirmed
        ? `${dominantLocation ? `${dominantLocation}. ` : ''}Señal repetida por ${dominant.sourceCount} fuentes en ${dominant.articleCount} notas.`
        : `${dominantLocation ? `${dominantLocation}. ` : ''}Hay una historia destacada, pero todavía no alcanza para tratarla como problema dominante.`
    } : {
      title: null,
      articleCount: 0,
      sourceCount: 0,
      latestPublishedAt: null,
      confirmed: false,
      geo: { barrios: [], communes: [], stations: [], entities: [] },
      locationLabel: null,
      assessment: 'Todavía no hay una historia dominante con evidencia suficiente.'
    }
  };
}

async function augmentMonitor(response) {
  if (!response.ok) return response;
  const data = await response.clone().json().catch(() => null);
  if (!data?.ok || !Array.isArray(data.articles)) return response;
  const summary = summarizeMonitorStories(data.articles);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ ...data, ...summary }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export { summarizeMonitorStories };

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (url.pathname === '/api/radar') {
      return augmentRadar(response, env);
    }
    if (url.pathname === '/api/monitor') {
      return augmentMonitor(response);
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    console.log(JSON.stringify({ message: 'scheduled incident capture started', cron: controller.cron }));
    if (!env.DB) {
      console.error(JSON.stringify({ message: 'scheduled incident capture skipped', error: 'DB binding no disponible' }));
      return;
    }
    ctx.waitUntil(captureIncidentMonitors(env.DB));
  }
};
