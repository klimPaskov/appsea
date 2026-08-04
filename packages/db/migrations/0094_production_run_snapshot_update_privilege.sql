-- Production collection finalization writes the immutable run snapshot once,
-- after the worker has inserted the run. The service role's original narrow
-- update grant omitted this column, causing a valid collection transaction to
-- fail with PostgreSQL 42501 at finalization.
GRANT UPDATE (artifact_snapshot) ON appsea.research_runs TO appsea_service;
