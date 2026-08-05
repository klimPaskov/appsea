-- Migration 0100: make legacy production opportunity state fail closed until
-- the explicit deep-research gate has been recorded.
--
-- Existing production-shaped analysis only carries a reviewed seed plus
-- complaint evidence. It does not prove source-backed competitor research,
-- contrary-evidence coverage, or the full research-quality gate. Downgrade
-- those mutable projections to candidate. Synthetic fixture rows retain their
-- reviewed fixture lifecycle state.
UPDATE appsea.opportunities
   SET state = 'candidate',
       updated_at = clock_timestamp()
 WHERE synthetic = false
   AND state = 'researched';
