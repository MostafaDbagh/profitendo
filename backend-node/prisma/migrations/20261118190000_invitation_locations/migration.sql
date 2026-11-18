ALTER TABLE "invitations" ADD COLUMN "location_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
