ALTER TABLE sources
ADD COLUMN IF NOT EXISTS default_collection_scope_json TEXT;
