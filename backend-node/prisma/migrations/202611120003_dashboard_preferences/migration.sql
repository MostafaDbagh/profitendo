ALTER TABLE "memberships" ADD COLUMN "hidden_tabs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
