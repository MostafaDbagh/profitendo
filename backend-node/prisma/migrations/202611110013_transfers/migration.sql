
CREATE TABLE stock_transfers (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, source_id uuid NOT NULL, destination_id uuid NOT NULL,
 source_name text NOT NULL, destination_name text NOT NULL, reference text NOT NULL,
 client_key uuid NOT NULL, request_hash text NOT NULL, status text NOT NULL DEFAULT 'DRAFT',
 revision integer NOT NULL DEFAULT 0, notes text NOT NULL DEFAULT '',
 actor_id uuid NOT NULL, actor_name text NOT NULL, dispatched_by uuid, dispatched_name text,
 dispatched_at timestamptz(3), completed_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK(source_id <> destination_id),
 CHECK(status IN ('DRAFT','IN_TRANSIT','PARTIAL','COMPLETED','CANCELLED')),
 CHECK((status IN ('IN_TRANSIT','PARTIAL','COMPLETED')) = (dispatched_at IS NOT NULL)),
 CHECK((status='COMPLETED') = (completed_at IS NOT NULL)),
 FOREIGN KEY(business_id,source_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,destination_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,id), UNIQUE(business_id,client_key), UNIQUE(business_id,reference)
);
CREATE INDEX stock_transfers_business_id_source_id_status_idx ON stock_transfers(business_id,source_id,status);
CREATE INDEX stock_transfers_business_id_destination_id_status_idx ON stock_transfers(business_id,destination_id,status);
CREATE TABLE transfer_lines (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, transfer_id uuid NOT NULL, product_id uuid NOT NULL,
 sku text NOT NULL, name text NOT NULL, unit text NOT NULL, barcodes text[] NOT NULL,
 quantity numeric(18,4) NOT NULL CHECK(quantity>0),
 received numeric(18,4) NOT NULL DEFAULT 0 CHECK(received>=0),
 returned numeric(18,4) NOT NULL DEFAULT 0 CHECK(returned>=0),
 lost numeric(18,4) NOT NULL DEFAULT 0 CHECK(lost>=0),
 CHECK(received+returned+lost<=quantity),
 FOREIGN KEY(business_id,transfer_id) REFERENCES stock_transfers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,transfer_id,product_id), UNIQUE(business_id,transfer_id,id)
);
CREATE TABLE transfer_events (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, transfer_id uuid NOT NULL,
 client_key uuid NOT NULL, request_hash text NOT NULL, kind text NOT NULL CHECK(kind IN ('RECEIVE','RETURN','LOSS')),
 reason text NOT NULL DEFAULT '', actor_id uuid NOT NULL, actor_name text NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK(kind='RECEIVE' OR char_length(trim(reason))>=5),
 FOREIGN KEY(business_id,transfer_id) REFERENCES stock_transfers(business_id,id) ON DELETE RESTRICT,
 UNIQUE(business_id,client_key), UNIQUE(business_id,transfer_id,id)
);
CREATE INDEX transfer_events_business_id_transfer_id_created_at_idx ON transfer_events(business_id,transfer_id,created_at);
CREATE TABLE transfer_event_lines (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, transfer_id uuid NOT NULL, event_id uuid NOT NULL,
 transfer_line_id uuid NOT NULL, quantity numeric(18,4) NOT NULL CHECK(quantity>0),
 FOREIGN KEY(business_id,transfer_id,event_id) REFERENCES transfer_events(business_id,transfer_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,transfer_id,transfer_line_id) REFERENCES transfer_lines(business_id,transfer_id,id) ON DELETE RESTRICT,
 UNIQUE(event_id,transfer_line_id)
);
CREATE TRIGGER transfer_events_immutable BEFORE UPDATE OR DELETE ON transfer_events FOR EACH ROW EXECUTE FUNCTION protect_stock_history();
CREATE TRIGGER transfer_event_lines_immutable BEFORE UPDATE OR DELETE ON transfer_event_lines FOR EACH ROW EXECUTE FUNCTION protect_stock_history();
UPDATE system_metadata SET value='transfers-v1' WHERE key='schema_version';
