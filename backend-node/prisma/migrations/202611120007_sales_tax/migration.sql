ALTER TABLE businesses ADD COLUMN sales_tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK(sales_tax_rate BETWEEN 0 AND 100);
ALTER TABLE sales ADD COLUMN tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK(tax_rate BETWEEN 0 AND 100), ADD COLUMN tax numeric(18,4) NOT NULL DEFAULT 0 CHECK(tax>=0);
ALTER TABLE sale_lines ADD COLUMN tax numeric(18,4) NOT NULL DEFAULT 0 CHECK(tax>=0);
ALTER TABLE adjustment_lines ADD COLUMN tax numeric(18,4) NOT NULL DEFAULT 0 CHECK(tax>=0 AND tax<=amount);
ALTER TABLE sales DROP CONSTRAINT sales_check;
ALTER TABLE sales ADD CONSTRAINT sales_total_with_tax CHECK(total=subtotal-discount+tax);
ALTER TABLE sale_lines DROP CONSTRAINT sale_lines_check;
ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_total_with_tax CHECK(total=gross-discount+tax);
