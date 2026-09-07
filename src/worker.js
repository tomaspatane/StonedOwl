import baseWorker from '../worker-v07.js';
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

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (url.pathname === '/api/radar') {
      return augmentRadar(response, env);
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  }
};
