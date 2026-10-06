import assert from 'node:assert/strict';
import { parseRedditAtom } from '../sources/reddit-electricidad.js';
import { parseEnrePayload, flattenEnreCuts } from '../sources/enre-electricidad.js';
import { buildTerritorialPlan, fetchSerperElectricidadTerritorial } from '../sources/serper-electricidad-territorial.js';
import { confirmTargetBarrioInResult } from '../data/caba-barrios.js';
import { classifyElectricEvidence } from '../data/electricidad-evidence.js';

const redditFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <author><name>/u/vecino_flores</name></author>
    <title>Estamos sin luz en Flores hace horas</title>
    <link rel="alternate" href="https://www.reddit.com/r/BuenosAires/comments/test/corte/" />
    <published>2026-10-01T18:00:00+00:00</published>
    <content type="html">&lt;p&gt;Otra vez sin luz y con baja tensión en la cuadra.&lt;/p&gt;</content>
  </entry>
</feed>`;

const reddit = parseRedditAtom(redditFixture, 'BuenosAires', '1w');
assert.equal(reddit.length, 1);
assert.equal(reddit[0].source, 'reddit:r/BuenosAires');
assert.equal(reddit[0].author, '/u/vecino_flores');
assert.match(reddit[0].snippet, /baja tensión/i);

const enreFixture = `var data = {
  totalUsuariosSinSuministro: '1.250',
  totalUsuariosConSuministro: '3.000.000',
  ultimaActualizacion: '18:45',
  cortesServicioBaja: [
    { partido: 'CAPITAL FEDERAL', localidad: 'FLORES', usuarios: '250' }
  ],
  cortesServicioMedia: [
    { partido: 'CAPITAL FEDERAL', localidad: 'CABALLITO', usuarios: 1200, subestacion_alimentador: 'CABALLITO / 1', normalizacion: '20:30' }
  ],
};`;

const parsed = parseEnrePayload(enreFixture);
assert.equal(parsed.totalUsuariosSinSuministro, '1.250');
const records = flattenEnreCuts(parsed, 'EDESUR', 'https://example.test/data_EDS.js');
assert.equal(records.length, 2);
const flores = records.find((record) => record.locality === 'FLORES');
const caballito = records.find((record) => record.locality === 'CABALLITO');
assert.equal(flores.affectedUsers, 250);
assert.equal(flores.enreType, 'baja_tension');
assert.equal(caballito.affectedUsers, 1200);
assert.equal(caballito.enreType, 'media_tension');
assert.equal(caballito.official, true);

const plan = buildTerritorialPlan({ barrios: ['Flores', 'Caballito'] });
assert.equal(plan.barrios.length, 2);
assert.equal(plan.queries.length, 4);
assert.ok(plan.queries.some((item) => item.q === 'sin luz Flores CABA'));
assert.ok(plan.queries.some((item) => item.q === 'corte de luz Caballito CABA'));

const mockFetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  assert.match(body.q, /Flores CABA$/);
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        organic: [{
          title: 'Vecinos de Flores siguen sin luz',
          snippet: 'El corte afecta a varias cuadras de Flores.',
          link: `https://example.test/flores?query=${encodeURIComponent(body.q)}`,
          date: 'Oct 2, 2026'
        }]
      });
    }
  };
};

const territorial = await fetchSerperElectricidadTerritorial('1d', 'test-key', { barrios: ['Flores'] }, mockFetch);
assert.equal(territorial.disabled, false);
assert.equal(territorial.plan.queryCount, 2);
assert.equal(territorial.diagnostics.length, 2);
assert.equal(territorial.articles.length, 1);
assert.equal(territorial.articles[0].targetBarrio, 'Flores');
assert.equal(territorial.articles[0].sourceType, 'territorial_web');

const validTarget = confirmTargetBarrioInResult({
  targetBarrio: 'Flores',
  title: 'Otra vez sin luz, para variar',
  snippet: 'Vecinos de Flores dicen que siguen sin suministro desde anoche.'
});
assert.equal(validTarget.barrio?.name, 'Flores');
assert.equal(validTarget.reason, 'target_barrio_in_snippet');

const conflictingTarget = confirmTargetBarrioInResult({
  targetBarrio: 'Caballito',
  title: 'Naturgy explicó qué provocó el apagón masivo en San Juan',
  snippet: 'El resultado también menciona Caballito dentro del texto indexado.'
});
assert.equal(conflictingTarget.barrio, null);
assert.equal(conflictingTarget.reason, 'conflicting_non_caba_title');

const directFlores = classifyElectricEvidence({
  date: '2026-10-06T12:00:00Z', now: Date.parse('2026-10-06T15:00:00Z'),
  targetBarrio: 'Flores',
  source: 'facebook.com',
  provider: 'Google Web Territorial (Serper)',
  title: 'Otra vez sin luz, para variar',
  snippet: 'Vecinos de Flores: estamos sin luz desde anoche y todavía no volvió.'
});
assert.equal(directFlores.acceptedForBarrio, true);
assert.equal(directFlores.assignmentScope, 'barrio');
assert.equal(directFlores.evidenceQuality, 'direct_local_report');
assert.ok(directFlores.reasonCodes.includes('persistence'));

const citywide = classifyElectricEvidence({
  targetBarrio: 'Flores',
  source: 'facebook.com',
  provider: 'Google Web Territorial (Serper)',
  title: 'Apagón masivo en la Ciudad de Buenos Aires',
  snippet: 'El corte afectó a barrios porteños como Palermo, Caballito, Mataderos y Flores.'
});
assert.equal(citywide.acceptedForBarrio, false);
assert.equal(citywide.assignmentScope, 'citywide');
assert.equal(citywide.evidenceQuality, 'citywide_event_mentions_barrio');

const conflictEvidence = classifyElectricEvidence({
  targetBarrio: 'Caballito',
  source: 'facebook.com',
  provider: 'Google Web Territorial (Serper)',
  title: 'Naturgy explicó qué provocó el apagón masivo en San Juan',
  snippet: 'La página menciona Caballito entre otros términos indexados.'
});
assert.equal(conflictEvidence.acceptedForBarrio, false);
assert.equal(conflictEvidence.assignmentScope, 'unknown');
assert.equal(conflictEvidence.evidenceQuality, 'conflicting_geo');

const irrelevant = classifyElectricEvidence({
  targetBarrio: 'Flores',
  source: 'roomix.ai',
  title: 'Venta de monoambiente en Flores',
  snippet: 'Departamento de 33 m2 con balcón y sauna.'
});
assert.equal(irrelevant.acceptedForBarrio, false);
assert.equal(irrelevant.evidenceQuality, 'irrelevant');

console.log('Source parser fixtures: OK');

