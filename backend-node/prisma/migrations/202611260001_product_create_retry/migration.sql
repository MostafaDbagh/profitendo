CREATE TABLE "product_create_requests" (
    "business_id" UUID NOT NULL,
    "client_key" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    PRIMARY KEY ("business_id", "client_key"),
    FOREIGN KEY ("business_id", "product_id") REFERENCES "products" ("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "product_create_requests_business_id_product_id_idx" ON "product_create_requests" ("business_id", "product_id");
