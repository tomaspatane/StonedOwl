import { runSources } from '../worker-v07.js';
import { filterIncidentArticles } from './incidents.js';

const BATCH_SIZE = 40;

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function runBatches(db, statements) {
  for (let start = 0; start < statements.length; start += BATCH_SIZE) {
    await db.batch(statements.slice(start, start + BATCH_SIZE));
  }
}

export async function captureIncidentMonitor(db, monitor) {
  const capturedAt = new Date().toISOString();
  const result = await runSources(monitor.query, monitor.scope, monitor.span);
  const articles = filterIncidentArticles(result.articles, monitor.id);
  const sourceCount = new Set(articles.map(article => article.source).filter(Boolean)).size;
  const statements = [];

  for (const article of articles) {
    const articleId = await sha256(article.url);
    statements.push(db.prepare(`
      INSERT INTO articles (
        id, title, url, source, provider, published_at, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title,
        source = excluded.source,
        provider = excluded.provider,
        published_at = COALESCE(excluded.published_at, articles.published_at),
        last_seen_at = excluded.last_seen_at
    `).bind(
      articleId,
      article.title,
      article.url,
      article.source || '',
      article.provider || '',
      article.date || null,
      capturedAt,
      capturedAt
    ));
    statements.push(db.prepare(`
      INSERT INTO monitor_articles (monitor_id, article_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(monitor_id, article_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at
    `).bind(monitor.id, articleId, capturedAt, capturedAt));
  }

  await runBatches(db, statements);
  await db.prepare(`
    INSERT INTO monitor_snapshots (
      id, monitor_id, captured_at, article_count, source_count,
      active_provider_count, diagnostics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    monitor.id,
    capturedAt,
    articles.length,
    sourceCount,
    result.activeProviderCount,
    JSON.stringify(result.diagnostics)
  ).run();

  return {
    monitorId: monitor.id,
    capturedAt,
    articleCount: articles.length,
    sourceCount,
    activeProviderCount: result.activeProviderCount,
    excludedAsNonIncident: result.articles.length - articles.length
  };
}

export async function captureIncidentMonitors(db) {
  const { results: monitors } = await db.prepare(`
    SELECT id, name, query, scope, span
    FROM monitors
    WHERE enabled = 1
    ORDER BY created_at ASC
  `).all();

  const results = [];
  for (const monitor of monitors) {
    try {
      results.push({ ok: true, ...(await captureIncidentMonitor(db, monitor)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: 'incident monitor capture failed', monitorId: monitor.id, error: message }));
      results.push({ ok: false, monitorId: monitor.id, error: message });
    }
  }
  console.log(JSON.stringify({ message: 'incident capture completed', results }));
  return results;
}
