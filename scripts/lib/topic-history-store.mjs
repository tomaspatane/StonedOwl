import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, unlink } from 'node:fs/promises';
import { join, parse, resolve, sep } from 'node:path';

const FORMAT = 'stonedowl-topic-history-v1';
const SCHEMA = 'caba-topic-snapshot-v1';
const TOPICS = ['basura', 'transporte', 'seguridad'];
const SPANS = new Set(['6h', '1d', '3d', '1w']);
const FILE_PATTERN = /^topics-(\d{8}T\d{9}Z)\.json$/;
const PENDING_PATTERN = /^\.pending-\d+-[a-f0-9-]{36}$/;
const LOCK_NAME = '.topic-history.lock';

export const TOPIC_HISTORY_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxSnapshots: 1024,
  maxDirectoryEntries: 2048,
  maxDepth: 64,
  maxNodes: 200000
});

function failure(code) { return Object.assign(new Error(code), { code }); }
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function timestamp(value) {
  if (typeof value !== 'string') throw failure('invalid_timestamp');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw failure('invalid_timestamp');
  const [, year, month, day, hour, minute, second, , zone] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.getUTCFullYear() !== Number(year) ||
      calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw failure('invalid_timestamp');
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw failure('invalid_timestamp');
  const iso = new Date(ms).toISOString();
  if (!/^\d{4}-/.test(iso)) throw failure('invalid_timestamp');
  return { ms, iso, stamp: iso.replace(/[-:.]/g, '') };
}

// Canonical JSON makes identity independent of property insertion order. Reject
// values JSON would silently drop or coerce, getters, cycles and huge graphs.
function canonicalJson(value) {
  const ancestors = new Set();
  let nodes = 0;
  function encode(item, depth) {
    if (++nodes > TOPIC_HISTORY_LIMITS.maxNodes || depth > TOPIC_HISTORY_LIMITS.maxDepth) throw failure('payload_structure_limit');
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw failure('invalid_payload_value');
      return JSON.stringify(item);
    }
    if (typeof item === 'string') {
      if (Buffer.byteLength(item) > TOPIC_HISTORY_LIMITS.maxBytes) throw failure('snapshot_too_large');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || (!Array.isArray(item) && !plainObject(item)) || ancestors.has(item)) throw failure('invalid_payload_value');
    if (Object.getOwnPropertySymbols(item).length) throw failure('invalid_payload_value');
    if (Array.isArray(item) && item.length > TOPIC_HISTORY_LIMITS.maxNodes) throw failure('payload_structure_limit');
    const ownNames = Object.getOwnPropertyNames(item);
    if (Array.isArray(item) ? ownNames.length !== item.length + 1 : ownNames.length !== Object.keys(item).length) throw failure('invalid_payload_value');
    ancestors.add(item);
    const keys = Array.isArray(item) ? Array.from({ length: item.length }, (_, index) => String(index)) : Object.keys(item).sort();
    if (keys.length > TOPIC_HISTORY_LIMITS.maxNodes) throw failure('payload_structure_limit');
    const values = keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw failure('invalid_payload_value');
      const encoded = encode(descriptor.value, depth + 1);
      return Array.isArray(item) ? encoded : `${JSON.stringify(key)}:${encoded}`;
    });
    ancestors.delete(item);
    const encoded = Array.isArray(item) ? `[${values.join(',')}]` : `{${values.join(',')}}`;
    if (Buffer.byteLength(encoded) > TOPIC_HISTORY_LIMITS.maxBytes) throw failure('snapshot_too_large');
    return encoded;
  }
  return encode(value, 0);
}

function inspectPayload(report) {
  if (!plainObject(report) || report.version !== 'caba-topics-v1' || report.snapshotSchema !== SCHEMA ||
      typeof report.analysisVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(report.analysisVersion) ||
      !plainObject(report.topics) || Object.keys(report.topics).length !== TOPICS.length || !Array.isArray(report.editorialCases)) {
    throw failure('invalid_topic_payload');
  }
  const captured = timestamp(report.fetchedAt);
  let commonSpan;
  for (const topicId of TOPICS) {
    const topic = report.topics[topicId];
    if (!plainObject(topic) || topic.topicId !== topicId || topic.version !== report.version ||
        topic.snapshotSchema !== SCHEMA || topic.analysisVersion !== report.analysisVersion ||
        !SPANS.has(topic.span) || !Array.isArray(topic.sourceHealth) || !Array.isArray(topic.editorialCases) ||
        !plainObject(topic.counts) || timestamp(topic.fetchedAt).ms !== captured.ms) throw failure('invalid_topic_payload');
    commonSpan ??= topic.span;
    if (topic.span !== commonSpan) throw failure('invalid_topic_payload');
  }
  if (report.span !== undefined && report.span !== commonSpan) throw failure('invalid_topic_payload');
  return captured;
}

function identity(report) {
  const payloadJson = canonicalJson(report);
  const captured = inspectPayload(report);
  const digest = createHash('sha256').update(payloadJson).digest('hex');
  return { captured, payloadJson, digest, snapshotId: `${captured.stamp}-${digest}`, fileName: `topics-${captured.stamp}.json` };
}

/** Minimal storage schema validation, not a statement of comparability or truth.
 * The capture comparison performs the stricter per-source/evidence checks.
 */
export function validateTopicReport(report) {
  const expected = identity(report);
  return { report, snapshotId: expected.snapshotId, fileName: expected.fileName, capturedAt: expected.captured.iso };
}

/** Validate an already parsed artifact/local envelope without filesystem I/O.
 * A SHA-256 checksum detects corruption; it is NOT a publisher signature or
 * proof of trusted GitHub provenance. Artifact callers must validate that too.
 */
export function validateTopicSnapshotEnvelope(envelope) {
  canonicalJson(envelope);
  if (!plainObject(envelope) || envelope.format !== FORMAT ||
      Object.keys(envelope).sort().join(',') !== 'capturedAt,format,payload,payloadSha256,recordedAt,snapshotId') throw failure('invalid_snapshot_envelope');
  const expected = identity(envelope.payload);
  timestamp(envelope.recordedAt);
  if (envelope.payloadSha256 !== expected.digest || envelope.snapshotId !== expected.snapshotId) throw failure('snapshot_checksum_mismatch');
  if (envelope.capturedAt !== expected.captured.iso) throw failure('snapshot_identity_mismatch');
  return { report: envelope.payload, snapshotId: envelope.snapshotId, recordedAt: envelope.recordedAt, fileName: expected.fileName };
}

// Check every existing path component instead of following an ancestor symlink.
// A dedicated history directory is expected; this module never removes history.
async function safeDirectory(directory, create = false) {
  if (typeof directory !== 'string' || !directory.trim()) throw failure('invalid_history_directory');
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw failure('history_directory_unavailable');
      if (!create) return null;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw failure('history_directory_unavailable'); }
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('unsafe_history_directory');
  }
  if (absolute === root) throw failure('invalid_history_directory');
  return absolute;
}

function filenameTimestamp(name) {
  const match = FILE_PATTERN.exec(name);
  if (!match) throw failure('invalid_history_entry');
  const stamp = match[1];
  const captured = timestamp(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`);
  if (captured.stamp !== stamp) throw failure('invalid_history_entry');
  return captured;
}

async function scan(directory) {
  const snapshots = [];
  let entries = 0;
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (++entries > TOPIC_HISTORY_LIMITS.maxDirectoryEntries) throw failure('history_entry_limit');
    if (entry.isSymbolicLink() || !entry.isFile()) throw failure('unsafe_history_entry');
    if (entry.name === LOCK_NAME || PENDING_PATTERN.test(entry.name)) continue;
    filenameTimestamp(entry.name);
    snapshots.push(entry.name);
    if (snapshots.length > TOPIC_HISTORY_LIMITS.maxSnapshots) throw failure('history_snapshot_limit');
  }
  return snapshots.sort();
}

async function readEnvelope(directory, fileName) {
  filenameTimestamp(fileName);
  await safeDirectory(directory);
  let handle;
  try {
    handle = await open(join(directory, fileName), constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile()) throw failure('unsafe_snapshot_file');
    if (before.size > TOPIC_HISTORY_LIMITS.maxBytes) throw failure('snapshot_too_large');
    const chunks = [];
    let size = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, TOPIC_HISTORY_LIMITS.maxBytes + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > TOPIC_HISTORY_LIMITS.maxBytes) throw failure('snapshot_too_large');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (before.size !== size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw failure('snapshot_changed_during_read');
    let envelope;
    try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw failure('invalid_snapshot_json'); }
    const validated = validateTopicSnapshotEnvelope(envelope);
    if (fileName !== validated.fileName) throw failure('snapshot_identity_mismatch');
    await safeDirectory(directory);
    return envelope;
  } catch (error) {
    if (error.code === 'ELOOP') throw failure('unsafe_snapshot_file');
    throw error;
  } finally { await handle?.close(); }
}

function noBaseline(reason) { return { report: null, reason, snapshotId: null, recordedAt: null }; }

/** Latest means latest capture time, never latest healthy/parseable capture.
 * Missing, corrupted or unsafe history yields an explicit unknown baseline.
 * These reason codes deliberately contain no payload, path, environment or token.
 */
export async function readLatestTopicSnapshot({ directory } = {}) {
  try {
    const absolute = await safeDirectory(directory);
    if (!absolute) return noBaseline('no_history');
    const names = await scan(absolute);
    if (!names.length) return noBaseline('no_history');
    const envelope = await readEnvelope(absolute, names.at(-1));
    return { report: envelope.payload, reason: 'latest_snapshot', snapshotId: envelope.snapshotId, recordedAt: envelope.recordedAt };
  } catch (error) {
    const safeCodes = new Set(['invalid_history_directory', 'history_directory_unavailable', 'unsafe_history_directory',
      'invalid_history_entry', 'unsafe_history_entry', 'history_entry_limit', 'history_snapshot_limit',
      'unsafe_snapshot_file', 'snapshot_too_large', 'snapshot_changed_during_read', 'invalid_snapshot_json',
      'invalid_snapshot_envelope', 'snapshot_checksum_mismatch', 'snapshot_identity_mismatch',
      'invalid_timestamp', 'invalid_topic_payload', 'invalid_payload_value', 'payload_structure_limit']);
    return noBaseline(safeCodes.has(error.code) ? error.code : 'history_unavailable');
  }
}

async function acquireLock(directory) {
  const lockPath = join(directory, LOCK_NAME);
  const deadline = Date.now() + 5000;
  for (;;) {
    await safeDirectory(directory);
    try {
      const handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const owned = await handle.stat();
      return async () => {
        try {
          const current = await lstat(lockPath);
          if (!current.isSymbolicLink() && current.ino === owned.ino && current.dev === owned.dev) await unlink(lockPath);
        } finally { await handle.close(); }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw failure('history_lock_unavailable');
      const existing = await lstat(lockPath).catch(() => null);
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw failure('unsafe_history_entry');
      if (Date.now() >= deadline) throw failure('history_busy');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

/** Append one complete capture, even if its retrieval health is degraded/failed.
 * Atomic hard-link promotion is create-only: no rename can overwrite history.
 * A stale lock or a full directory is reported, never automatically purged.
 */
export async function persistTopicSnapshot(report, { directory, recordedAt = new Date().toISOString() } = {}) {
  const expected = identity(report);
  const recorded = timestamp(recordedAt).iso;
  const envelope = { format: FORMAT, snapshotId: expected.snapshotId, capturedAt: expected.captured.iso,
    recordedAt: recorded, payloadSha256: expected.digest, payload: JSON.parse(expected.payloadJson) };
  const serialized = canonicalJson(envelope);
  if (Buffer.byteLength(serialized) > TOPIC_HISTORY_LIMITS.maxBytes) throw failure('snapshot_too_large');
  const absolute = await safeDirectory(directory, true);
  const release = await acquireLock(absolute);
  let pending;
  try {
    const names = await scan(absolute);
    if (names.includes(expected.fileName)) {
      const existing = await readEnvelope(absolute, expected.fileName);
      if (existing.snapshotId !== expected.snapshotId) throw failure('snapshot_timestamp_conflict');
      return { snapshotId: existing.snapshotId, fileName: expected.fileName, recordedAt: existing.recordedAt, duplicate: true };
    }
    if (names.length >= TOPIC_HISTORY_LIMITS.maxSnapshots) throw failure('history_snapshot_limit');
    pending = join(absolute, `.pending-${process.pid}-${randomUUID()}`);
    const handle = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await safeDirectory(absolute);
    await link(pending, join(absolute, expected.fileName));
    // The final name already refers to complete, synced bytes. A reader or a
    // restart can use it even if a crash leaves this harmless second name.
    await unlink(pending);
    pending = null;
    const folder = await open(absolute, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await folder.sync(); } finally { await folder.close(); }
    return { snapshotId: expected.snapshotId, fileName: expected.fileName, recordedAt: recorded, duplicate: false };
  } catch (error) {
    if (error.code === 'EEXIST') throw failure('snapshot_write_conflict');
    if (error.code?.startsWith('E')) throw failure('history_write_failed');
    throw error;
  } finally {
    if (pending) await unlink(pending).catch(() => {});
    await release();
  }
}
