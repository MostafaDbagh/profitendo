ALTER TABLE fifo_layers ADD COLUMN origin_order BIGSERIAL NOT NULL;
DROP INDEX fifo_layers_order;
CREATE INDEX fifo_layers_order ON fifo_layers(business_id,location_id,product_id,acquired_at,origin_order,id);
