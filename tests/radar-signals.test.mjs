import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeProviders, comparableCoverage, classifyMomentum, growthPercent, explainMomentum } from '../src/radar-signals.js';

const snapshot = (overrides = {}) => ({
  article_count: 10,
  active_provider_count: 3,
  diagnostics_json: JSON.stringify({
    bingNews: { ok: true },
    gdelt: { ok: true },
    googleNews: { ok: true }
  }),
  ...overrides
});

test('reads active provider identities from diagnostics', () => {
  assert.deepEqual(activeProviders(snapshot()), ['bingNews', 'gdelt', 'googleNews']);
});

test('does not compare snapshots when provider coverage changed', () => {
  const latest = snapshot({ active_provider_count: 2, diagnostics_json: JSON.stringify({ bingNews: { ok: true }, googleNews: { ok: true }, gdelt: { ok: false } }) });
  const previous = snapshot();
  assert.equal(comparableCoverage(latest, previous), false);
  assert.equal(classifyMomentum({ latest, previous, newArticleCount: 6 }).status, 'coverage_changed');
});

test('classifies rising only on comparable coverage', () => {
  const latest = snapshot({ article_count: 15 });
  const previous = snapshot({ article_count: 10 });
  const result = classifyMomentum({ latest, previous, newArticleCount: 5 });
  assert.equal(result.status, 'rising');
  assert.equal(result.growthPercent, 50);
  assert.equal(result.comparable, true);
});

test('classifies cooling, active and stable states', () => {
  assert.equal(classifyMomentum({ latest: snapshot({ article_count: 7 }), previous: snapshot({ article_count: 10 }) }).status, 'cooling');
  assert.equal(classifyMomentum({ latest: snapshot({ article_count: 10 }), previous: snapshot({ article_count: 10 }), newArticleCount: 2 }).status, 'active');
  assert.equal(classifyMomentum({ latest: snapshot({ article_count: 10 }), previous: snapshot({ article_count: 10 }), newArticleCount: 0 }).status, 'stable');
});

test('handles learning and unavailable states without fake growth', () => {
  assert.equal(classifyMomentum({ latest: snapshot(), previous: null }).status, 'learning');
  assert.equal(classifyMomentum({ latest: snapshot({ active_provider_count: 0 }), previous: snapshot() }).status, 'unavailable');
  assert.equal(growthPercent(5, 0), null);
});

test('produces cautious explanations', () => {
  assert.match(explainMomentum({ status: 'coverage_changed' }), /no se compara intensidad/i);
  assert.match(explainMomentum({ status: 'rising' }), /acelerando/i);
});
