CREATE TABLE "business_roles" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "name_key" VARCHAR(80) NOT NULL,
  "permissions" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "business_roles_business_id_id_key" ON "business_roles"("business_id", "id");
CREATE UNIQUE INDEX "business_roles_business_id_name_key_key" ON "business_roles"("business_id", "name_key");
ALTER TABLE "memberships" ADD COLUMN "custom_role_id" UUID;
ALTER TABLE "invitations" ADD COLUMN "custom_role_id" UUID;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_custom_role_fkey" FOREIGN KEY ("business_id", "custom_role_id") REFERENCES "business_roles"("business_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_custom_role_fkey" FOREIGN KEY ("business_id", "custom_role_id") REFERENCES "business_roles"("business_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
