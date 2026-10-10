import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyElectricEvidence, evidenceDateStatus } from '../data/electricidad-evidence.js';
const now = Date.parse('2026-10-06T15:15:04.135Z');
const audit = JSON.parse(await readFile(new URL('./electricidad-audit-2026-10-06.json', import.meta.url)));
for (const input of audit.cases) {
  assert.equal(classifyElectricEvidence({ ...input, now }).acceptedForBarrio, false, input.title);
  // A fresh timestamp must not make the commercial/mixed fragments valid.
  assert.equal(classifyElectricEvidence({ ...input, now, date: '1 hour ago' }).acceptedForBarrio, false, input.title);
}
const valid = { title: 'Corte de luz en Flores, CABA', snippet: 'Vecinos de Flores estamos sin luz desde anoche.', targetBarrio: 'Flores', source: 'facebook.com', date: '2 hours ago', now };
const cases = [
  ['direct report', {}, true],
  ['global path', { targetBarrio: '' }, true],
  ['local news', { source: 'medio.test', snippet: 'El corte afecta a varias cuadras.' }, true],
  ['short local title', { title: 'Flores sin luz', snippet: '' }, true],
  ['missing date', { date: '' }, false],
  ['unparseable date', { date: 'sin fecha' }, false],
  ['old report', { date: '2025-10-06T12:00:00Z' }, false],
  ['future report', { date: '2026-10-07T12:00:00Z' }, false],
  ['hypothetical', { title: 'Qué hacer si se corta la luz en Flores', snippet: 'Si hay un corte de luz en Flores, llamá a Edesur.' }, false],
  ['index', { title: 'Últimas noticias de Flores', snippet: 'Estamos sin luz en Flores.' }, false],
  ['real estate', { title: 'Monoambiente en alquiler en Flores', snippet: 'Tiene generador ante un corte de luz en Flores.' }, false],
  ['mixed fragments', { title: 'Postales del barrio', snippet: 'Corte de luz en San Martín ... Vecinos de Flores CABA' }, false],
  ['weak social signal', { title: 'Nuestro barrio', snippet: 'Un corte de luz en Flores.' }, false],
  ['citywide', { title: 'Apagón masivo en la Ciudad de Buenos Aires', snippet: 'El corte afecta Palermo, Caballito y Flores.' }, false],
  ['official unaffected', { official: true, date: '' }, true],
];
for (const [name, patch, accepted] of cases) {
  assert.equal(classifyElectricEvidence({ ...valid, ...patch }).acceptedForBarrio, accepted, name);
}
// Undated plausible incidents remain excluded from alerts, but are reviewable.
const undatedReview = classifyElectricEvidence({ ...valid, date: '' });
assert.equal(undatedReview.acceptedForBarrio, false);
assert.equal(undatedReview.reviewCandidate, true);
assert.equal(undatedReview.reviewReason, 'plausible_local_incident_missing_publication_date');
assert.equal(classifyElectricEvidence({ ...valid, date: '2025-10-06T12:00:00Z' }).reviewCandidate, false);
assert.notEqual(classifyElectricEvidence({ ...valid, title: 'Monoambiente en alquiler en Flores', date: '' }).reviewCandidate, true);
for (const date of ['hace 2 horas', '2 hours ago', '30 minutes ago', '2026-10-06T12:00:00Z', 'Oct 6, 2026']) {
  assert.equal(evidenceDateStatus(date, now), 'recent', date);
}
assert.equal(evidenceDateStatus('3 days ago', now), 'outside_time_window');
assert.equal(evidenceDateStatus('3 days ago', now, '1w'), 'recent');
console.log(`Evidence gate: ${audit.cases.length} observed false/unverified positives excluded; ${cases.length} synthetic cases passed.`);

// Exercise the runtime ingestion paths, not only the classification helper.
const { extractMentions, extractTerritorialMentions, existingMentionsFromRadar, enreMentions } = await import('../worker-v10.js');
const undated = { ...valid, date: '', url: 'https://example.test/report' };
assert.equal(extractMentions([undated]).length, 0);
assert.equal(extractTerritorialMentions([undated]).mentions.length, 0);
assert.equal(existingMentionsFromRadar([{ barrio: 'Flores', evidence: [undated] }]).length, 0);
const current = { ...undated, date: new Date().toISOString() };
delete current.now;
assert.equal(extractMentions([current]).length, 1);
assert.equal(extractTerritorialMentions([current]).mentions.length, 1);
assert.equal(existingMentionsFromRadar([{ barrio: 'Flores', evidence: [current] }]).length, 1);
const official = enreMentions([{ locality: 'CONSTITUCION', partido: 'CAPITAL', affectedUsers: 38, official: true }]);
assert.equal(official.length, 1);
assert.equal(official[0].affectedUsers, 38);
assert.equal(official[0].evidenceQuality, 'official');
console.log('Runtime ingestion: date gate enforced on all three web paths; ENRE preserved.');
