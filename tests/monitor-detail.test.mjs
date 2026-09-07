import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMonitorStories } from '../src/worker.js';

const now = new Date().toISOString();
const article = (title, url, source) => ({
  title,
  url,
  source,
  published_at: now,
  last_seen_at: now
});

test('confirma una señal sólo cuando la misma historia aparece en varias fuentes', () => {
  const summary = summarizeMonitorStories([
    article('Hospital Ramos Mejía: demoras en la guardia por falta de médicos', 'https://uno.test/a', 'Medio Uno'),
    article('Hospital Ramos Mejía: demoras en guardia por falta de médicos', 'https://dos.test/b', 'Medio Dos')
  ]);
  assert.equal(summary.dominantSignal.confirmed, true);
  assert.equal(summary.dominantSignal.sourceCount, 2);
  assert.match(summary.dominantSignal.assessment, /señal repetida/i);
});

test('no presenta una historia de una sola fuente como problema dominante confirmado', () => {
  const summary = summarizeMonitorStories([
    article('Hospital Durand incorpora nuevo equipamiento', 'https://uno.test/a', 'Medio Uno')
  ]);
  assert.equal(summary.dominantSignal.confirmed, false);
  assert.match(summary.dominantSignal.assessment, /todavía no alcanza/i);
});

test('sin historias devuelve explícitamente evidencia insuficiente', () => {
  const summary = summarizeMonitorStories([]);
  assert.equal(summary.dominantSignal.confirmed, false);
  assert.equal(summary.dominantSignal.title, null);
  assert.match(summary.dominantSignal.assessment, /evidencia suficiente/i);
});
