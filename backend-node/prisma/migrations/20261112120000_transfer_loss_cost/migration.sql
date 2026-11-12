-- Historical costs cannot be reconstructed reliably. Keep them unknown.
ALTER TABLE transfer_event_lines ADD COLUMN unit_cost numeric(18,4);
ALTER TABLE transfer_event_lines ADD CONSTRAINT transfer_loss_cost_nonnegative CHECK(unit_cost IS NULL OR unit_cost>=0);
