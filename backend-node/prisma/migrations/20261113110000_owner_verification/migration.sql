ALTER TABLE auth_users ADD COLUMN phone text, ADD COLUMN phone_verified_at timestamptz(3), ADD COLUMN welcome_queued_at timestamptz(3), ADD COLUMN language text NOT NULL DEFAULT 'en';
CREATE UNIQUE INDEX auth_users_phone_key ON auth_users(phone);
ALTER TABLE auth_users ADD CHECK(language IN ('en','ar')), ADD CHECK((phone IS NULL AND phone_verified_at IS NULL) OR (phone ~ '^\+9639[0-9]{8}$' AND phone_verified_at IS NOT NULL));
CREATE TABLE verification_challenges(id uuid PRIMARY KEY,token_hash text NOT NULL UNIQUE,user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,channel text NOT NULL CHECK(channel IN ('EMAIL','PHONE')),destination text NOT NULL,code_hash text NOT NULL,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),expires_at timestamptz(3) NOT NULL,used_at timestamptz(3),created_at timestamptz(3) NOT NULL DEFAULT now());
CREATE INDEX verification_challenges_user_id_channel_idx ON verification_challenges(user_id,channel);
CREATE TABLE sms_outbox(id uuid PRIMARY KEY,challenge_id uuid NOT NULL UNIQUE REFERENCES verification_challenges(id) ON DELETE CASCADE,payload text NOT NULL,attempts integer NOT NULL DEFAULT 0,available_at timestamptz(3) NOT NULL DEFAULT now(),delivered_at timestamptz(3));
CREATE INDEX sms_outbox_available_at_idx ON sms_outbox(available_at);
