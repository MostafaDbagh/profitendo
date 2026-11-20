ALTER TABLE report_preferences ADD COLUMN partner_recipients jsonb NOT NULL DEFAULT '[]';
ALTER TABLE report_deliveries ADD COLUMN partner_recipients jsonb NOT NULL DEFAULT '[]';
ALTER TABLE auth_mail DROP CONSTRAINT auth_mail_report_id_key;
ALTER TABLE auth_mail ADD COLUMN report_partner_id uuid;
CREATE INDEX auth_mail_report_id_idx ON auth_mail(report_id);
