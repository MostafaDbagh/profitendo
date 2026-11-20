ALTER TABLE report_preferences ADD COLUMN extra_emails text[] NOT NULL DEFAULT '{}';
ALTER TABLE report_deliveries ADD COLUMN extra_emails text[] NOT NULL DEFAULT '{}';
ALTER TABLE auth_mail ADD COLUMN report_additional boolean NOT NULL DEFAULT false;
