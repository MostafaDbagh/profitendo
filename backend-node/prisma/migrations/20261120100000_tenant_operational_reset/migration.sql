-- Operational resets may delete immutable rows for one tenant only. Updates remain protected.

CREATE OR REPLACE FUNCTION protect_stock_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF current_setting('profitlens.reset_business', true) = OLD.business_id::text THEN
     RETURN OLD;
   END IF;
 END IF;
 RAISE EXCEPTION 'Stock movement history is append only'; END; $$;

CREATE OR REPLACE FUNCTION protect_completed_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF current_setting('profitlens.reset_business', true) = OLD.business_id::text THEN
     RETURN OLD;
   END IF;
 END IF;
 IF OLD.status='COMPLETED' THEN RAISE EXCEPTION 'Completed sales are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION protect_completed_sale_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; tenant_id uuid;
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF current_setting('profitlens.reset_business', true) = OLD.business_id::text THEN
     RETURN OLD;
   END IF;
 END IF;

 IF TG_OP='DELETE' THEN parent_id:=OLD.sale_id; tenant_id:=OLD.business_id; ELSE parent_id:=NEW.sale_id; tenant_id:=NEW.business_id; END IF;
 IF EXISTS(SELECT 1 FROM sales WHERE id=parent_id AND business_id=tenant_id AND status='COMPLETED')
 OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM sales WHERE id=OLD.sale_id AND business_id=OLD.business_id AND status='COMPLETED'))
 THEN RAISE EXCEPTION 'Completed sale lines are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION protect_adjustment_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF current_setting('profitlens.reset_business', true) = OLD.business_id::text THEN
     RETURN OLD;
   END IF;
 END IF;

 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM adjustments WHERE id=NEW.document_id AND business_id=NEW.business_id AND status<>'DRAFT') THEN RAISE EXCEPTION 'Posted adjustments are immutable'; END IF;
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM adjustments WHERE id=OLD.document_id AND business_id=OLD.business_id AND status<>'DRAFT') THEN RAISE EXCEPTION 'Posted adjustments are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
