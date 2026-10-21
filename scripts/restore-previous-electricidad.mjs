import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const unzip = promisify(execFile);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 20;
const REPORT_NAME = 'live-electricidad-report.json';

async function boundedBody(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('response_too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('response_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Read-only GitHub API calls. Never forward GITHUB_TOKEN to artifact storage.
export async function restorePreviousReport({
  env = process.env,
  fetchImpl = globalThis.fetch,
  outputPath = resolve('tmp/previous-electricidad-report.json'),
  now = Date.now()
} = {}) {
  // A failed restore must not silently reuse a stale local baseline.
  await rm(outputPath, { force: true });
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: currentRun } = env;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^\d+$/.test(currentRun || '')) {
    throw new Error('missing_or_invalid_github_environment');
  }
  const base = `https://api.github.com/repos/${repository}/actions/artifacts`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const request = (url, authenticated = true) => fetchImpl(url, {
    method: 'GET', headers: authenticated ? headers : {},
    redirect: authenticated ? 'manual' : 'error', signal: AbortSignal.timeout(20_000)
  });
  const candidates = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error('artifact_page_limit');
    const response = await request(`${base}?per_page=100&page=${page}`);
    if (!response.ok) throw new Error(`artifact_list_http_${response.status}`);
    const data = JSON.parse((await boundedBody(response)).toString('utf8'));
    if (!Array.isArray(data.artifacts)) throw new Error('invalid_artifact_list');
    for (const artifact of data.artifacts) {
      const run = String(artifact.workflow_run?.id || '');
      if (!/^\d+$/.test(run) || BigInt(run) >= BigInt(currentRun)) continue;
      if (artifact.name !== `stonedowl-electricidad-${run}` || artifact.expired !== false) continue;
      if (!/^\d+$/.test(String(artifact.id)) || !Number.isFinite(Date.parse(artifact.created_at))) continue;
      if (!Number.isFinite(Date.parse(artifact.expires_at)) || Date.parse(artifact.expires_at) <= now) continue;
      candidates.push(artifact);
    }
    if (data.artifacts.length < 100) break;
  }
  candidates.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || Number(b.id) - Number(a.id));
  const artifact = candidates[0];
  if (!artifact) return { restored: false, reason: 'no_previous_artifact' };
  if (artifact.size_in_bytes > MAX_BYTES) throw new Error('artifact_too_large');

  // Construct the trusted API route rather than following artifact metadata URLs.
  const redirect = await request(`${base}/${artifact.id}/zip`);
  if (redirect.status !== 302) throw new Error(`artifact_download_http_${redirect.status}`);
  const location = new URL(redirect.headers.get('location'));
  if (location.protocol !== 'https:' || location.username || location.password) throw new Error('invalid_artifact_redirect');
  const archive = await request(location.href, false);
  if (!archive.ok) throw new Error(`artifact_storage_http_${archive.status}`);
  const bytes = await boundedBody(archive);
  const temporary = await mkdtemp(join(tmpdir(), 'stonedowl-history-'));
  const pendingPath = `${outputPath}.pending`;
  try {
    const archivePath = join(temporary, 'artifact.zip');
    await writeFile(archivePath, bytes);
    // -p reads only the exact root filename into stdout; no archive paths are extracted.
    const { stdout } = await unzip('unzip', ['-p', archivePath, REPORT_NAME], {
      encoding: 'utf8', maxBuffer: MAX_BYTES, timeout: 20_000
    });
    const report = JSON.parse(stdout);
    if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('invalid_report');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(pendingPath, JSON.stringify(report), { mode: 0o600 });
    await rename(pendingPath, outputPath);
    return { restored: true, artifactId: artifact.id, runId: artifact.workflow_run.id, outputPath };
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(pendingPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await restorePreviousReport();
    console.log(result.restored ? `Previous electricity report restored from run ${result.runId}.` : 'No previous electricity report; comparison remains unknown.');
  } catch {
    // Do not log fetch exceptions, signed URLs, headers, report contents, or credentials.
    // Capture can still proceed honestly with an unknown comparison.
    console.warn('::warning::Previous electricity report could not be restored; comparison remains unknown.');
  }
}
