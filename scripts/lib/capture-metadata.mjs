import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

export function captureMetadata(configuration) {
  let sourceCommit = null;
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return { sourceCommit, workflowCommit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null, event: process.env.GITHUB_EVENT_NAME || 'local',
    configuration, configurationHash: createHash('sha256').update(JSON.stringify(configuration)).digest('hex') };
}

export async function writeCaptureSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const q = report.quality;
  const lines = ['### StonedOwl capture assessment',
    `- Execution: ${q.execution.status}`,
    `- Sources: ${q.sources.status}; feed freshness: ${q.sources.freshness}`,
    `- Evidence: ${q.evidence.status}; candidates: ${q.evidence.candidates}`,
    `- Publication: ${q.publication.status}; automatic publication: blocked`,
    `- Comparison: ${q.comparison.status}`,
    `- Cadence: ${q.cadence.status}; interval minutes: ${q.cadence.observedIntervalMs === null ? 'unknown' : Math.round(q.cadence.observedIntervalMs / 60000)}`,
    `- Executed source commit: ${report.provenance.sourceCommit || 'unknown'}`,
    '', 'A saved artifact or successful test suite does not establish valid data or incident trends.', ''];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}
