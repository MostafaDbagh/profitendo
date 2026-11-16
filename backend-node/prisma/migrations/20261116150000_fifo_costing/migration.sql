ALTER TABLE businesses ADD COLUMN fifo_started_at TIMESTAMPTZ(3);
ALTER TABLE stock_movements ADD COLUMN cost_amount DECIMAL(18,4), ADD COLUMN cost_layers JSONB;
ALTER TABLE sale_lines ADD COLUMN cost_amount DECIMAL(18,4);
ALTER TABLE adjustment_lines ADD COLUMN cost_amount DECIMAL(18,4);
ALTER TABLE transfer_event_lines ADD COLUMN cost_amount DECIMAL(18,4);
CREATE TABLE fifo_layers (
 id UUID PRIMARY KEY, business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 location_id UUID NOT NULL, product_id UUID NOT NULL,
 quantity DECIMAL(18,4) NOT NULL CHECK(quantity>0),
 remaining DECIMAL(18,4) NOT NULL CHECK(remaining>=0 AND remaining<=quantity),
 unit_cost DECIMAL(18,4) NOT NULL CHECK(unit_cost>=0),
 acquired_at TIMESTAMPTZ(3) NOT NULL, origin_id TEXT NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX fifo_layers_order ON fifo_layers(business_id,location_id,product_id,acquired_at,created_at,id);
