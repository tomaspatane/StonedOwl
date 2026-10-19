import assert from 'node:assert/strict';
import test from 'node:test';
import { compareElectricitySnapshots, parseEnreUpdatedAt, ELECTRICITY_TREND_LIMITS } from '../data/electricidad-trend.js';

const CURRENT = '2026-10-19T19:00:00Z';
const PREVIOUS = '2026-10-19T18:00:00Z';
const clone = value => structuredClone(value);

function record({ barrio = 'Flores', company = 'EDESUR', users = 20, type = 'baja_tension', ...other } = {}) {
  return {
    company, provider: 'ENRE', source: `ENRE/${company}`, official: true,
    url: `https://www.enre.gov.ar/paginacorte/js/data_${company === 'EDESUR' ? 'EDS' : 'EDN'}.js`,
    locality: barrio.toUpperCase(), partido: 'CAPITAL FEDERAL',
    barrios: [{ name: barrio }], enreType: type, affectedUsers: users,
    title: `${barrio}: ${type}`, snippet: `Usuarios afectados: ${users}`,
    ...other
  };
}
function snapshot(finishedAt, officialSignals = [record()]) {
  return {
    finishedAt,
    counts: { enreRaw: officialSignals.length, enreCaba: officialSignals.length },
    sourceHealth: { enre: Object.fromEntries(['EDENOR', 'EDESUR'].map(company => [company, {
      ok: true, count: officialSignals.filter(item => item.company === company).length
    }])) },
    enreTotals: Object.fromEntries(['EDENOR', 'EDESUR'].map(company => [company, {
      updatedAt: new Date(Date.parse(finishedAt) - 60_000).toISOString(),
      withoutSupply: 999999, withSupply: 3000000, yesterdayAffected: 900000
    }])),
    officialSignals
  };
}
function pair(currentUsers = 20, previousUsers = 10) {
  return { current: snapshot(CURRENT, [record({ users: currentUsers })]), previous: snapshot(PREVIOUS, [record({ users: previousUsers })]), now: Date.parse(CURRENT) };
}
function unknown(inputs, reason) {
  const result = compareElectricitySnapshots(inputs);
  assert.equal(result.status, 'unknown');
  assert.equal(result.trend, 'desconocida');
  assert.equal(result.deltaAffectedUsers, null);
  assert.equal(result.deltaPercent, null);
  assert.ok(result.reasonCodes.includes(reason), `${reason} not in ${JSON.stringify(result.reasonCodes)}`);
  return result;
}

test('compares only observed ENRE CABA counts, not franchise totals or web mentions', () => {
  const input = pair();
  input.current.citizenSignals = [{ affectedUsers: 3000 }];
  input.current.radar = [{ affectedUsers: 3000 }];
  const result = compareElectricitySnapshots(input);
  assert.equal(result.status, 'comparable');
  assert.equal(result.trend, 'sube');
  assert.equal(result.currentAffectedUsers, 20);
  assert.equal(result.previousAffectedUsers, 10);
  assert.equal(result.deltaAffectedUsers, 10);
  assert.equal(result.deltaPercent, 100);
  assert.equal(result.intervalMs, 3_600_000);
  assert.equal(result.byBarrio[0].barrio, 'Flores');
  assert.equal(result.byBarrio[0].trend, 'sube');
  assert.ok(result.caveats.some(c => c.includes('no demuestra una tendencia sostenida')));
  assert.ok(result.caveats.some(c => c.includes('ausencia')));
  assert.deepEqual(result.limits, ELECTRICITY_TREND_LIMITS);
  assert.equal('history' in result, false);
});

test('decrease and unchanged have precise two-point meanings', () => {
  assert.equal(compareElectricitySnapshots(pair(5, 10)).trend, 'baja');
  assert.equal(compareElectricitySnapshots(pair(5, 10)).deltaPercent, -50);
  assert.equal(compareElectricitySnapshots(pair(10, 10)).trend, 'sin_cambio');
});

test('explicit zero is not missing, and percent from zero is undefined', () => {
  const up = compareElectricitySnapshots(pair(5, 0));
  assert.equal(up.status, 'comparable');
  assert.equal(up.deltaPercent, null);
  assert.equal(up.deltaAffectedUsers, 5);
  const down = compareElectricitySnapshots(pair(0, 5));
  assert.equal(down.status, 'comparable');
  assert.equal(down.deltaPercent, -100);
});

test('first snapshot is unknown, never a synthetic baseline', () => {
  unknown({ current: snapshot(CURRENT), now: CURRENT }, 'missing_snapshot');
  unknown({ now: CURRENT }, 'missing_snapshot');
});

test('missing rows are never zero, even when both requests succeeded', () => {
  const result = unknown({ current: snapshot(CURRENT, []), previous: snapshot(PREVIOUS), now: CURRENT }, 'missing_observed_coverage');
  assert.equal(result.currentAffectedUsers, null);
  assert.equal(result.byBarrio[0].currentAffectedUsers, null);
  assert.equal(result.byBarrio[0].trend, 'desconocida');
  unknown({ current: snapshot(CURRENT, []), previous: snapshot(PREVIOUS, []), now: CURRENT }, 'missing_observed_coverage');
});

test('changed observed groups block aggregate while shared barrio still compares', () => {
  const input = pair();
  input.current = snapshot(CURRENT, [record({ users: 20 }), record({ barrio: 'Caballito', users: 30 })]);
  const result = unknown(input, 'changed_observed_coverage');
  assert.equal(result.byBarrio.find(row => row.barrio === 'Flores').trend, 'sube');
  assert.equal(result.byBarrio.find(row => row.barrio === 'Caballito').trend, 'desconocida');
  assert.equal(result.byBarrio.find(row => row.barrio === 'Caballito').previousAffectedUsers, null);
});

test('company/type changes are not comparable even for the same barrio', () => {
  for (const overrides of [{ company: 'EDENOR' }, { type: 'media_tension' }]) {
    const input = pair();
    input.current = snapshot(CURRENT, [record(overrides)]);
    unknown(input, 'changed_observed_coverage');
  }
});

test('scheduled and communicated scheduled outages never inflate active trend', () => {
  const input = pair();
  input.current = snapshot(CURRENT, [record({ users: 20 }), record({ users: 8000, type: 'programado' }), record({ users: 9000, type: 'programado_comunicado' })]);
  const result = compareElectricitySnapshots(input);
  assert.equal(result.status, 'comparable');
  assert.equal(result.currentAffectedUsers, 20);
  unknown({ current: snapshot(CURRENT, [record({ type: 'programado' })]), previous: snapshot(PREVIOUS, [record({ type: 'programado' })]), now: CURRENT }, 'missing_observed_coverage');
});

test('multiple distinct records in a group aggregate, but duplicate rows fail closed', () => {
  const input = pair();
  input.current = snapshot(CURRENT, [record({ users: 12 }), record({ users: 20 })]);
  assert.equal(compareElectricitySnapshots(input).currentAffectedUsers, 32);
  input.current = snapshot(CURRENT, [record({ users: 12 }), record({ users: 12 })]);
  unknown(input, 'duplicate_official_record');
});

test('both companies must have healthy, counted source responses in both captures', () => {
  for (const side of ['current', 'previous']) for (const company of ['EDENOR', 'EDESUR']) {
    const input = pair();
    input[side].sourceHealth.enre[company].ok = false;
    unknown(input, 'incomplete_enre_health');
    delete input[side].sourceHealth.enre[company];
    unknown(input, 'incomplete_enre_health');
  }
});

test('truncated official sample or mismatched raw counts fail closed', () => {
  const input = pair();
  input.current.counts.enreCaba = 51;
  unknown(input, 'incomplete_official_records');
  input.current = snapshot(CURRENT);
  input.current.counts.enreRaw += 1;
  unknown(input, 'incomplete_raw_coverage');
  delete input.current.officialSignals;
  unknown(input, 'incomplete_official_records');
});

test('non-CABA and ambiguous same-name localities cannot enter comparison', () => {
  for (const overrides of [{ partido: 'SAN MARTIN' }, { partido: '' }, { locality: 'FLORES Y CABALLITO' }, { barrios: [{ name: 'Flores' }, { name: 'Caballito' }] }]) {
    const input = pair();
    input.current = snapshot(CURRENT, [record(overrides)]);
    unknown(input, overrides.barrios ? 'ambiguous_barrio_assignment' : 'unverified_caba_record');
  }
});

test('provider name/official flags cannot launder unrelated URLs into ENRE', () => {
  for (const overrides of [{ official: false }, { provider: 'Search' }, { url: 'https://www.enre.gov.ar.evil.test/paginacorte/js/data_EDS.js' }, { url: 'http://www.enre.gov.ar/paginacorte/js/data_EDS.js' }, { url: 'https://www.enre.gov.ar/paginacorte/js/data_EDN.js' }]) {
    const input = pair();
    input.current = snapshot(CURRENT, [record(overrides)]);
    unknown(input, 'unverified_official_record');
  }
});

test('missing, coerced, negative, fractional, nonfinite and unsafe counts fail closed', () => {
  for (const users of [null, undefined, '', '20', -2, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const input = pair();
    input.current = snapshot(CURRENT, [record({ affectedUsers: users })]);
    unknown(input, 'invalid_affected_users');
  }
  const input = pair();
  input.current = snapshot(CURRENT, [record({ users: Number.MAX_SAFE_INTEGER }), record({ users: 3 })]);
  unknown(input, 'invalid_affected_users');
});

test('unrecognized outage category fails closed', () => {
  const input = pair();
  input.current = snapshot(CURRENT, [record({ type: 'not_understood' })]);
  unknown(input, 'unknown_outage_type');
});

test('source dates require a full dated instant, not fetch time or a clock string', () => {
  const input = pair();
  input.current.enreTotals.EDESUR.updatedAt = '16:00';
  input.current.officialSignals[0].date = CURRENT;
  unknown(input, 'unknown_source_update_time');
  input.current.enreTotals.EDESUR.sourceUpdatedAt = '2026-10-19T15:59:00-03:00';
  assert.equal(compareElectricitySnapshots(input).status, 'comparable');
});

test('strict full ISO and Argentine local source timestamp parsing', () => {
  assert.equal(parseEnreUpdatedAt('19/10/2026 15:59'), Date.parse('2026-10-19T18:59:00Z'));
  assert.equal(parseEnreUpdatedAt('19-10-2026 15:59:20'), Date.parse('2026-10-19T18:59:20Z'));
  assert.equal(parseEnreUpdatedAt('2026-10-19T15:59:00-03:00'), Date.parse('2026-10-19T18:59:00Z'));
  for (const bad of ['19/10/2026', '2026-10-19', '18:59', '2026-10-19T18:59:00', '30/02/2026 12:00', '2026-02-30T12:00:00Z', '2026-10-19T24:00:00Z', '19/10/2026 29:00', null, 123]) assert.equal(parseEnreUpdatedAt(bad), null, String(bad));
});

test('stale source update in either capture blocks, not merely failed HTTP', () => {
  for (const side of ['current', 'previous']) {
    const input = pair();
    input[side].enreTotals.EDENOR.updatedAt = new Date(Date.parse(input[side].finishedAt) - 31 * 60_000).toISOString();
    unknown(input, 'stale_source_update');
  }
});

test('previous source freshness is evaluated at capture, not today', () => {
  const input = pair();
  input.previous = snapshot('2026-10-19T07:00:00Z', [record({ users: 10 })]);
  assert.equal(compareElectricitySnapshots(input).status, 'comparable');
});

test('stale current source relative to now blocks even before snapshot age limit', () => {
  const input = pair();
  input.now = Date.parse(CURRENT) + 31 * 60_000;
  unknown(input, 'stale_source_update');
});

test('stale, future, missing, and malformed capture times block', () => {
  const input = pair();
  input.now = Date.parse(CURRENT) + 3 * 3_600_000;
  unknown(input, 'stale_snapshot');
  input.now = Date.parse(CURRENT) - 3 * 60_000;
  unknown(input, 'future_snapshot');
  input.current.finishedAt = '19:00';
  unknown(input, 'invalid_snapshot_time');
  delete input.current.finishedAt;
  unknown(input, 'invalid_snapshot_time');
});

test('future source update and repeated source payload are not fresh comparisons', () => {
  const input = pair();
  input.current.enreTotals.EDESUR.updatedAt = '2026-10-19T19:03:00Z';
  unknown(input, 'future_source_update');
  input.current.enreTotals.EDESUR.updatedAt = input.previous.enreTotals.EDESUR.updatedAt;
  unknown(input, 'source_update_not_advanced');
});

test('capture interval requires chronological, separated, reasonably close points', () => {
  for (const [time, reason] of [[CURRENT, 'non_increasing_snapshots'], ['2026-10-19T19:01:00Z', 'non_increasing_snapshots'], ['2026-10-19T18:59:00Z', 'snapshot_interval_too_short'], ['2026-10-18T18:00:00Z', 'snapshot_interval_too_long']]) {
    const input = pair();
    input.previous = snapshot(time);
    unknown(input, reason);
  }
});

test('source timestamp interval is independently guarded', () => {
  const input = pair();
  input.previous = snapshot('2026-10-19T18:55:00Z');
  input.previous.enreTotals.EDESUR.updatedAt = '2026-10-19T18:55:00Z';
  unknown(input, 'source_interval_too_short');
});

test('configured limits are explicit in output and validated', () => {
  const input = pair();
  input.previous = snapshot('2026-10-19T18:57:00Z');
  input.limits = { minIntervalMs: 60_000 };
  assert.equal(compareElectricitySnapshots(input).status, 'comparable');
  assert.equal(compareElectricitySnapshots(input).limits.minIntervalMs, 60_000);
  for (const limits of [{ minIntervalMs: 0 }, { maxIntervalMs: -1 }, { maxClockSkewMs: NaN }, { typo: 3 }, { minIntervalMs: 100, maxIntervalMs: 99 }]) {
    assert.throws(() => compareElectricitySnapshots({ ...pair(), limits }), TypeError);
  }
  assert.throws(() => compareElectricitySnapshots({ ...pair(), now: 'nonsense' }), TypeError);
});

test('comparison is deterministic, serializable and never mutates either snapshot', () => {
  const input = pair();
  const before = clone(input);
  const a = compareElectricitySnapshots(input);
  assert.deepEqual(a, compareElectricitySnapshots(input));
  assert.deepEqual(input, before);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});
