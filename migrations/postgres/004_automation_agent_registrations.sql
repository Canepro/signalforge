CREATE TABLE IF NOT EXISTS automation_agent_registrations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE REFERENCES sources(id),
  token_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL
);
