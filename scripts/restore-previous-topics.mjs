import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { TOPIC_HISTORY_LIMITS as COMPARISON_LIMITS } from '../data/caba-topic-history.js';
import { validateTopicSnapshotEnvelope } from './lib/topic-history-store.mjs';

const unzip = promisify(execFile);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 20;
const WORKFLOW = '.github/workflows/electricidad-pilot-hourly.yml';
const WORKFLOW_PATHS = new Set([WORKFLOW, `${WORKFLOW}@main`, `${WORKFLOW}@refs/heads/main`]);
const EVENTS = new Set(['schedule', 'workflow_dispatch']);
const ROOT_MEMBER = 'topic-snapshot.json';
const failure = code => Object.assign(new Error(code), { code });
const validId = value => (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) && /^[1-9]\d{0,19}$/.test(String(value));
const sameId = (a, b) => validId(a) && validId(b) && String(a) === String(b);
const sameRepository = (value, expected) => typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();

async function boundedBody(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw failure('response_too_large');
  if (!response.body) throw failure('missing_response_body');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw failure('response_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function parseJson(bytes, code) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw failure(code); }
}

// Only the caller's explicit baseline file is removed. Never clear a history
// directory or follow an ancestor symlink while clearing/publishing that file.
async function safeOutputParent(outputPath, create = false) {
  const parent = dirname(outputPath);
  const root = parse(parent).root;
  let current = root;
  for (const part of parent.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw failure('output_directory_unavailable');
      if (!create) return;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw failure('output_directory_unavailable'); }
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('unsafe_output_directory');
  }
}

/** Opt-in, GET-only import. The latest eligible run is selected BEFORE looking
 * for an artifact: missing/corrupt/failed predecessors never trigger a fallback
 * to an older, healthier baseline. The caller must use outputPath explicitly.
 */
export async function restorePreviousTopics({
  env = process.env,
  fetchImpl = globalThis.fetch,
  outputPath = resolve('tmp/previous-topics-snapshot.json'),
  now = Date.now()
} = {}) {
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw failure('invalid_output_path');
  outputPath = resolve(outputPath);
  if (outputPath === parse(outputPath).root) throw failure('invalid_output_path');
  await safeOutputParent(outputPath);
  await rm(outputPath, { force: true });
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: currentRun } = env;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !validId(currentRun) ||
      !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()) ||
      !Number.isFinite(new Date(now - COMPARISON_LIMITS.maxIntervalMs).getTime())) {
    throw failure('missing_or_invalid_github_environment');
  }
  const base = `https://api.github.com/repos/${repository}/actions`;
  const headers = {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const request = async (url, authenticated = true) => {
    try {
      return await fetchImpl(url, { method: 'GET', headers: authenticated ? headers : {}, credentials: 'omit',
        redirect: authenticated ? 'manual' : 'error', signal: AbortSignal.timeout(20_000) });
    } catch { throw failure(authenticated ? 'github_request_failed' : 'artifact_storage_failed'); }
  };
  const json = async (url, label) => {
    const response = await request(url);
    if (!response.ok) throw failure(`${label}_http_${response.status}`);
    return parseJson(await boundedBody(response), `invalid_${label}_json`);
  };
  const list = async (url, key, label) => {
    const values = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await json(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`, label);
      if (!data || !Array.isArray(data[key]) || data[key].length > 100) throw failure(`invalid_${label}`);
      values.push(...data[key]);
      if (data[key].length < 100) return values;
    }
    throw failure(`${label}_page_limit`);
  };

  // Older captures cannot form a valid pair. Bound discovery by that comparison
  // window as well as page count, rather than scanning an ever-growing archive.
  const earliest = now - COMPARISON_LIMITS.maxIntervalMs;
  const created = encodeURIComponent(`>=${new Date(earliest).toISOString()}`);
  const runs = await list(`${base}/workflows/electricidad-pilot-hourly.yml/runs?branch=main&status=completed&created=${created}`, 'workflow_runs', 'run_list');
  const candidates = runs.filter(run => run && validId(run.id) && BigInt(run.id) < BigInt(currentRun) &&
    run.head_branch === 'main' && run.status === 'completed' && EVENTS.has(run.event));
  candidates.sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0);
  const candidate = candidates[0];
  if (!candidate) return { restored: false, reason: 'no_previous_run' };
  const createdAt = Date.parse(candidate.created_at);
  if (!Number.isFinite(createdAt) || createdAt > now) throw failure('invalid_run_list');
  if (createdAt < earliest) return { restored: false, reason: 'no_previous_run' };

  // Do not trust artifact names, the caller's branch, list metadata, or URLs in
  // API responses as proof of provenance. Pin the chosen run independently.
  const run = await json(`${base}/runs/${candidate.id}`, 'run_metadata');
  const runStartedAt = Date.parse(run?.run_started_at);
  if (!run || !sameId(run.id, candidate.id) || !sameRepository(run.repository?.full_name, repository) ||
      !sameRepository(run.head_repository?.full_name, repository) || !sameId(run.repository?.id, run.head_repository?.id) ||
      !WORKFLOW_PATHS.has(run.path) || run.head_branch !== 'main' || !EVENTS.has(run.event) || run.status !== 'completed' ||
      run.created_at !== candidate.created_at || !Number.isFinite(runStartedAt) || runStartedAt < createdAt || runStartedAt > now ||
      !/^[a-f0-9]{40}$/i.test(run.head_sha || '')) {
    throw failure('invalid_run_provenance');
  }
  // Deliberately do not test run.conclusion or capture health.
  const artifacts = await list(`${base}/runs/${run.id}/artifacts`, 'artifacts', 'artifact_list');
  const named = artifacts.filter(artifact => artifact?.name === `stonedowl-topics-${run.id}`);
  // Re-runs can retain artifacts with the same name from older attempts.
  // Use the independently verified latest attempt start, never artifact health.
  const matching = named.length > 1 ? named.filter(artifact => Date.parse(artifact.created_at) >= runStartedAt) : named;
  if (named.length && !matching.length) throw failure('invalid_previous_artifact');
  if (!matching.length) return { restored: false, reason: 'previous_artifact_missing', runId: run.id };
  if (matching.length !== 1) throw failure('ambiguous_previous_artifact');
  const artifact = matching[0];
  const artifactCreatedAt = Date.parse(artifact.created_at);
  if (!validId(artifact.id) || !sameId(artifact.workflow_run?.id, run.id) ||
      !sameId(artifact.workflow_run?.repository_id, run.repository.id) ||
      !sameId(artifact.workflow_run?.head_repository_id, run.head_repository.id) ||
      artifact.workflow_run?.head_branch !== 'main' || artifact.workflow_run?.head_sha !== run.head_sha ||
      artifact.expired !== false || !Number.isFinite(artifactCreatedAt) || artifactCreatedAt < runStartedAt || artifactCreatedAt > now ||
      !Number.isFinite(Date.parse(artifact.expires_at)) || Date.parse(artifact.expires_at) <= now ||
      !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1) throw failure('invalid_previous_artifact');
  if (artifact.size_in_bytes > MAX_BYTES) throw failure('artifact_too_large');

  const redirect = await request(`${base}/artifacts/${artifact.id}/zip`);
  if (redirect.status !== 302) throw failure(`artifact_download_http_${redirect.status}`);
  let location;
  try { location = new URL(redirect.headers.get('location')); }
  catch { throw failure('invalid_artifact_redirect'); }
  if (location.protocol !== 'https:' || location.username || location.password) throw failure('invalid_artifact_redirect');
  // Storage receives no token/cookies/custom headers, and cannot redirect again.
  const archive = await request(location.href, false);
  if (!archive.ok) throw failure(`artifact_storage_http_${archive.status}`);
  const bytes = await boundedBody(archive);
  const temporary = await mkdtemp(join(tmpdir(), 'stonedowl-topic-restore-'));
  const pendingPath = `${outputPath}.pending-${randomUUID()}`;
  try {
    const archivePath = join(temporary, 'artifact.zip');
    await writeFile(archivePath, bytes, { mode: 0o600 });
    let stdout;
    try {
      // Reject ambiguous duplicate roots, even if concatenating them would be
      // valid JSON (e.g. an empty duplicate). Listing never extracts a path.
      const names = await unzip('unzip', ['-Z1', archivePath], {
        encoding: 'utf8', maxBuffer: MAX_BYTES, timeout: 20_000
      });
      if (names.stdout.split('\n').filter(name => name === ROOT_MEMBER).length !== 1) throw failure('ambiguous_snapshot_member');
      // Exact root member only; no archive path is ever extracted to disk.
      ({ stdout } = await unzip('unzip', ['-p', archivePath, ROOT_MEMBER], {
        encoding: 'buffer', maxBuffer: MAX_BYTES, timeout: 20_000
      }));
    } catch { throw failure('invalid_snapshot_archive'); }
    const envelope = parseJson(stdout, 'invalid_snapshot_json');
    const validated = validateTopicSnapshotEnvelope(envelope);
    const capturedAt = Date.parse(validated.report.fetchedAt);
    const recordedAt = Date.parse(validated.recordedAt);
    const skew = COMPARISON_LIMITS.maxClockSkewMs;
    // A fresh run must not launder a valid but old local envelope. Also reject
    // an artifact left over from a previous attempt of this same workflow run.
    if (capturedAt < runStartedAt - skew || capturedAt > artifactCreatedAt + skew ||
        recordedAt < runStartedAt - skew || recordedAt < capturedAt - skew || recordedAt > artifactCreatedAt + skew) {
      throw failure('snapshot_run_time_mismatch');
    }
    await safeOutputParent(outputPath, true);
    await writeFile(pendingPath, stdout, { mode: 0o600, flag: 'wx' });
    await safeOutputParent(outputPath);
    await rename(pendingPath, outputPath);
    return { restored: true, artifactId: artifact.id, runId: run.id, snapshotId: validated.snapshotId, outputPath };
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(pendingPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await restorePreviousTopics();
    console.log(result.restored ? `Previous topic snapshot restored from run ${result.runId}.` : 'No previous topic snapshot; comparison remains unknown.');
  } catch {
    // No token, signed storage URL, response body, payload or exception logging.
    console.warn('::warning::Previous topic snapshot could not be restored; comparison remains unknown.');
  }
}

