# Report and plan approval UI tranche

Date: 2026-08-05

Status: repository slice complete; production operation remains deployment- and
approval-gated.

## Outcome

Private report and coding-plan pages now expose the existing persisted approval
governance. Editors can mark generated artifacts reviewed. Owners can approve
or withdraw them. Viewers remain read-only. The plan page shows a readiness
blocker before an approval attempt, while the API and database continue to
enforce linked-report, step-up, membership, and export rules.

## Implementation

- Added the shared client control at
  `apps/web/src/app/workspace/report-plan-approval-actions.tsx`.
- Integrated it into the private report and plan routes.
- Added pure transition-rule tests in
  `apps/web/src/app/report-plan-approval-actions.test.ts`.
- Added responsive governance-panel styles and hand-authored desktop/mobile
  SVG references under `design/references/source/artifact-approval*.svg`.
- Updated the active plan, current status, known gaps, implementation notes,
  and `memory/ACTIVE.md`.

## Deliberate limits

This slice adds no new source connector, does not activate a policy, does not
change report/package contracts or database transitions, and does not promote
synthetic or reviewed-seed content to market evidence. No decorative icon or
bitmap was needed; the existing reviewed AppSea mark remains unchanged.

## Validation

- Web approval/API tests: 3 files, 10 tests passed.
- Web typecheck and lint passed.
- Full web suite/build/smoke checks remain green from the preceding gate UI
  tranche.

## Remaining blockers

Independent CFPB/competitor source approval, hosted PostgreSQL/Temporal/object
storage and backup operations, deployed scheduler/alert routing, identity and
delivery provider review, and signed desktop releases remain external release
work. This report is not a production deployment claim.
