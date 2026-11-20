ALTER TABLE purchase_documents ALTER COLUMN location_id DROP NOT NULL;
ALTER TABLE purchase_documents ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_receipt_scope_check
  CHECK (kind <> 'RECEIPT' OR (location_id IS NOT NULL AND supplier_id IS NOT NULL));

CREATE TABLE purchase_plan_items (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  document_id uuid NOT NULL,
  name text NOT NULL,
  quantity decimal(18,4) NOT NULL CHECK (quantity > 0),
  received_quantity decimal(18,4) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  position integer NOT NULL,
  UNIQUE (business_id,id),
  UNIQUE (business_id,document_id,position),
  FOREIGN KEY (business_id,document_id) REFERENCES purchase_documents(business_id,id) ON DELETE CASCADE
);

ALTER TABLE purchase_lines ADD COLUMN planned_item_id uuid;
ALTER TABLE purchase_lines ADD CONSTRAINT purchase_lines_planned_item_fkey
  FOREIGN KEY (business_id,planned_item_id) REFERENCES purchase_plan_items(business_id,id) ON DELETE RESTRICT;
ALTER TABLE purchase_lines ADD CONSTRAINT purchase_lines_planned_item_unique UNIQUE (business_id,document_id,planned_item_id);
