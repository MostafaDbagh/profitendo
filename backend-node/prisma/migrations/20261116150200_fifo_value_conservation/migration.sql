ALTER TABLE fifo_layers ADD COLUMN total_cost DECIMAL(18,4), ADD COLUMN remaining_cost DECIMAL(18,4);
-- Earlier FIFO migrations are part of this same release; no business is activated automatically.
-- Fail rather than silently invent opening money for a partially deployed FIFO ledger.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM fifo_layers) THEN RAISE EXCEPTION 'FIFO value migration requires an empty, not-yet-activated ledger'; END IF; END $$;
ALTER TABLE fifo_layers ALTER COLUMN total_cost SET NOT NULL, ALTER COLUMN remaining_cost SET NOT NULL;
ALTER TABLE fifo_layers ADD CONSTRAINT fifo_values_valid CHECK(total_cost>=0 AND remaining_cost>=0 AND remaining_cost<=total_cost);
