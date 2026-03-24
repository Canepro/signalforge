CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  artifact_type TEXT NOT NULL DEFAULT 'linux-audit-log',
  source_type TEXT NOT NULL DEFAULT 'api',
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  parent_run_id TEXT REFERENCES runs(id),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  report_json TEXT,
  environment_json TEXT,
  noise_json TEXT,
  pre_findings_json TEXT,
  is_incomplete BOOLEAN NOT NULL DEFAULT FALSE,
  incomplete_reason TEXT,
  analysis_error TEXT,
  model_used TEXT,
  tokens_used INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  filename TEXT NOT NULL DEFAULT 'untitled.log',
  source_type TEXT NOT NULL DEFAULT 'api',
  target_identifier TEXT,
  source_label TEXT,
  collector_type TEXT,
  collector_version TEXT,
  collected_at TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  target_identifier TEXT NOT NULL,
  target_identifier_norm TEXT,
  source_type TEXT NOT NULL,
  expected_artifact_type TEXT NOT NULL,
  default_collector_type TEXT NOT NULL,
  default_collector_version TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  labels_json TEXT NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TEXT,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

UPDATE sources
SET target_identifier_norm = lower(trim(target_identifier))
WHERE target_identifier_norm IS NULL OR target_identifier_norm = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_target_enabled_norm
ON sources(target_identifier_norm) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS collection_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  artifact_type TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  request_reason TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  lease_owner_id TEXT,
  lease_owner_instance_id TEXT,
  lease_expires_at TEXT,
  last_heartbeat_at TEXT,
  result_artifact_id TEXT,
  result_run_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  queued_at TEXT,
  claimed_at TEXT,
  started_at TEXT,
  submitted_at TEXT,
  finished_at TEXT,
  result_analysis_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_collection_jobs_source ON collection_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_idempotency
ON collection_jobs(source_id, idempotency_key);

CREATE TABLE IF NOT EXISTS agent_registrations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE REFERENCES sources(id),
  token_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL,
  last_capabilities_json TEXT NOT NULL DEFAULT '[]',
  last_heartbeat_at TEXT,
  last_agent_version TEXT,
  last_instance_id TEXT
);
