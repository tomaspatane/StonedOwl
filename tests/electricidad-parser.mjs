import fs from 'node:fs';
import { detectBarrios } from '../data/caba-barrios.js';
import { matchElectricSignals } from '../data/electricidad.js';

const fixtures = JSON.parse(fs.readFileSync(new URL('./electricidad-fixtures.json', import.meta.url), 'utf8'));
let failed = 0;

for (const fixture of fixtures) {
  const barrios = detectBarrios(fixture.text).map((b) => b.name);
  const signals = matchElectricSignals(fixture.text);
  const maxWeight = signals.length ? Math.max(...signals.map((s) => s.baseWeight)) : 0;
  const useful = signals.length > 0 && barrios.length > 0;

  const expectedBarrios = fixture.expected.barrios || [];
  const barrioOk = expectedBarrios.every((b) => barrios.includes(b));
  const weightOk = fixture.expected.min_weight == null || maxWeight >= fixture.expected.min_weight;
  const usefulOk = fixture.expected.useful === useful;

  if (!barrioOk || !weightOk || !usefulOk) {
    failed += 1;
    console.error(`FAIL ${fixture.id}`);
    console.error({ barrios, maxWeight, useful, expected: fixture.expected, signals: signals.map((s) => s.phrase) });
  } else {
    console.log(`PASS ${fixture.id}`);
  }
}

if (failed) {
  console.error(`\n${failed} fixture(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${fixtures.length} electricity fixtures passed.`);
