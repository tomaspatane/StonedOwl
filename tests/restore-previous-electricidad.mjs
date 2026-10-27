import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restorePreviousReport } from '../scripts/restore-previous-electricidad.mjs';

const env = { GITHUB_TOKEN: 'test-token-never-forward', GITHUB_REPOSITORY: 'test/stonedowl', GITHUB_RUN_ID: '100' };
const now = Date.parse('2026-10-19T19:00:00Z');
const report = { finishedAt: '2026-10-19T18:00:00Z', officialSignals: [] };
const artifact = (id, other = {}) => ({
  id, name: `stonedowl-electricidad-${id}`, workflow_run: { id }, expired: false,
  created_at: `2026-10-19T18:${String(id % 60).padStart(2, '0')}:00Z`,
  expires_at: '2026-11-01T00:00:00Z', size_in_bytes: 1000, ...other
});

// Small stored ZIP fixtures, including hostile names, without extracting any paths.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(value);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function fixture(t, { pages = [[artifact(90)]], entries = { 'live-electricidad-report.json': JSON.stringify(report) }, redirect = 'https://storage.example.test/signed-secret', failList = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'stonedowl-restore-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, 'previous.json');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.Authorization, `Bearer ${env.GITHUB_TOKEN}`);
      assert.equal(options.redirect, 'manual');
      if (url.endsWith('/zip')) return new Response(null, { status: 302, headers: { location: redirect } });
      if (failList) return new Response('denied', { status: 403 });
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json({ artifacts: pages[page - 1] || [] });
    }
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(zip(entries));
  };
  return { outputPath, calls, options: { env, now, outputPath, fetchImpl } };
}

test('restores latest prior artifact and strips authentication at storage redirect', async t => {
  const f = await fixture(t, { pages: [[
    artifact(80), artifact(90), artifact(99, { expired: true }), artifact(100), artifact(101),
    artifact(98, { expires_at: '2026-10-19T00:00:00Z' }),
    artifact(97, { name: 'different-artifact' }), artifact(96, { workflow_run: { id: 95 } })
  ]] });
  const result = await restorePreviousReport(f.options);
  assert.equal(result.restored, true);
  assert.equal(result.runId, 90);
  assert.deepEqual(JSON.parse(await readFile(f.outputPath, 'utf8')), report);
  assert.ok(f.calls[1].url.endsWith('/90/zip'));
  assert.equal(f.calls.length, 3);
});

test('searches later pages and does not assume listing order', async t => {
  const f = await fixture(t, { pages: [Array.from({ length: 100 }, (_, i) => artifact(1000 + i)), [artifact(90), artifact(91)]] });
  assert.equal((await restorePreviousReport(f.options)).runId, 91);
  assert.ok(f.calls[1].url.endsWith('page=2'));
});

test('first run has no baseline and clears a stale local file', async t => {
  const f = await fixture(t, { pages: [[]] });
  await writeFile(f.outputPath, 'stale');
  assert.deepEqual(await restorePreviousReport(f.options), { restored: false, reason: 'no_previous_artifact' });
  await assert.rejects(access(f.outputPath));
  assert.equal(f.calls.length, 1);
});

test('reads only the root report, never extracts hostile ZIP paths', async t => {
  const f = await fixture(t, { entries: {
    '../../stonedowl-escaped-test.json': 'attack',
    '/tmp/stonedowl-absolute-test.json': 'attack',
    'nested/live-electricidad-report.json': '{"wrong":true}',
    'live-electricidad-report.json': JSON.stringify(report)
  } });
  await restorePreviousReport(f.options);
  assert.deepEqual(JSON.parse(await readFile(f.outputPath, 'utf8')), report);
  await assert.rejects(access('/tmp/stonedowl-escaped-test.json'));
  await assert.rejects(access('/tmp/stonedowl-absolute-test.json'));
});

test('missing root report or invalid JSON never becomes a baseline', async t => {
  for (const entries of [{ 'nested/live-electricidad-report.json': '{}' }, { 'live-electricidad-report.json': '{bad' }, { 'live-electricidad-report.json': '[]' }]) {
    const f = await fixture(t, { entries });
    await assert.rejects(restorePreviousReport(f.options));
    await assert.rejects(access(f.outputPath));
  }
});

test('denied API and insecure redirect fail safely without a baseline', async t => {
  const denied = await fixture(t, { failList: true });
  await writeFile(denied.outputPath, 'stale');
  await assert.rejects(restorePreviousReport(denied.options), /artifact_list_http_403/);
  await assert.rejects(access(denied.outputPath));
  const insecure = await fixture(t, { redirect: 'http://storage.example.test/archive' });
  await assert.rejects(restorePreviousReport(insecure.options), /invalid_artifact_redirect/);
  assert.equal(insecure.calls.length, 2);
});

test('missing GitHub context makes no network call', async t => {
  const f = await fixture(t);
  await assert.rejects(restorePreviousReport({ ...f.options, env: {} }), /missing_or_invalid_github_environment/);
  assert.equal(f.calls.length, 0);
});

test('refuses oversized artifact before download', async t => {
  const f = await fixture(t, { pages: [[artifact(90, { size_in_bytes: 11 * 1024 * 1024 })]] });
  await assert.rejects(restorePreviousReport(f.options), /artifact_too_large/);
  assert.equal(f.calls.length, 1);
});
