import assert from 'node:assert/strict';
import { parseRedditAtom } from '../sources/reddit-electricidad.js';
import { parseEnrePayload, flattenEnreCuts } from '../sources/enre-electricidad.js';

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

console.log('Source parser fixtures: OK');
