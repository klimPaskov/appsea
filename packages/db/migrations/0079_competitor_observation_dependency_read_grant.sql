-- Competitive observation creation verifies the referenced competitor inside
-- the authenticated workspace transaction. Keep that dependency read-only;
-- observation writes remain separately governed by the 0059 policy and review
-- triggers.

GRANT SELECT ON appsea.opportunity_competitors TO appsea_service;
