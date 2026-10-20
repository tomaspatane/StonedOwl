import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { persistTopicSnapshot, readLatestTopicSnapshot, validateTopicReport, validateTopicSnapshotEnvelope, TOPIC_HISTORY_LIMITS } from '../scripts/lib/topic-history-store.mjs';

const run = promisify(execFile);
const capturedAt = '2026-10-20T19:00:00.000Z';
const recordedAt = '2026-10-20T19:01:00.000Z';
const version = { version: 'caba-topics-v1', snapshotSchema: 'caba-topic-snapshot-v1', analysisVersion: 'caba-topics-analysis-2026-10-20.1' };

function report(date = capturedAt, health = 'healthy') {
  return {
    ...version, fetchedAt: date, ok: health === 'healthy', captureUsable: health !== 'failed',
    captureHealth: { status: health }, editorialCases: [],
    topics: Object.fromEntries(['basura', 'transporte', 'seguridad'].map(topicId => [topicId, {
      ...version, topicId, fetchedAt: date, span: '1w', sourceHealth: [], editorialCases: [],
      counts: { candidateCount: 0, acceptedCount: 0, duplicates: 0, rejected: {} },
      captureHealth: { status: health }, trend: { status: 'unknown' }
    }]))
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'stonedowl-topic-history-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory: join(root, 'history') };
}

const options = directory => ({ directory, recordedAt });
const nameFor = date => `topics-${new Date(date).toISOString().replace(/[-:.]/g, '')}.json`;
const finalNames = async directory => (await readdir(directory)).filter(name => name.endsWith('.json'));

test('first read is no baseline and does not create a directory', async t => {
  const { directory } = await fixture(t);
  assert.deepEqual(await readLatestTopicSnapshot({ directory }), { report: null, reason: 'no_history', snapshotId: null, recordedAt: null });
  await assert.rejects(access(directory));
  await mkdir(directory);
  assert.equal((await readLatestTopicSnapshot({ directory })).reason, 'no_history');
});

test('persists exact schema, digest, private file and round trips without environment secrets', async t => {
  const { directory } = await fixture(t);
  const previous = process.env.GITHUB_TOKEN;
  const sentinel = `do-not-store-${randomUUID()}`;
  process.env.GITHUB_TOKEN = sentinel;
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  const input = report();
  const result = await persistTopicSnapshot(input, options(directory));
  assert.equal(result.duplicate, false);
  assert.match(result.snapshotId, /^\d{8}T\d{9}Z-[a-f0-9]{64}$/);
  assert.equal(result.fileName, nameFor(capturedAt));
  assert.equal(result.recordedAt, recordedAt);
  const raw = await readFile(join(directory, result.fileName), 'utf8');
  assert.ok(!raw.includes(sentinel));
  assert.ok(!raw.includes('GITHUB_TOKEN'));
  const envelope = JSON.parse(raw);
  assert.equal(envelope.format, 'stonedowl-topic-history-v1');
  assert.match(envelope.payloadSha256, /^[a-f0-9]{64}$/);
  assert.equal((await lstat(join(directory, result.fileName))).mode & 0o777, 0o600);
  assert.deepEqual(await readLatestTopicSnapshot({ directory }), {
    report: input, reason: 'latest_snapshot', snapshotId: result.snapshotId, recordedAt
  });
  assert.deepEqual(await readdir(directory), [result.fileName]);
});

test('identical reports are idempotent despite property order or recordedAt changes', async t => {
  const { directory } = await fixture(t);
  const input = report();
  const first = await persistTopicSnapshot(input, options(directory));
  const before = await readFile(join(directory, first.fileName), 'utf8');
  const reversed = Object.fromEntries(Object.entries(input).reverse());
  reversed.topics = Object.fromEntries(Object.entries(input.topics).reverse());
  const second = await persistTopicSnapshot(reversed, { directory, recordedAt: '2026-10-21T00:00:00Z' });
  assert.deepEqual(second, { ...first, duplicate: true });
  assert.equal(await readFile(join(directory, first.fileName), 'utf8'), before);
  assert.equal((await finalNames(directory)).length, 1);
});

test('shared synchronous validators support artifacts without trusting a checksum as provenance', async t => {
  const { directory } = await fixture(t);
  const input = report();
  const saved = await persistTopicSnapshot(input, options(directory));
  const envelope = JSON.parse(await readFile(join(directory, saved.fileName), 'utf8'));
  assert.deepEqual(validateTopicReport(input), {
    report: input, snapshotId: saved.snapshotId, fileName: saved.fileName, capturedAt
  });
  assert.deepEqual(validateTopicSnapshotEnvelope(envelope), {
    report: input, snapshotId: saved.snapshotId, recordedAt, fileName: saved.fileName
  });
  const corrupted = structuredClone(envelope);
  corrupted.payload.extra = 'changed';
  assert.throws(() => validateTopicSnapshotEnvelope(corrupted), /snapshot_checksum_mismatch/);
  assert.throws(() => validateTopicSnapshotEnvelope(input), /invalid_snapshot_envelope/);
  assert.throws(() => validateTopicSnapshotEnvelope([]), /invalid_snapshot_envelope/);
});

test('distinct payload at an existing capture timestamp never overwrites it', async t => {
  const { directory } = await fixture(t);
  const first = await persistTopicSnapshot(report(), options(directory));
  const different = report();
  different.observation = 'different capture content';
  await assert.rejects(persistTopicSnapshot(different, options(directory)), /snapshot_timestamp_conflict/);
  assert.equal((await readLatestTopicSnapshot({ directory })).snapshotId, first.snapshotId);
  assert.equal((await finalNames(directory)).length, 1);
});

test('latest uses capturedAt, not recordedAt, file mtime, healthy status or directory order', async t => {
  const { directory } = await fixture(t);
  const newest = report('2026-10-20T20:00:00.000Z', 'failed');
  const saved = await persistTopicSnapshot(newest, { directory, recordedAt });
  await persistTopicSnapshot(report(), { directory, recordedAt: '2026-10-21T00:00:00.000Z' });
  await utimes(join(directory, saved.fileName), 1, 1);
  assert.deepEqual((await readLatestTopicSnapshot({ directory })).report, newest);
  assert.equal((await finalNames(directory)).length, 2);
});

test('persisted history survives a separate Node process restart', async t => {
  const { directory } = await fixture(t);
  const saved = await persistTopicSnapshot(report(), options(directory));
  const moduleUrl = new URL('../scripts/lib/topic-history-store.mjs', import.meta.url).href;
  const script = `import { readLatestTopicSnapshot } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await readLatestTopicSnapshot({directory:process.argv[1]})));`;
  const { stdout, stderr } = await run(process.execPath, ['--input-type=module', '--eval', script, directory]);
  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).snapshotId, saved.snapshotId);
  assert.deepEqual(JSON.parse(stdout).report, report());
});

test('malformed newest capture blocks the baseline without falling back or deleting files', async t => {
  const { directory } = await fixture(t);
  await persistTopicSnapshot(report(), options(directory));
  await writeFile(join(directory, nameFor('2026-10-20T20:00:00.000Z')), '{partial');
  const result = await readLatestTopicSnapshot({ directory });
  assert.equal(result.report, null);
  assert.equal(result.reason, 'invalid_snapshot_json');
  assert.equal((await finalNames(directory)).length, 2);
});

test('checksum mismatch in newest capture blocks even with a valid older capture', async t => {
  const { directory } = await fixture(t);
  await persistTopicSnapshot(report(), options(directory));
  const newer = await persistTopicSnapshot(report('2026-10-20T20:00:00.000Z'), options(directory));
  const path = join(directory, newer.fileName);
  const envelope = JSON.parse(await readFile(path, 'utf8'));
  envelope.payload.ok = false;
  await writeFile(path, JSON.stringify(envelope));
  assert.equal((await readLatestTopicSnapshot({ directory })).reason, 'snapshot_checksum_mismatch');
  await assert.rejects(persistTopicSnapshot(envelope.payload, options(directory)), /snapshot_checksum_mismatch/);
  assert.equal((await finalNames(directory)).length, 2);
});

test('wrong envelope, schema, identity, recordedAt and generated filename fail closed', async t => {
  for (const [edit, expected] of [
    [value => { value.format = 'old-history'; }, 'invalid_snapshot_envelope'],
    [value => { value.payload.snapshotSchema = 'old-topic-schema'; }, 'invalid_topic_payload'],
    [value => { value.snapshotId = 'forged'; }, 'snapshot_checksum_mismatch'],
    [value => { value.recordedAt = '2026-02-30T12:00:00Z'; }, 'invalid_timestamp'],
    [value => { value.capturedAt = '2026-10-21T19:00:00.000Z'; }, 'snapshot_identity_mismatch'],
    [value => { value.unexpected = 'extra metadata'; }, 'invalid_snapshot_envelope']
  ]) {
    const { directory } = await fixture(t);
    const saved = await persistTopicSnapshot(report(), options(directory));
    const path = join(directory, saved.fileName);
    const envelope = JSON.parse(await readFile(path, 'utf8'));
    edit(envelope);
    await writeFile(path, JSON.stringify(envelope));
    assert.equal((await readLatestTopicSnapshot({ directory })).reason, expected);
  }
  const { directory } = await fixture(t);
  const saved = await persistTopicSnapshot(report(), options(directory));
  await writeFile(join(directory, nameFor('2026-10-20T20:00:00.000Z')), await readFile(join(directory, saved.fileName)));
  assert.equal((await readLatestTopicSnapshot({ directory })).reason, 'snapshot_identity_mismatch');
});

test('recognized incomplete temporary files are ignored, never promoted or removed', async t => {
  const { directory } = await fixture(t);
  const saved = await persistTopicSnapshot(report(), options(directory));
  const pending = `.pending-${process.pid}-${randomUUID()}`;
  await writeFile(join(directory, pending), '{incomplete');
  assert.equal((await readLatestTopicSnapshot({ directory })).snapshotId, saved.snapshotId);
  assert.equal(await readFile(join(directory, pending), 'utf8'), '{incomplete');
  const newer = await persistTopicSnapshot(report('2026-10-20T20:00:00.000Z'), options(directory));
  assert.equal((await readLatestTopicSnapshot({ directory })).snapshotId, newer.snapshotId);
  await access(join(directory, pending));
});

test('unrecognized names and impossible generated dates block a misleading older baseline', async t => {
  for (const fileName of ['topics-newest.json', 'topics-20260230T190000000Z.json']) {
    const { directory } = await fixture(t);
    await persistTopicSnapshot(report(), options(directory));
    await writeFile(join(directory, fileName), '{}');
    assert.equal((await readLatestTopicSnapshot({ directory })).report, null);
    await assert.rejects(persistTopicSnapshot(report('2026-10-20T20:00:00.000Z'), options(directory)));
    assert.equal((await finalNames(directory)).length, 2);
  }
});

test('directory and ancestor symlinks are rejected for both reads and writes', async t => {
  const { root, directory } = await fixture(t);
  const real = join(root, 'real');
  await mkdir(real);
  await symlink(real, directory);
  for (const candidate of [directory, join(directory, 'nested')]) {
    assert.equal((await readLatestTopicSnapshot({ directory: candidate })).reason, 'unsafe_history_directory');
    await assert.rejects(persistTopicSnapshot(report(), options(candidate)), /unsafe_history_directory/);
  }
  assert.deepEqual(await readdir(real), []);
});

test('snapshot and lock symlinks are never followed or overwritten', async t => {
  for (const fileName of [nameFor(capturedAt), '.topic-history.lock']) {
    const { root, directory } = await fixture(t);
    await mkdir(directory);
    const target = join(root, 'private-target');
    await writeFile(target, 'must not read as a report or overwrite');
    await symlink(target, join(directory, fileName));
    assert.equal((await readLatestTopicSnapshot({ directory })).reason, 'unsafe_history_entry');
    await assert.rejects(persistTopicSnapshot(report(), options(directory)), /unsafe_history_entry/);
    assert.equal(await readFile(target, 'utf8'), 'must not read as a report or overwrite');
  }
});

test('concurrent identical writers commit exactly one immutable snapshot', async t => {
  const { directory } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 16 }, () => persistTopicSnapshot(report(), options(directory))));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal(new Set(results.map(result => result.snapshotId)).size, 1);
  assert.deepEqual(await readdir(directory), [results[0].fileName]);
  assert.deepEqual((await readLatestTopicSnapshot({ directory })).report, report());
});

test('concurrent conflicting writers never overwrite the winner', async t => {
  const { directory } = await fixture(t);
  const a = report();
  const b = report();
  b.note = 'same clock, different payload';
  const results = await Promise.allSettled([persistTopicSnapshot(a, options(directory)), persistTopicSnapshot(b, options(directory))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /snapshot_timestamp_conflict/);
  assert.equal((await finalNames(directory)).length, 1);
  const winner = results.find(result => result.status === 'fulfilled').value;
  assert.equal((await readLatestTopicSnapshot({ directory })).snapshotId, winner.snapshotId);
});

test('concurrent distinct captures remain complete and latest is chronologically correct', async t => {
  const { directory } = await fixture(t);
  await persistTopicSnapshot(report(), options(directory));
  const inputs = Array.from({ length: 12 }, (_, index) => report(new Date(Date.parse(capturedAt) + (index + 1) * 60000).toISOString()));
  const saving = Promise.all(inputs.reverse().map(input => persistTopicSnapshot(input, options(directory))));
  for (let i = 0; i < 15; i++) {
    const observed = await readLatestTopicSnapshot({ directory });
    assert.equal(observed.reason, 'latest_snapshot');
    assert.ok(observed.report.topics.basura);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  await saving;
  assert.equal((await finalNames(directory)).length, 13);
  assert.equal((await readLatestTopicSnapshot({ directory })).report.fetchedAt, inputs[0].fetchedAt);
  assert.equal((await readdir(directory)).length, 13);
});

test('oversized payloads and oversized newest files are rejected without fallback', async t => {
  const { directory } = await fixture(t);
  const huge = report();
  huge.extra = 'x'.repeat(TOPIC_HISTORY_LIMITS.maxBytes);
  await assert.rejects(persistTopicSnapshot(huge, options(directory)), /snapshot_too_large/);
  await assert.rejects(access(directory));
  await persistTopicSnapshot(report(), options(directory));
  await writeFile(join(directory, nameFor('2026-10-20T20:00:00.000Z')), Buffer.alloc(TOPIC_HISTORY_LIMITS.maxBytes + 1, 'x'));
  assert.equal((await readLatestTopicSnapshot({ directory })).reason, 'snapshot_too_large');
  assert.equal((await finalNames(directory)).length, 2);
});

test('snapshot-count bound is explicit, retains history and never auto-prunes', async t => {
  const { directory } = await fixture(t);
  await mkdir(directory);
  const start = Date.parse('2026-10-01T00:00:00Z');
  for (let offset = 0; offset < TOPIC_HISTORY_LIMITS.maxSnapshots; offset += 64) {
    await Promise.all(Array.from({ length: Math.min(64, TOPIC_HISTORY_LIMITS.maxSnapshots - offset) }, (_, i) =>
      writeFile(join(directory, nameFor(start + (offset + i) * 1000)), '{}')));
  }
  await assert.rejects(persistTopicSnapshot(report(), options(directory)), /history_snapshot_limit/);
  assert.equal((await finalNames(directory)).length, TOPIC_HISTORY_LIMITS.maxSnapshots);
  await writeFile(join(directory, nameFor(capturedAt)), '{}');
  assert.equal((await readLatestTopicSnapshot({ directory })).reason, 'history_snapshot_limit');
  assert.equal((await finalNames(directory)).length, TOPIC_HISTORY_LIMITS.maxSnapshots + 1);
});

test('old electricity artifacts, missing topics, inconsistent spans and mismatched capture clocks cannot enter history', async t => {
  const { directory } = await fixture(t);
  const candidates = [{ finishedAt: capturedAt, officialSignals: [] }];
  for (const edit of [
    value => { delete value.snapshotSchema; },
    value => { delete value.topics.seguridad; },
    value => { value.topics.basura.analysisVersion = 'old-analysis'; },
    value => { value.topics.basura.span = '1d'; },
    value => { value.topics.basura.fetchedAt = '2026-10-20T19:01:00Z'; },
    value => { value.topics.basura.editorialCases = {}; }
  ]) { const value = report(); edit(value); candidates.push(value); }
  for (const value of candidates) await assert.rejects(persistTopicSnapshot(value, options(directory)), /invalid_topic_payload/);
  await assert.rejects(access(directory));
});

test('invalid times and non-JSON payloads fail before writing, with no sensitive exception detail', async t => {
  const { directory } = await fixture(t);
  for (const invalid of ['2026-02-30T12:00:00Z', '2026-10-20T24:00:00Z', '2026-10-20T19:00:00', '2026-10-20', 'secret-value']) {
    await assert.rejects(persistTopicSnapshot(report(invalid), options(directory)), error => error.message === 'invalid_timestamp');
    await assert.rejects(persistTopicSnapshot(report(), { directory, recordedAt: invalid }), error => error.message === 'invalid_timestamp');
  }
  for (const invalid of [undefined, Infinity, NaN, BigInt(1), () => {}, new Date()]) {
    const value = report(); value.extra = invalid;
    await assert.rejects(persistTopicSnapshot(value, options(directory)), /invalid_payload_value/);
  }
  const cyclic = report(); cyclic.extra = cyclic;
  await assert.rejects(persistTopicSnapshot(cyclic, options(directory)), /invalid_payload_value/);
  const getter = report();
  let touched = false;
  Object.defineProperty(getter, 'secret', { enumerable: true, get() { touched = true; throw new Error('must-not-execute'); } });
  await assert.rejects(persistTopicSnapshot(getter, options(directory)), /invalid_payload_value/);
  assert.equal(touched, false);
  const hidden = report();
  Object.defineProperty(hidden, 'fetchedAt', { value: capturedAt, enumerable: false });
  await assert.rejects(persistTopicSnapshot(hidden, options(directory)), /invalid_payload_value/);
  const sparse = report(); sparse.extra = new Array(1000000000);
  await assert.rejects(persistTopicSnapshot(sparse, options(directory)), /payload_structure_limit/);
  const customArray = report(); customArray.extra = []; customArray.extra.secret = 'ignored-by-JSON';
  await assert.rejects(persistTopicSnapshot(customArray, options(directory)), /invalid_payload_value/);
  const deep = report();
  let cursor = deep;
  for (let i = 0; i < TOPIC_HISTORY_LIMITS.maxDepth + 1; i++) { cursor.child = {}; cursor = cursor.child; }
  await assert.rejects(persistTopicSnapshot(deep, options(directory)), /payload_structure_limit/);
  await assert.rejects(access(directory));
});
