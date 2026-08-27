-- Prevent shop-name duplication, including across different tenants.
--
-- Resolve the one pre-existing collision first: the Royal Gene house/demo
-- org's test shop happens to share a name with the real "Eliana Fashions"
-- tenant's shop. Rename the demo one; the real tenant keeps its name.
UPDATE "Shop"
SET name = 'Eliana Fashions (Demo)', "updatedAt" = now()
WHERE id = '91f51a99-60fe-4469-875a-5119cf1a08f9'
  AND "organizationId" = '00000000-0000-0000-0000-000000000001';

-- Case-insensitive, global (no organizationId in the key), restricted to
-- active shops so a deactivated/renamed-away shop doesn't permanently
-- block the name for someone else.
CREATE UNIQUE INDEX IF NOT EXISTS shop_name_lower_active_unique
  ON "Shop" (lower(name))
  WHERE "isActive" = true;
