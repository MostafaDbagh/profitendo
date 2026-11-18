ALTER TABLE "sale_lines" ADD COLUMN "discount_percent" DECIMAL(7,4);
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_discount_percent_range" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100);
