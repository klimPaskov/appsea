BEGIN;

-- Invitation rows are workspace-scoped even though only owners may administer
-- them. Keep the common policy name used by the database boundary audit, and
-- apply the same fail-closed boundary to encrypted delivery rows. The
-- migration role is allowed only for reviewed SECURITY DEFINER maintenance
-- functions; direct runtime table access remains revoked.
ALTER POLICY workspace_invitation_owner_scope
  ON appsea.workspace_invitations RENAME TO workspace_scope;

ALTER TABLE appsea.workspace_invitation_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workspace_invitation_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.workspace_invitation_deliveries
  USING (
    current_user IN ('appsea_owner', 'appsea_migrator')
    OR workspace_id = appsea.current_workspace_id()
  )
  WITH CHECK (
    current_user IN ('appsea_owner', 'appsea_migrator')
    OR workspace_id = appsea.current_workspace_id()
  );

COMMIT;
