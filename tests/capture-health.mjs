import assert from 'node:assert/strict';
import { captureHealth, summarizeSourceHealth } from '../sources/electricidad-capture.js';
import { fetchEnreElectricidad, isCabaEnreRecord, flattenEnreCuts } from '../sources/enre-electricidad.js';
import { enreMentions } from '../worker-v10.js';
assert.equal(summarizeSourceHealth({ diagnostics: [{ ok: false, error: 'HTTP 400 Not enough credits' }] }).status, 'failed');
assert.equal(summarizeSourceHealth({ diagnostics: [{ ok: true, rawCount: 0 }] }).status, 'healthy');
assert.equal(summarizeSourceHealth({ diagnostics: {} }).status, 'failed');
assert.equal(captureHealth({ web: { diagnostics: [{ ok: false }] }, enre: { diagnostics: { EDN: { ok: true } } } }).status, 'degraded');
assert.equal(captureHealth({ web: { diagnostics: [{ ok: false }] } }).usable, false);
assert.equal(isCabaEnreRecord({ partido: 'CAPITAL FEDERAL' }), true);
assert.equal(isCabaEnreRecord({ partido: 'SAN MARTIN', locality: 'SAN NICOLAS' }), false);
const records = flattenEnreCuts({ ultimaActualizacion: '2026-10-19T12:00:00-03:00', cortesServicioBaja: [
 { partido: 'CAPITAL FEDERAL', localidad: 'FLORES', usuarios: null },
 { partido: 'SAN MARTIN', localidad: 'SAN NICOLAS', usuarios: '400' }
]}, 'EDESUR', 'https://enre.test/eds');
assert.equal(records[0].affectedUsers, null);
assert.equal(records[0].sourceUpdatedAt, '2026-10-19T12:00:00-03:00');
const mentions = enreMentions(records);
assert.equal(mentions.length, 1);
assert.equal(mentions[0].affectedUsers, null);
assert.equal(mentions[0].company, 'EDESUR');
assert.equal(mentions[0].enreType, 'baja_tension');
const malformed = await fetchEnreElectricidad(async () => ({ ok: true, text: async () => '{}' }));
assert.equal(captureHealth({ enre: malformed }).status, 'failed');
const validEmpty = await fetchEnreElectricidad(async () => ({ ok: true, text: async () => '{"cortesServicioBaja":[],"totalUsuariosSinSuministro":0}' }));
assert.equal(captureHealth({ enre: validEmpty }).status, 'healthy');
console.log('Capture health: failures, valid-empty, geography, unknown counts, schema validation passed.');

for (const bad of [-1, 1.5, '-5', '12 usuarios?', '', '1,2', null]) {
  const [record] = flattenEnreCuts({ cortesServicioBaja: [{ partido:'CAPITAL FEDERAL', localidad:'FLORES', usuarios:bad }] });
  assert.equal(record.affectedUsers, null);
}

assert.equal(summarizeSourceHealth({ diagnostics: { ok: true, queries: [{ ok: true }, { ok: false }] } }).status, 'degraded');
assert.equal(mentions[0].currentOfficial, false, 'Stale source cannot drive current score');

assert.equal(enreMentions([{...records[0], locality:'FLORES / CABALLITO', affectedUsers:6000}]).length, 0, 'Do not assign full count to each of multiple localities');
