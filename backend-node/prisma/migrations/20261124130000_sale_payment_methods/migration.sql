ALTER TABLE sale_payments
  DROP CONSTRAINT sale_payments_method_check,
  DROP CONSTRAINT sale_payments_check2,
  ADD CONSTRAINT sale_payments_method_check
    CHECK (method IN ('CASH', 'CARD', 'TRANSFER', 'REMITTANCE', 'CREDIT', 'OTHER')),
  ADD CONSTRAINT sale_payments_method_details_check CHECK (
    (method = 'CASH' OR change = 0)
    AND (method NOT IN ('CARD', 'TRANSFER', 'OTHER') OR char_length(trim(reference)) > 0)
    AND (method <> 'CREDIT' OR (amount = 0 AND received = 0))
  );
