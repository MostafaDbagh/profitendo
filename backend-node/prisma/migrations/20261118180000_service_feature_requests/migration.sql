ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_category_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_category_check
  CHECK (category IN ('SUBSCRIPTION','BILLING','TECHNICAL','GENERAL','SERVICE','FEATURE'));
