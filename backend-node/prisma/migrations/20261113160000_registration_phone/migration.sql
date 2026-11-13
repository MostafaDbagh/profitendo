-- Unverified registration contact is encrypted and does not reserve a phone number.
ALTER TABLE "auth_users" ADD COLUMN "pending_phone" TEXT;
