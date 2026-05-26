ALTER TABLE fix_action_runs
ADD COLUMN IF NOT EXISTS action_payload_json TEXT NOT NULL DEFAULT '{"kind":"legacy_unavailable"}';
