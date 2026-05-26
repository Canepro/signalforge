ALTER TABLE sources
ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sources
ADD COLUMN IF NOT EXISTS auto_fix_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sources
ADD COLUMN IF NOT EXISTS allowed_fix_policy_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE collection_jobs
ADD COLUMN IF NOT EXISTS trigger_signal_id TEXT;

CREATE TABLE IF NOT EXISTS automation_signals (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  artifact_type TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  finding_title TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  status TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_signals_source_status
ON automation_signals(source_id, status);

CREATE TABLE IF NOT EXISTS fix_action_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  automation_signal_id TEXT NOT NULL REFERENCES automation_signals(id),
  diagnostic_request_id TEXT NOT NULL REFERENCES collection_jobs(id),
  pre_fix_run_id TEXT NOT NULL REFERENCES runs(id),
  post_fix_run_id TEXT REFERENCES runs(id),
  finding_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  action_payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  idempotency_key TEXT,
  lease_owner_id TEXT,
  lease_owner_instance_id TEXT,
  lease_expires_at TEXT,
  dry_run_summary_json TEXT,
  apply_summary_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  queued_at TEXT,
  claimed_at TEXT,
  started_at TEXT,
  dry_run_at TEXT,
  applied_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fix_action_runs_source_status
ON fix_action_runs(source_id, status);

CREATE INDEX IF NOT EXISTS idx_fix_action_runs_idempotency
ON fix_action_runs(source_id, idempotency_key);
