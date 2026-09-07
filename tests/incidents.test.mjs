import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentRelevant, filterIncidentArticles } from '../src/incidents.js';

const article = (title, description = '') => ({ title, description, url: 'https://medio.test/nota' });

test('hospital monitor rejects positive institutional coverage without an incident', () => {
  assert.equal(incidentRelevant(article('Finalizaron las obras de remodelación integral en el Hospital Rocca'), 'hospitales-caba'), false);
});

test('hospital monitor accepts shortages, delays and guard complaints', () => {
  assert.equal(incidentRelevant(article('Denuncian falta de médicos y demoras en la guardia del Hospital X'), 'hospitales-caba'), true);
  assert.equal(incidentRelevant(article('Reclamo por faltante de insumos en un hospital porteño'), 'hospitales-caba'), true);
});

test('subte monitor accepts service interruptions and station closures', () => {
  assert.equal(incidentRelevant(article('La Línea B funciona con demoras por una falla técnica'), 'subte-caba'), true);
  assert.equal(incidentRelevant(article('Cierra la estación Medrano por obras'), 'subte-caba'), true);
});

test('subte monitor rejects promotional or cultural stories', () => {
  assert.equal(incidentRelevant(article('El Subte inaugura un mural en homenaje a una figura histórica'), 'subte-caba'), false);
  assert.equal(incidentRelevant(article('Vagón de lectores: una propuesta cultural en el Subte'), 'subte-caba'), false);
});

test('new urban monitors accept actionable incidents in their domain', () => {
  assert.equal(incidentRelevant(article('Corte de luz afecta a varios barrios y usuarios reclaman a Edesur'), 'servicios-caba'), true);
  assert.equal(incidentRelevant(article('Escuela porteña suspende clases por una falla eléctrica'), 'educacion-caba'), true);
  assert.equal(incidentRelevant(article('Vecinos denuncian una ola de robos y reclaman más seguridad'), 'seguridad-caba'), true);
  assert.equal(incidentRelevant(article('Reclamos por basura acumulada y fallas en la recolección'), 'limpieza-caba'), true);
  assert.equal(incidentRelevant(article('Desalojo conflictivo en un edificio de la Ciudad'), 'vivienda-obras-caba'), true);
  assert.equal(incidentRelevant(article('Vecinos reclaman por veredas rotas y problemas en el espacio público'), 'espacio-publico-caba'), true);
});

test('new urban monitors reject routine or positive coverage without incident language', () => {
  assert.equal(incidentRelevant(article('La Ciudad inauguró nueva iluminación LED en una avenida'), 'servicios-caba'), false);
  assert.equal(incidentRelevant(article('Una escuela estrenó biblioteca y laboratorio'), 'educacion-caba'), false);
  assert.equal(incidentRelevant(article('La Policía incorporó nuevos patrulleros'), 'seguridad-caba'), false);
  assert.equal(incidentRelevant(article('Nuevo operativo de limpieza integral en plazas'), 'limpieza-caba'), false);
  assert.equal(incidentRelevant(article('Avanza una obra de vivienda con nuevos departamentos'), 'vivienda-obras-caba'), false);
  assert.equal(incidentRelevant(article('Renovaron una plaza y sumaron juegos'), 'espacio-publico-caba'), false);
});

test('filterIncidentArticles keeps only actionable incident-shaped coverage', () => {
  const rows = [
    article('Hospital Rocca renovó su farmacia y rehabilitación'),
    article('Guardia del hospital con demoras y reclamos de pacientes'),
    article('Nueva tecnología para un hospital público')
  ];
  assert.equal(filterIncidentArticles(rows, 'hospitales-caba').length, 1);
});
