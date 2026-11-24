-- Receipts require a stock location; the supplier is optional in the purchase flow.
-- Keep the existing tenant-scoped supplier foreign key for any supplied value.
ALTER TABLE purchase_documents DROP CONSTRAINT purchase_documents_receipt_scope_check;
ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_receipt_scope_check
  CHECK (kind <> 'RECEIPT' OR location_id IS NOT NULL);
