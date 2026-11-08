---
name: spec-driven-development
description: Route a significant project or feature through specification, planning, bounded implementation tasks and requirement-based review. Use when no adequate spec exists before substantial development. For writing or revising the spec itself, use the companion spec skill.
metadata:
  version: "2.0.0"
---

# Spec-Driven Development

Use the companion `spec` skill as the single authoring standard. Resolve it through
the active skill catalog; in this skill collection it is [../spec/SKILL.md](../spec/SKILL.md).
Install both when sharing this workflow. If the authoring skill is unavailable,
state the missing dependency instead of inventing a second competing spec protocol.

A substantial task needs a reviewable objective, bounded requirements and
observable acceptance criteria before implementation. A small unambiguous fix
usually needs only concise acceptance criteria, not a ceremonial full workflow.

## Route the work

1. Inspect the existing request, decisions, specification and current sources.
   Reuse an adequate spec; do not restart an interview or create a duplicate.
2. If the spec is absent, contradictory or materially incomplete, use `spec`.
   Preserve its one-question clarification rule, REQ/AC traceability, actual
   readiness status and Telegram mockup-before-build requirement.
3. For an implementation request with a ready spec, plan the dependencies and
   checks, then make bounded tasks that reference REQ/AC IDs. Choose task size
   by cohesion and risk, not an arbitrary maximum number of files.
4. Use the project's actual build and review mechanisms. Where `build` and
   `review` are installed, preserve their contract: implement only the spec,
   then assess every mandatory requirement against actual results. Do not
   assume unavailable incremental-implementation or testing skills exist.
5. When requirements change, update the spec and affected acceptance criteria
   before continuing dependent work. Preserve unchanged IDs and record the
   source of the decision.

A request only for a specification ends with that artifact. A request to implement
can continue within existing authorization once required decisions and mockups are
settled. Do not impose fresh human approvals at every phase when already authorized;
do not treat an unanswered critical question as approval.

## Evidence and completion

Planning quality and product correctness are different checks. Before implementation,
resolve blocking requirement conflicts and identify verifiable acceptance.
After implementation, map REQ to AC to actual evidence on the tested revision.
Tests not run and unavailable live verification remain explicit limitations.
No passing template, panel consensus or self-review substitutes for the actual check.
