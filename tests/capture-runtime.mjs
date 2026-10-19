import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker-v11.js';
import { summarizeSourceHealth } from '../sources/electricidad-capture.js';
import { evidenceDateStatus } from '../data/electricidad-evidence.js';

async function capture({ failAll = false, users = undefined, sourceAgeMs = 0, locality = 'FLORES', officialRestatement = false } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (failAll) return new Response('Unavailable', { status: 503 });
    if (String(url).includes('enre.gov.ar')) {
      const edesur = String(url).includes('data_EDS');
      return new Response(JSON.stringify({
        ultimaActualizacion: new Date(Date.now() - sourceAgeMs).toISOString(),
        totalUsuariosSinSuministro: users ?? 0,
        cortesServicioBaja: edesur && users !== undefined ? [{ partido: 'CAPITAL FEDERAL', localidad: locality, usuarios: users }] : []
      }));
    }
    if (String(url).includes('reddit.com')) return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', { headers: { 'content-type': 'application/atom+xml' } });
    const article = officialRestatement ? `<item><title>Corte de luz en Flores</title><link>https://publisher.test/flores</link><pubDate>${new Date().toUTCString()}</pubDate><description>Según ENRE, el corte de luz en Flores afecta a 12 usuarios.</description></item>` : '';
    return new Response(`<rss version="2.0"><channel><title>Fixture</title><link>https://publisher.test/</link><description>Fixture</description>${article}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } });
  };
  try {
    const response = await worker.fetch(new Request('https://app.test/api/electricidad?span=1d'), {});
    return response.json();
  } finally { globalThis.fetch = originalFetch; }
}

test('complete retrieval failure never claims runtime is operational', async () => {
  const result = await capture({ failAll: true });
  assert.equal(result.captureHealth.status, 'failed');
  assert.equal(result.ok, false, 'The UI uses ok to label the system Operativo');
});

test('stale official rows remain leads, not current red status or confirmation', async () => {
  const result = await capture({ users: 6000, sourceAgeMs: 48 * 3600_000 });
  assert.equal(result.editorialCases.length, 1);
  assert.equal(result.editorialCases[0].evidenceStatus, 'por_verificar');
  const row = result.radar.find(item => item.barrio === 'Flores');
  assert.equal(row.officialConfirmation, false);
  assert.notEqual(row.status, 'rojo');
  assert.notEqual(row.confidence, 'alta');
});

test('fresh official evidence with unknown count never displays zero affected', async () => {
  const result = await capture({ users: null });
  const row = result.radar.find(item => item.barrio === 'Flores');
  assert.equal(row.affectedUsers, null);
  assert.equal(result.editorialCases[0].affectedUsers, null);
});

test('multi-barrio official counts are not copied as full impact to each barrio', async () => {
  const result = await capture({ users: 6000, locality: 'FLORES / CABALLITO' });
  for (const barrio of ['Flores', 'Caballito']) {
    const row = result.radar.find(item => item.barrio === barrio);
    assert.equal(row.officialConfirmation, false);
    assert.notEqual(row.status, 'rojo');
  }
});

test('a news restatement of ENRE is not an independent eyewitness confirmation', async () => {
  const result = await capture({ users: 12, officialRestatement: true });
  const row = result.radar.find(item => item.barrio === 'Flores');
  assert.equal(row.status, 'amarillo');
  assert.equal(row.statusReasonCodes.includes('reporte_ciudadano_mas_confirmacion_oficial'), false);
});

test('a failed child search remains visible beneath a successful aggregate', () => {
  const result = summarizeSourceHealth({ diagnostics: { subreddit: { ok: true, queries: [{ ok: true }, { ok: false, error: 'credits exhausted' }] } } });
  assert.equal(result.status, 'degraded');
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 1);
});

test('six-hour evidence gate rejects a seven-hour publication', () => {
  const now = Date.now();
  assert.equal(evidenceDateStatus(new Date(now - 7 * 3600_000).toISOString(), now, '6h'), 'outside_time_window');
});
