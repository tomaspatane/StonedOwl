import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { deflateRawSync } from 'node:zlib';
import { restorePreviousTopics } from '../scripts/restore-previous-topics.mjs';
import { persistTopicSnapshot } from '../scripts/lib/topic-history-store.mjs';

const exec = promisify(execFile);
const env = { GITHUB_TOKEN: 'test-token-never-forward', GITHUB_REPOSITORY: 'test/stonedowl', GITHUB_RUN_ID: '100' };
const now = Date.parse('2026-10-20T19:00:00Z');
const WORKFLOW = '.github/workflows/electricidad-pilot-hourly.yml';
const HEAD = 'a'.repeat(40);
const MAX_BYTES = 10 * 1024 * 1024;
const run = (id, overrides = {}) => ({
  id, repository: { id: 42, full_name: env.GITHUB_REPOSITORY },
  head_repository: { id: 42, full_name: env.GITHUB_REPOSITORY },
  path: WORKFLOW, head_branch: 'main', head_sha: HEAD, event: 'schedule', status: 'completed',
  conclusion: 'success', created_at: '2026-10-20T18:00:00Z', run_started_at: '2026-10-20T18:00:00Z', ...overrides
});
const artifact = (runId = 90, overrides = {}) => ({
  id: Number(runId) + 1000, name: `stonedowl-topics-${runId}`,
  workflow_run: { id: runId, repository_id: 42, head_repository_id: 42, head_branch: 'main', head_sha: HEAD },
  expired: false, created_at: '2026-10-20T18:05:00Z', expires_at: '2026-11-20T00:00:00Z',
  size_in_bytes: 1000, ...overrides
});
const version = { version: 'caba-topics-v1', snapshotSchema: 'caba-topic-snapshot-v1', analysisVersion: 'caba-topics-analysis-2026-10-20.1' };
function report(health = 'healthy') {
  const fetchedAt = '2026-10-20T18:00:00.000Z';
  return { ...version, fetchedAt, editorialCases: [], ok: health === 'healthy', captureHealth: { status: health },
    topics: Object.fromEntries(['basura', 'transporte', 'seguridad'].map(topicId => [topicId, {
      ...version, topicId, fetchedAt, span: '1w', sourceHealth: [], editorialCases: [],
      counts: { acceptedCount: 0 }, captureHealth: { status: health }
    }])) };
}

// Bounded ZIP fixtures, including path traversal, duplicate names and a deflate
// bomb. Tests never need a network request, external credentials, or extraction.
function zip(entries, compressed = false) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of Array.isArray(entries) ? entries : Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(value);
    const packed = compressed ? deflateRawSync(data) : data;
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(compressed ? 8 : 0, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(compressed ? 8 : 0, 10); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, filename, packed); central.push(entry, filename);
    offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function fixture(t, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'stonedowl-topic-restore-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const history = join(directory, 'fixture-history');
  const saved = await persistTopicSnapshot(config.report || report(), { directory: history, recordedAt: '2026-10-20T18:01:00.000Z' });
  const envelope = JSON.parse(await readFile(join(history, saved.fileName), 'utf8'));
  if (config.mutateEnvelope) config.mutateEnvelope(envelope);
  const entries = config.entries || { 'topic-snapshot.json': JSON.stringify(envelope) };
  const outputPath = join(directory, 'previous.json');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.Authorization, `Bearer ${env.GITHUB_TOKEN}`);
      assert.equal(options.redirect, 'manual');
      if (config.respond) {
        const override = await config.respond(url, options);
        if (override) return override;
      }
      const u = new URL(url), page = Number(u.searchParams.get('page'));
      if (u.pathname.endsWith('/workflows/electricidad-pilot-hourly.yml/runs')) {
        assert.equal(u.searchParams.get('branch'), 'main');
        assert.equal(u.searchParams.get('status'), 'completed');
        assert.equal(u.searchParams.get('created'), '>=2026-10-18T19:00:00.000Z');
        return Response.json({ workflow_runs: config.runPages?.[page - 1] || (page === 1 ? [run(90)] : []) });
      }
      if (/\/runs\/\d+$/.test(u.pathname)) {
        const id = Number(u.pathname.split('/').at(-1));
        return Response.json(config.metadata ? config.metadata(id) : run(id));
      }
      if (/\/runs\/\d+\/artifacts$/.test(u.pathname)) {
        const id = Number(u.pathname.split('/').at(-2));
        return Response.json({ artifacts: config.artifactPages?.[page - 1] || (page === 1 ? [artifact(id)] : []) });
      }
      if (u.pathname.endsWith('/zip')) return new Response(null, { status: 302, headers: { location: config.redirect || 'https://storage.example.test/archive?signature=private-signature' } });
      assert.fail(`Unexpected API path ${u.pathname}`);
    }
    assert.deepEqual(options.headers, {});
    assert.equal(options.redirect, 'error');
    if (config.storageResponse) return config.storageResponse();
    return new Response(config.bytes || zip(entries, config.compressed));
  };
  return { directory, outputPath, calls, envelope, options: { env, now, outputPath, fetchImpl } };
}
const absent = path => assert.rejects(access(path), { code: 'ENOENT' });
const metadataCalls = f => f.calls.filter(c => /\/runs\/\d+$/.test(new URL(c.url).pathname));
const downloadCalls = f => f.calls.filter(c => c.url.includes('/artifacts/') && c.url.endsWith('/zip'));

async function rejectsAndClears(t, config, pattern) {
  const f = await fixture(t, config);
  await writeFile(f.outputPath, 'stale');
  await assert.rejects(restorePreviousTopics(f.options), pattern);
  await absent(f.outputPath);
  assert.equal((await readdir(f.directory)).filter(name => name.includes('.pending-')).length, 0);
  return f;
}

test('restores exact envelope from latest prior canonical run with independent provenance and no token forwarding', async t => {
  const f = await fixture(t, { runPages: [[run(80), run(90), run(100), run(101),
    run(99, { head_branch: 'feature' }), run(98, { event: 'pull_request' }), run(97, { status: 'in_progress' })]] });
  const result = await restorePreviousTopics(f.options);
  assert.equal(result.restored, true);
  assert.equal(result.runId, 90);
  assert.equal(result.artifactId, 1090);
  assert.equal(result.snapshotId, f.envelope.snapshotId);
  assert.deepEqual(JSON.parse(await readFile(f.outputPath, 'utf8')), f.envelope);
  assert.equal((await lstat(f.outputPath)).mode & 0o777, 0o600);
  assert.equal(f.calls.length, 5);
  assert.ok(f.calls[1].url.endsWith('/runs/90'));
  assert.ok(f.calls[2].url.includes('/runs/90/artifacts?'));
  assert.ok(!JSON.stringify(result).includes(env.GITHUB_TOKEN));
});

test('accepts main-qualified GitHub workflow paths and manual main runs', async t => {
  for (const path of [WORKFLOW, `${WORKFLOW}@main`, `${WORKFLOW}@refs/heads/main`]) {
    const f = await fixture(t, { metadata: id => run(id, { path, event: 'workflow_dispatch' }) });
    assert.equal((await restorePreviousTopics(f.options)).restored, true);
  }
});

test('retains failed/degraded latest captures and failed completed runs instead of cherry-picking health', async t => {
  for (const health of ['failed', 'degraded']) {
    const f = await fixture(t, { report: report(health), runPages: [[run(80), run(90)]], metadata: id => run(id, { conclusion: 'failure' }) });
    assert.equal((await restorePreviousTopics(f.options)).runId, 90);
    assert.equal(JSON.parse(await readFile(f.outputPath, 'utf8')).payload.captureHealth.status, health);
    assert.equal(metadataCalls(f).length, 1);
  }
});

test('missing latest artifact is unknown, never an older run artifact or stale local file', async t => {
  const f = await fixture(t, { runPages: [[run(80), run(90)]], artifactPages: [[artifact(80), artifact(90, { name: 'some-other-artifact' })]] });
  await writeFile(f.outputPath, 'stale');
  assert.deepEqual(await restorePreviousTopics(f.options), { restored: false, reason: 'previous_artifact_missing', runId: 90 });
  await absent(f.outputPath);
  assert.equal(metadataCalls(f).length, 1);
  assert.equal(downloadCalls(f).length, 0);
});

test('expired latest artifact never falls back to older captures', async t => {
  for (const overrides of [{ expired: true }, { expires_at: '2026-10-20T18:59:59Z' }]) {
    const f = await rejectsAndClears(t, { runPages: [[run(80), run(90)]], artifactPages: [[artifact(90, overrides)]] }, /invalid_previous_artifact/);
    assert.equal(metadataCalls(f).length, 1);
    assert.equal(downloadCalls(f).length, 0);
  }
});

test('pins run metadata repository, workflow, branch, event, completed status, id and commit', async t => {
  const changes = [
    { repository: { id: 42, full_name: 'attacker/stonedowl' } },
    { head_repository: { id: 43, full_name: env.GITHUB_REPOSITORY } },
    { head_repository: { id: 42, full_name: 'attacker/stonedowl' } },
    { path: '.github/workflows/ci.yml' }, { path: `${WORKFLOW}@feature` },
    { head_branch: 'feature' }, { event: 'pull_request' }, { event: 'push' },
    { status: 'in_progress' }, { id: 91 }, { head_sha: 'bad' }, { created_at: '2026-10-20T17:00:00Z' },
    { run_started_at: 'bad' }, { run_started_at: '2026-10-20T17:59:59Z' }, { run_started_at: '2026-10-21T00:00:00Z' }
  ];
  for (const changeset of changes) {
    const f = await rejectsAndClears(t, { metadata: id => run(id, changeset) }, /invalid_run_provenance/);
    assert.equal(f.calls.length, 2);
  }
});

test('does not consider CI, other branches, future/current runs or unsupported events', async t => {
  const f = await fixture(t, { runPages: [[run(100), run(101), run(99, { event: 'push' }), run(98, { head_branch: 'feature' })]] });
  assert.deepEqual(await restorePreviousTopics(f.options), { restored: false, reason: 'no_previous_run' });
  assert.equal(f.calls.length, 1);
  const wrongWorkflow = await rejectsAndClears(t, { metadata: id => run(id, { path: '.github/workflows/ci.yml' }) }, /invalid_run_provenance/);
  assert.equal(downloadCalls(wrongWorkflow).length, 0);
});

test('artifact provenance, size, timestamps and unique exact name are required', async t => {
  for (const overrides of [
    { id: '../bad' }, { workflow_run: { ...artifact().workflow_run, id: 80 } },
    { workflow_run: { ...artifact().workflow_run, repository_id: 43 } },
    { workflow_run: { ...artifact().workflow_run, head_repository_id: 43 } },
    { workflow_run: { ...artifact().workflow_run, head_branch: 'feature' } },
    { workflow_run: { ...artifact().workflow_run, head_sha: 'b'.repeat(40) } },
    { expired: undefined }, { created_at: 'invalid' }, { created_at: '2026-10-21T00:00:00Z' },
    { expires_at: 'invalid' }, { size_in_bytes: -1 }, { size_in_bytes: '1000' }
  ]) {
    const f = await rejectsAndClears(t, { artifactPages: [[artifact(90, overrides)]] }, /invalid_previous_artifact/);
    assert.equal(downloadCalls(f).length, 0);
  }
  await rejectsAndClears(t, { artifactPages: [[artifact(90), artifact(90, { id: 1091 })]] }, /ambiguous_previous_artifact/);
});

test('first run and older-than-comparison-window runs are unknown and only remove explicit output', async t => {
  for (const runPages of [[[]], [[run(90, { created_at: '2026-10-17T00:00:00Z' })]]]) {
    const f = await fixture(t, { runPages });
    const unrelated = join(f.directory, 'keep-this.json');
    await writeFile(unrelated, 'keep'); await writeFile(f.outputPath, 'stale');
    assert.deepEqual(await restorePreviousTopics(f.options), { restored: false, reason: 'no_previous_run' });
    await absent(f.outputPath);
    assert.equal(await readFile(unrelated, 'utf8'), 'keep');
  }
});

test('malformed latest run discovery and denied metadata do not fall back', async t => {
  await rejectsAndClears(t, { runPages: [[run(80), run(90, { created_at: 'invalid' })]] }, /invalid_run_list/);
  const f = await rejectsAndClears(t, { runPages: [[run(80), run(90)]], respond: url => url.endsWith('/runs/90') ? new Response('private-error-body', { status: 403 }) : null }, /run_metadata_http_403/);
  assert.equal(metadataCalls(f).length, 1);
});

test('finds latest prior run and artifact across unordered bounded pages', async t => {
  const firstRuns = Array.from({ length: 100 }, (_, i) => run(1000 + i));
  firstRuns[5] = run(80);
  const otherArtifacts = Array.from({ length: 100 }, (_, i) => artifact(91, { id: 2000 + i, name: `other-${i}` }));
  const f = await fixture(t, { runPages: [firstRuns, [run(90), run(91)]], artifactPages: [otherArtifacts, [artifact(91)]] });
  assert.equal((await restorePreviousTopics(f.options)).runId, 91);
  assert.ok(f.calls.some(c => c.url.includes('/workflows/') && c.url.endsWith('page=2')));
  assert.ok(f.calls.some(c => c.url.includes('/runs/91/artifacts') && c.url.endsWith('page=2')));
});

test('bounds both list page counts rather than using incomplete discovery', async t => {
  const fullRuns = Array.from({ length: 100 }, (_, i) => run(1000 + i));
  const runs = await rejectsAndClears(t, { runPages: Array.from({ length: 20 }, () => fullRuns) }, /run_list_page_limit/);
  assert.equal(runs.calls.length, 20);
  const other = Array.from({ length: 100 }, (_, i) => artifact(90, { name: `other-${i}` }));
  const artifacts = await rejectsAndClears(t, { artifactPages: Array.from({ length: 20 }, () => other) }, /artifact_list_page_limit/);
  assert.equal(artifacts.calls.length, 22);
});

test('reads exact root member without extracting traversal or absolute paths', async t => {
  const f = await fixture(t);
  const filename = `stonedowl-escape-${randomUUID()}.json`;
  const outside = join(tmpdir(), filename);
  const archive = zip({ [`../../${filename}`]: 'attack', [outside]: 'attack',
    'nested/topic-snapshot.json': '{"wrong":true}', 'topic-snapshot.json': JSON.stringify(f.envelope) });
  const fetchImpl = async (url, options) => url.startsWith('https://api.github.com/') ? f.options.fetchImpl(url, options) : new Response(archive);
  assert.equal((await restorePreviousTopics({ ...f.options, fetchImpl })).restored, true);
  assert.deepEqual(JSON.parse(await readFile(f.outputPath, 'utf8')), f.envelope);
  await absent(outside);
});

test('missing root, nested-only, duplicate roots, invalid JSON and corrupt ZIP fail safely', async t => {
  for (const entries of [
    { 'nested/topic-snapshot.json': '{}' }, { 'topic-snapshot.json': '{bad' },
    { 'topic-snapshot.json': '[]' }, [['topic-snapshot.json', '{}'], ['topic-snapshot.json', '{}']]
  ]) await rejectsAndClears(t, { entries });
  await rejectsAndClears(t, { bytes: Buffer.from('not a zip') }, /invalid_snapshot_archive/);
  const f = await fixture(t);
  const duplicate = zip([['topic-snapshot.json', JSON.stringify(f.envelope)], ['topic-snapshot.json', '']]);
  await rejectsAndClears(t, { bytes: duplicate }, /invalid_snapshot_archive/);
});

test('schema, canonical digest and envelope identity are validated by the shared store', async t => {
  for (const mutateEnvelope of [
    e => { e.payload.extra = 'tampered'; }, e => { e.payloadSha256 = '0'.repeat(64); },
    e => { e.snapshotId = 'forged'; }, e => { e.format = 'unknown'; },
    e => { e.extra = true; }, e => { e.capturedAt = '2026-10-20T17:00:00.000Z'; },
    e => { e.recordedAt = 'bad'; }, e => { e.payload.topics.basura.span = 'unknown'; }
  ]) await rejectsAndClears(t, { mutateEnvelope });
});

test('rejects old valid snapshots uploaded by a fresh run and stale same-run attempt artifacts', async t => {
  const old = report();
  old.fetchedAt = '2026-10-20T17:00:00.000Z';
  for (const topic of Object.values(old.topics)) topic.fetchedAt = old.fetchedAt;
  await rejectsAndClears(t, { report: old }, /snapshot_run_time_mismatch/);
  for (const recordedAt of ['2026-10-20T17:00:00.000Z', '2026-10-20T18:10:00.000Z']) {
    await rejectsAndClears(t, { mutateEnvelope: e => { e.recordedAt = recordedAt; } }, /snapshot_run_time_mismatch/);
  }
  await rejectsAndClears(t, { metadata: id => run(id, { run_started_at: '2026-10-20T18:30:00Z', run_attempt: 2 }) }, /invalid_previous_artifact/);
});

test('accepts canonical checksum independent of serialized property order', async t => {
  const f = await fixture(t, { mutateEnvelope: e => {
    e.payload = Object.fromEntries(Object.entries(e.payload).reverse());
    e.payload.topics = Object.fromEntries(Object.entries(e.payload.topics).reverse());
  } });
  assert.equal((await restorePreviousTopics(f.options)).restored, true);
});

test('oversized advertised artifacts, response headers, streams and inflated members are bounded', async t => {
  const declared = await rejectsAndClears(t, { artifactPages: [[artifact(90, { size_in_bytes: MAX_BYTES + 1 })]] }, /artifact_too_large/);
  assert.equal(downloadCalls(declared).length, 0);
  await rejectsAndClears(t, { storageResponse: () => new Response('small', { headers: { 'content-length': String(MAX_BYTES + 1) } }) }, /response_too_large/);
  await rejectsAndClears(t, { storageResponse: () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close();
  } })) }, /response_too_large/);
  await rejectsAndClears(t, { entries: { 'topic-snapshot.json': ' '.repeat(MAX_BYTES + 1) }, compressed: true }, /invalid_snapshot_archive/);
});

test('rejects insecure, credential-bearing and absent redirects; no auth on signed storage', async t => {
  for (const redirect of ['http://storage.example.test/archive', 'https://user:password@storage.example.test/archive', 'not-a-url']) {
    const f = await rejectsAndClears(t, { redirect }, /invalid_artifact_redirect/);
    assert.equal(f.calls.length, 4);
  }
  await rejectsAndClears(t, { respond: url => url.endsWith('/zip') ? new Response(null, { status: 302 }) : null }, /invalid_artifact_redirect/);
  await rejectsAndClears(t, { storageResponse: () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.test' } }) }, /artifact_storage_http_302/);
});

test('denied API and storage responses are unknown without logging response bodies', async t => {
  for (const [match, code] of [
    ['/workflows/', 'run_list_http_403'], ['/runs/90/artifacts', 'artifact_list_http_403'], ['/artifacts/1090/zip', 'artifact_download_http_403']
  ]) await rejectsAndClears(t, { respond: url => url.includes(match) ? new Response('secret-error-body', { status: 403 }) : null }, new RegExp(code));
  await rejectsAndClears(t, { storageResponse: () => new Response('secret-error-body', { status: 403 }) }, /artifact_storage_http_403/);
});

test('malformed or oversized API results are refused', async t => {
  await rejectsAndClears(t, { respond: url => url.includes('/workflows/') ? new Response('{bad') : null }, /invalid_run_list_json/);
  await rejectsAndClears(t, { respond: url => url.includes('/workflows/') ? Response.json({ workflow_runs: {} }) : null }, /invalid_run_list/);
  await rejectsAndClears(t, { respond: url => url.includes('/workflows/') ? new Response('{}', { headers: { 'content-length': String(MAX_BYTES + 1) } }) : null }, /response_too_large/);
});

test('invalid environment clears stale output and never makes a request', async t => {
  for (const bad of [{}, { ...env, GITHUB_REPOSITORY: 'test/repo/escape' }, { ...env, GITHUB_RUN_ID: '9007199254740993x' }]) {
    const f = await fixture(t);
    await writeFile(f.outputPath, 'stale');
    await assert.rejects(restorePreviousTopics({ ...f.options, env: bad }), /missing_or_invalid_github_environment/);
    await absent(f.outputPath);
    assert.equal(f.calls.length, 0);
  }
});

test('invalid comparison dates fail with a safe code before network calls', async t => {
  for (const now of [NaN, Infinity, 1e100, -8640000000000000]) {
    const f = await fixture(t);
    await writeFile(f.outputPath, 'stale');
    await assert.rejects(restorePreviousTopics({ ...f.options, now }), /missing_or_invalid_github_environment/);
    await absent(f.outputPath);
    assert.equal(f.calls.length, 0);
  }
});

test('rejects output ancestor symlinks and leaves unrelated target intact', async t => {
  const f = await fixture(t);
  const real = join(f.directory, 'real'), linked = join(f.directory, 'linked');
  await mkdir(real); await writeFile(join(real, 'previous.json'), 'keep'); await symlink(real, linked);
  await assert.rejects(restorePreviousTopics({ ...f.options, outputPath: join(linked, 'previous.json') }), /unsafe_output_directory/);
  assert.equal(await readFile(join(real, 'previous.json'), 'utf8'), 'keep');
  assert.equal(f.calls.length, 0);
});

test('CLI logs only a static safe warning on an unavailable baseline', async t => {
  const f = await fixture(t);
  const cli = resolve('scripts/restore-previous-topics.mjs');
  await mkdir(join(f.directory, 'tmp'));
  const outputPath = join(f.directory, 'tmp/previous-topics-snapshot.json');
  await writeFile(outputPath, 'stale');
  const result = await exec(process.execPath, [cli], { cwd: f.directory, env: { PATH: process.env.PATH, GITHUB_TOKEN: env.GITHUB_TOKEN } });
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '::warning::Previous topic snapshot could not be restored; comparison remains unknown.\n');
  assert.ok(!result.stderr.includes(env.GITHUB_TOKEN));
  await absent(outputPath);
});



test('rerun restores the latest attempt only when older names are duplicated', async t => {
  const old = artifact(90, { id: 1089, created_at: '2026-10-20T17:05:00Z' });
  const f = await fixture(t, {
    runPages: [[run(90, { created_at: '2026-10-20T17:00:00Z' })]],
    metadata: id => run(id, { created_at: '2026-10-20T17:00:00Z', run_attempt: 2 }),
    artifactPages: [[old, artifact(90)]]
  });
  const result = await restorePreviousTopics(f.options);
  assert.equal(result.artifactId, 1090);
  assert.equal(downloadCalls(f).length, 1);
});
