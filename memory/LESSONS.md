# Reusable lessons

## Keep agent guidance layered

Large root instruction files become hard to use. Stable global rules belong in `AGENTS.md`. Local rules belong in scoped files. Procedures belong in skills. Current state belongs in memory. Deep rationale belongs in docs.

## Separate product autonomy from repository autonomy

A product agent may analyze complaints and propose changes. Imported evidence must never gain the ability to edit repository instructions, permissions, skills, or production code.

## Build a whole fixture path

A synthetic connector is more valuable when it exercises provenance, normalization, clustering, scoring, reports, API output, website rendering, and tests. Empty adapters provide little proof.

## Simple screens need strict scope

Removing decorative panels is not enough. Each route needs one main job, a restrained field set, generous spacing, and separate detail pages.

## Skills should capture repeated work

A skill is useful when it saves future rediscovery. One-off design notes and active task state make skills harder to apply and should remain elsewhere.

## Test upgrades with populated history

A fresh schema cannot reveal forward-migration failures caused by forced RLS, missing historical run links, or legacy lifecycle rows. Every persistence migration needs a representative populated upgrade path as well as a clean install.

## Make lineage relational

Repository code that writes matching run, opportunity, score, plan, cluster, item, and policy identifiers is not enough. Composite database constraints are the durable proof that current pointers and immutable history cannot be cross-wired.

## Guard destructive tests at several layers

Require an explicit opt-in, exact loopback URL and port, fixed roles, a disposable database name, and a database marker checked through both service and migration connections. Reject connection-string parameters that can redirect the effective server.
