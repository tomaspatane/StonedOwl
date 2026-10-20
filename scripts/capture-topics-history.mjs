import { mkdir, writeFile, rename, copyFile, rm, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, join, relative, isAbsolute, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { captureAllTopics } from '../sources/caba-topic-capture.js';
import { CAPTURE_WINDOWS } from '../data/caba-topics.js';
import { compareTopicReports } from '../data/caba-topic-history.js';
import { readLatestTopicSnapshot, persistTopicSnapshot, validateTopicSnapshotEnvelope } from './lib/topic-history-store.mjs';

async function writeAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const pending = `${path}.${randomUUID()}.pending`;
  try {
    await writeFile(pending, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(pending, path);
  } finally { await rm(pending, { force: true }); }
}

async function projectedRealPath(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await projectedRealPath(parent), basename(path));
  }
}
const contained = (parent, child) => { const rel = relative(parent, child); return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)); };

export async function captureAndStoreTopics({
  directory = resolve('tmp/topic-history'), outputPath = resolve('tmp/live-topics-report.json'),
  artifactDirectory = resolve('tmp/topic-capture-artifact'), previousSnapshotPath = null,
  span = '1w', now = Date.now(), capture = captureAllTopics
} = {}) {
  if (!Object.hasOwn(CAPTURE_WINDOWS, span)) throw new Error('invalid_capture_span');
  const artifactSnapshot = join(artifactDirectory, 'topic-snapshot.json');
  const artifactReport = join(artifactDirectory, 'live-topics-report.json');
  const historyRoot = await projectedRealPath(resolve(directory));
  const outputs = [outputPath, artifactSnapshot, artifactReport];
  const outputTargets = await Promise.all(outputs.map(async path => join(await projectedRealPath(dirname(resolve(path))), basename(path))));
  if (outputTargets.some(path => contained(historyRoot, path))) throw new Error('history_output_path_collision');
  if (outputTargets[0] === outputTargets[1]) throw new Error('snapshot_output_path_collision');
  if (previousSnapshotPath && [outputPath, artifactSnapshot, artifactReport].some(path => resolve(path) === resolve(previousSnapshotPath))) throw new Error('baseline_output_path_collision');
  // Never upload an old successful artifact after this invocation fails.
  for (const path of new Set([outputPath, artifactSnapshot, artifactReport])) await rm(path, { force: true });
  let baseline;
  if (previousSnapshotPath) {
    try {
      const handle = await open(previousSnapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('invalid_snapshot_file');
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      if (bytes.length > 10 * 1024 * 1024) throw new Error('too_large');
      baseline = { ...validateTopicSnapshotEnvelope(JSON.parse(bytes)), reason: 'explicit_snapshot' };
    } catch { baseline = { report: null, reason: 'explicit_previous_snapshot_unavailable_or_invalid' }; }
    // Explicit restoration failure never falls back to an unrelated local file.
  } else baseline = await readLatestTopicSnapshot({ directory });
  const report = await capture({ span, now });
  const comparisons = compareTopicReports(baseline.report, report, { now });
  const history = { persisted: false, storage: 'local_filesystem',
    previousSnapshotId: baseline.snapshotId || null, previousCapturedAt: baseline.report?.fetchedAt || null,
    baselineReason: baseline.reason || 'restored', automaticSchedule: false,
    interpretation: 'Se guarda una captura por ejecución. Esto no activa una captura periódica ni mide incidentes.' };
  let saved;
  try {
    saved = await persistTopicSnapshot(report, { directory, recordedAt: new Date().toISOString() });
    Object.assign(history, { persisted: true, snapshotId: saved.snapshotId, recordedAt: saved.recordedAt, fileName: saved.fileName });
  } catch { history.reason = 'snapshot_not_saved'; }
  report.snapshotComparisons = comparisons;
  for (const [topic, comparison] of Object.entries(comparisons)) report.topics[topic].snapshotComparison = comparison;
  report.history = history;
  for (const topic of Object.keys(report.topics)) report.topics[topic].history = history;
  await writeAtomic(outputPath, report);
  await mkdir(artifactDirectory, { recursive: true });
  await writeAtomic(artifactReport, report);
  if (saved) {
    const pending = `${artifactSnapshot}.${randomUUID()}.pending`;
    try {
      await copyFile(join(directory, saved.fileName), pending, constants.COPYFILE_EXCL);
      await rename(pending, artifactSnapshot);
    } finally { await rm(pending, { force: true }); }
  }
  return { report, exitCode: report.ok && history.persisted ? 0 : 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await captureAndStoreTopics({
    directory: resolve(process.env.TOPICS_HISTORY_DIR || 'tmp/topic-history'),
    previousSnapshotPath: process.env.PREVIOUS_TOPICS_SNAPSHOT ? resolve(process.env.PREVIOUS_TOPICS_SNAPSHOT) : null,
    span: process.env.CAPTURE_SPAN || '1w'
  });
  console.log(JSON.stringify({ capturedAt: result.report.fetchedAt, history: result.report.history,
    topics: Object.fromEntries(Object.entries(result.report.topics).map(([topic, data]) => [topic, { health: data.captureHealth.status, cases: data.editorialCases.length, comparison: data.snapshotComparison }])) }, null, 2));
  process.exitCode = result.exitCode;
}
