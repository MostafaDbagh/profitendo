ALTER TABLE businesses ADD COLUMN action_labels JSONB NOT NULL DEFAULT '{}'::jsonb;
