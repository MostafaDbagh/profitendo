ALTER TABLE "auth_users" ADD COLUMN "owner_pin_hash" TEXT;
ALTER TABLE "auth_sessions" ADD COLUMN "owner_pin_unlocked_until" TIMESTAMPTZ(3);
