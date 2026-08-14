PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'argentina' CHECK (scope IN ('argentina', 'world')),
  span TEXT NOT NULL DEFAULT '1d' CHECK (span IN ('1d', '3d', '1w', '1m')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_articles (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (monitor_id, article_id)
);

CREATE TABLE IF NOT EXISTS monitor_snapshots (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  active_provider_count INTEGER NOT NULL DEFAULT 0,
  diagnostics_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_snapshots_monitor_time
  ON monitor_snapshots (monitor_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitor_articles_last_seen
  ON monitor_articles (monitor_id, last_seen_at DESC);

INSERT INTO monitors (id, name, query, scope, span, enabled, created_at, updated_at)
VALUES (
  'salud-caba',
  'Salud CABA',
  'hospital hospitales guardia guardias SAME médicos enfermería turnos "salud pública" CABA',
  'argentina',
  '1d',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  query = excluded.query,
  scope = excluded.scope,
  span = excluded.span,
  updated_at = excluded.updated_at;

