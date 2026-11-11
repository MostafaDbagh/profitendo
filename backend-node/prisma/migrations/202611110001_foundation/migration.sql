CREATE TABLE "system_metadata" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_metadata_pkey" PRIMARY KEY ("key")
);
INSERT INTO "system_metadata" ("key", "value") VALUES ('schema_version', 'foundation-v1');
