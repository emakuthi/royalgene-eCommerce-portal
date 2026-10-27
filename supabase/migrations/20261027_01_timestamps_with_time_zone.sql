-- Every `timestamp without time zone` column in public -> timestamptz.
-- Run manually in the Supabase SQL Editor. Safe to re-run.
--
-- The original tables (Product, SalesEntry, StockTransaction, ShopStock ...)
-- predate supabase/migrations and store times with no zone, e.g.
-- "2026-10-26T21:18:05.886". Browsers and the app read a zone-less time as
-- LOCAL time, so in Kenya every such time showed 3 hours early. The values
-- are UTC (the server writes toISOString(), and now() runs in UTC — the same
-- transfer is 21:18:05.886 in StockTransaction and 21:18:05.886+00:00 in
-- StockTransfer), so `AT TIME ZONE 'UTC'` keeps every instant exactly as is.
-- Afterwards the API returns "+00:00" everywhere and clients show local time.
--
-- 1) Optional preview — what will change:
--    SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
--    ORDER BY 1, 2;
--
-- 2) The change. A column used by a view can't change type; it's skipped
--    with a NOTICE (see the Messages tab) — tell the developer which.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
    ORDER BY table_name, column_name
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
        c.table_name, c.column_name, c.column_name
      );
      RAISE NOTICE 'converted %.%', c.table_name, c.column_name;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'SKIPPED %.%: %', c.table_name, c.column_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- 3) Check: should return no rows (or only the SKIPPED ones).
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
ORDER BY 1, 2;
