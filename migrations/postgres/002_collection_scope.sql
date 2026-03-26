ALTER TABLE collection_jobs
ADD COLUMN IF NOT EXISTS collection_scope_json TEXT;
