ALTER TABLE money_entries ADD COLUMN reversal_of_id uuid;
ALTER TABLE money_entries ADD CONSTRAINT money_entries_reversal_of_id_fkey FOREIGN KEY(reversal_of_id) REFERENCES money_entries(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE UNIQUE INDEX money_entries_reversal_of_id_key ON money_entries(reversal_of_id);
ALTER TABLE money_entries DROP CONSTRAINT money_entries_amount_check;
ALTER TABLE money_entries ADD CONSTRAINT money_entries_amount_check CHECK ((reversal_of_id IS NULL AND amount > 0) OR (reversal_of_id IS NOT NULL AND amount < 0));
CREATE FUNCTION validate_money_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original money_entries%ROWTYPE;
BEGIN
 IF NEW.reversal_of_id IS NOT NULL THEN
  SELECT * INTO original FROM money_entries WHERE id=NEW.reversal_of_id;
  IF NOT FOUND OR original.reversal_of_id IS NOT NULL OR
     NEW.business_id<>original.business_id OR NEW.location_id<>original.location_id OR
     NEW.kind<>original.kind OR NEW.method<>original.method OR NEW.currency<>original.currency OR
     NEW.source_id IS DISTINCT FROM original.source_id OR NEW.amount<>-original.amount OR NEW.created_at<original.created_at THEN
   RAISE EXCEPTION 'Invalid money reversal' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER money_reversal_valid BEFORE INSERT ON money_entries FOR EACH ROW EXECUTE FUNCTION validate_money_reversal();
