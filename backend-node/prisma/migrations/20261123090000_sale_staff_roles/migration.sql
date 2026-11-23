-- Keep historical names intact. Historical roles were not recorded and must not be guessed.
ALTER TABLE "sales" ADD COLUMN "actor_role" TEXT, ADD COLUMN "completed_role" TEXT;
