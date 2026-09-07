import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGeo, summarizeGeo } from '../src/geo-caba.js';

test('detecta barrio y comuna cuando aparecen explícitos', () => {
  const geo = extractGeo('Vecinos de Flores reclaman por cortes reiterados de luz en la Comuna 7');
  assert.deepEqual(geo.barrios, ['Flores']);
  assert.deepEqual(geo.communes, [7]);
});

test('infiere barrio y comuna desde un hospital conocido sin inventar otra ubicación', () => {
  const geo = extractGeo('Demoras y reclamos en la guardia del Hospital Durand');
  assert.deepEqual(geo.entities, ['Hospital Durand']);
  assert.deepEqual(geo.barrios, ['Caballito']);
  assert.deepEqual(geo.communes, [6]);
});

test('infiere barrio y comuna desde una estación conocida', () => {
  const geo = extractGeo('Cierra la estación Medrano por una falla técnica');
  assert.deepEqual(geo.stations, ['Medrano']);
  assert.deepEqual(geo.barrios, ['Almagro']);
  assert.deepEqual(geo.communes, [5]);
});

test('no asigna barrio ni comuna cuando sólo hay una referencia genérica a CABA', () => {
  const geo = extractGeo('Cortes de luz en distintos puntos de la Ciudad de Buenos Aires');
  assert.deepEqual(geo.barrios, []);
  assert.deepEqual(geo.communes, []);
});

test('resume varias notas sin duplicar ubicaciones', () => {
  const geo = summarizeGeo([
    { title: 'Cierra la estación Medrano por obras' },
    { title: 'Demoras en Medrano: reclamos de pasajeros en la estación Medrano' }
  ]);
  assert.deepEqual(geo.stations, ['Medrano']);
  assert.deepEqual(geo.barrios, ['Almagro']);
  assert.deepEqual(geo.communes, [5]);
});
