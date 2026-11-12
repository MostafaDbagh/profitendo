-- Keep other saved positions; move the requested operational group after reports.
WITH base AS (
 SELECT id, array_agg(tab ORDER BY ord) AS tabs FROM memberships,
 unnest(tab_order) WITH ORDINALITY AS t(tab,ord)
 WHERE tab NOT IN ('catalogue','sales','purchases','inventory','returns','expenses','payments')
 GROUP BY id
), ordered AS (
 SELECT id,tabs,COALESCE(array_position(tabs,'reports'),1) AS pos FROM base
)
UPDATE memberships m SET tab_order = o.tabs[1:o.pos] || ARRAY['catalogue','sales','purchases','inventory','returns','expenses','payments']::text[] || o.tabs[o.pos+1:cardinality(o.tabs)]
FROM ordered o WHERE m.id=o.id;
