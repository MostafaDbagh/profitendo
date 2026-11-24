ALTER TABLE purchase_documents
  DROP CONSTRAINT IF EXISTS purchase_documents_receipt_scope_check,
  ADD CONSTRAINT purchase_documents_receipt_scope_check
    CHECK (kind <> 'RECEIPT' OR location_id IS NOT NULL);
