BEGIN;

-- Canonical locators are untrusted source metadata but may be rendered as
-- attribution links. Keep the database boundary fail-closed for non-HTTP(S)
-- schemes even when a caller bypasses the TypeScript contract.
ALTER TABLE appsea.source_items
  ADD CONSTRAINT source_items_canonical_locator_check
  CHECK (
    canonical_locator IS NULL
    OR canonical_locator ~* '^https?://[^[:space:]/]+(/[^[:space:]]*)?$'
  );

COMMENT ON COLUMN appsea.source_items.canonical_locator IS
  'Optional attribution locator; only HTTP(S) values are accepted and source policy controls whether it may be displayed.';

COMMIT;
