-- Shop names were enforced GLOBALLY unique across every tenant
-- (20260827_01_shop_name_unique.sql) — a shop named "X" in one unrelated
-- tenant blocked another, completely separate tenant from ever naming their
-- own shop "X" too. Confirmed live 2026-09-15: the "Royal Gene" org
-- (id 00000000-0000-0000-0000-000000000001) couldn't create a shop named
-- "Eliana Fashions" solely because a different, unrelated tenant (the real
-- "Eliana Fashions" organization, id 7e536d72-adb8-41bc-ba39-0b98bf0a04c7)
-- already has a shop with that exact name.
--
-- No code anywhere looks up a Shop by name alone (always by id, or by name
-- scoped to a resolved organizationId), so nothing depends on the global
-- constraint — scoping it to (organizationId, lower(name)) is a pure
-- relaxation, not a behavior change for any existing feature.
--
-- Idempotent.

DROP INDEX IF EXISTS shop_name_lower_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS shop_name_lower_active_unique_per_org
  ON "Shop" ("organizationId", lower(name))
  WHERE "isActive" = true;
