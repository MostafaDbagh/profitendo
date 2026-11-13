-- Preserve verified Syrian numbers while allowing international E.164-format numbers.
ALTER TABLE auth_users DROP CONSTRAINT auth_users_check;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_phone_verification_check
CHECK ((phone IS NULL AND phone_verified_at IS NULL)
 OR (phone ~ '^\+[1-9][0-9]{6,14}$' AND phone_verified_at IS NOT NULL));
