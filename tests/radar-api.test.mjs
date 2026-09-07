import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

function fakeDb() {
  const latest = {
    captured_at: '2026-09-07T15:00:00.000Z',
    article_count: 15,
    source_count: 6,
    active_provider_count: 3,
    diagnostics_json: JSON.stringify({
      bingNews: { ok: true },
      gdelt: { ok: true },
      googleNews: { ok: true }
    })
  };
  const previous = {
    captured_at: '2026-09-07T14:00:00.000Z',
    article_count: 10,
    source_count: 5,
    active_provider_count: 3,
    diagnostics_json: JSON.stringify({
      bingNews: { ok: true },
      gdelt: { ok: true },
      googleNews: { ok: true }
    })
  };

  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (sql.includes('FROM monitors')) {
            return { results: [{ id: 'hospitales-caba', name: 'Hospitales CABA', query: 'hospitales CABA', scope: 'argentina', span: '1d' }] };
          }
          if (sql.includes('FROM monitor_snapshots')) {
            return { results: [latest, previous] };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('COUNT(*) AS count') && sql.includes('monitor_articles')) {
            return { count: 5 };
          }
          return null;
        }
      };
    }
  };
}

test('/api/radar includes comparable momentum and new article count', async () => {
  const response = await worker.fetch(new Request('https://owl.test/api/radar'), { DB: fakeDb() });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.monitors.length, 1);
  assert.equal(data.monitors[0].newArticleCount, 5);
  assert.equal(data.monitors[0].momentum.status, 'rising');
  assert.equal(data.monitors[0].momentum.growthPercent, 50);
  assert.equal(data.monitors[0].momentum.comparable, true);
  assert.match(data.monitors[0].momentum.explanation, /acelerando/i);
});
