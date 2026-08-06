-- Enforce the reviewer-role contract declared by each immutable source policy.
-- Third-party policy drafts fail closed to legal/privacy/security when the
-- field is absent; legacy manual imports retain their operator-only boundary.
CREATE OR REPLACE FUNCTION appsea.enforce_source_policy_reviewer_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  source_type text;
  required_roles jsonb;
BEGIN
  IF NEW.decision <> 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT source.source_type, policy.policy_payload->'requiredReviewerRoles'
    INTO source_type, required_roles
    FROM appsea.sources source
    JOIN appsea.source_policy_versions policy
      ON policy.source_id = source.source_id
     AND policy.policy_version = NEW.policy_version
   WHERE source.source_id = NEW.source_id;

  IF source_type IS NULL THEN
    RAISE EXCEPTION 'source policy reviewer role requires an existing policy'
      USING ERRCODE = '22023';
  END IF;

  IF required_roles IS NULL THEN
    required_roles := CASE
      WHEN source_type = 'manual' THEN '["independent_operator"]'::jsonb
      ELSE '["legal", "privacy", "security"]'::jsonb
    END;
  END IF;

  IF jsonb_typeof(required_roles) <> 'array'
     OR jsonb_array_length(required_roles) = 0
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(required_roles) AS role(value)
        WHERE jsonb_typeof(role.value) <> 'string'
           OR role.value #>> '{}' NOT IN ('legal', 'privacy', 'security', 'independent_operator')
     )
     OR jsonb_array_length(required_roles) <> (
       SELECT count(DISTINCT role.value #>> '{}')
         FROM jsonb_array_elements(required_roles) AS role(value)
     ) THEN
    RAISE EXCEPTION 'source policy required reviewer roles are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(required_roles) AS role(value)
     WHERE role.value = NEW.reviewer_role
  ) THEN
    RAISE EXCEPTION 'source policy approval reviewer role is not permitted by policy'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_policy_reviewer_role_guard
  ON appsea.source_policy_reviews;
CREATE TRIGGER source_policy_reviewer_role_guard
BEFORE INSERT OR UPDATE ON appsea.source_policy_reviews
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_policy_reviewer_role();

COMMENT ON FUNCTION appsea.enforce_source_policy_reviewer_role() IS
  'Enforces policy-declared independent reviewer roles; manual policies without the field default to independent_operator and all other legacy policies fail closed to legal/privacy/security.';
