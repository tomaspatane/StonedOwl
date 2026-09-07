import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTerritory } from '../src/territory.js';

const row = (article_id, monitor_id, title) => ({
  article_id,
  monitor_id,
  monitor_name: monitor_id,
  title,
  url: `https://medio.test/${article_id}`
});

test('ranking territorial deduplicates the same article within a commune', () => {
  const result = summarizeTerritory([
    row('a1', 'subte-caba', 'Cierra la estación Medrano en Almagro por una falla'),
    row('a1', 'subte-caba', 'Cierra la estación Medrano en Almagro por una falla')
  ]);
  assert.equal(result.communes[0].commune, 5);
  assert.equal(result.communes[0].incidentCount, 1);
  assert.equal(result.barrios[0].barrio, 'Almagro');
  assert.equal(result.barrios[0].incidentCount, 1);
});

test('ranking territorial identifies the predominant problem without inflating incident count', () => {
  const result = summarizeTerritory([
    row('a1', 'seguridad-caba', 'Reclamo por robos en Flores'),
    row('a2', 'seguridad-caba', 'Denuncian inseguridad y robos en Flores'),
    row('a3', 'limpieza-caba', 'Reclamo por basura acumulada en Flores')
  ]);
  const comuna7 = result.communes.find(item => item.commune === 7);
  assert.equal(comuna7.incidentCount, 3);
  assert.deepEqual(comuna7.predominantProblem, { name: 'Seguridad', count: 2 });
});

test('articles without a precise CABA location do not get assigned to a commune', () => {
  const result = summarizeTerritory([
    row('a1', 'servicios-caba', 'Corte de luz afecta distintos puntos de la Ciudad de Buenos Aires')
  ]);
  assert.equal(result.communes.length, 0);
  assert.equal(result.coverage.totalArticles, 1);
  assert.equal(result.coverage.geolocatedArticles, 0);
  assert.equal(result.coverage.geolocatedPercent, 0);
});
