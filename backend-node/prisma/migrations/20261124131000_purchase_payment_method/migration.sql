ALTER TABLE purchase_documents
  ADD COLUMN payment_method TEXT,
  ADD COLUMN payment_description VARCHAR(150) NOT NULL DEFAULT '',
  ADD CONSTRAINT purchase_payment_method_check
    CHECK (payment_method IN ('CASH', 'TRANSFER', 'REMITTANCE', 'CREDIT', 'OTHER')),
  ADD CONSTRAINT purchase_payment_description_check
    CHECK (CASE WHEN payment_method = 'OTHER' THEN length(trim(payment_description)) > 0
                ELSE payment_description = '' END);
