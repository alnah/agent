---
name: safe-remediation
description: Use this skill when applying recommendations from an audit, refactor plan, migration plan, incident review, security review, or architecture review while minimizing regressions and unintended side effects.
---

# Safe Remediation

Goal: apply a finding with minimum iatrogenic risk. Treat every remediation as a risky intervention until validated.

## Core rules

- Do not apply audit recommendations blindly.
- Prefer smallest useful change over broad cleanup.
- Separate behavior change from refactor.
- Preserve public contracts unless explicit approval exists.
- Add or identify safety tests before modifying risky code.
- Keep rollback possible until production confidence exists.
- Stop if blast radius, validation, or rollback path is unknown.

## Workflow

1. Clarify the finding
   - Identify the exact risk, affected files, user impact, and maintainer impact.
   - Reject purely aesthetic changes unless they unblock a concrete risk.
   - Define the intended outcome in one sentence.

2. Classify the change
   - Refactor only: observable behavior must not change.
   - Bug fix: behavior changes only for specified failure cases.
   - API or contract change: compatibility and consumers are primary risk.
   - Data or schema migration: rollback and forward compatibility are primary risk.
   - Config or deploy change: runtime blast radius and observability are primary risk.
   - Dependency upgrade: transitive behavior and security are primary risk.

3. Establish a safety baseline
   - Run current validation commands first when safe.
   - Add characterization tests for current behavior if coverage is weak.
   - Add contract, golden, integration, or regression tests around the touched boundary.
   - Record known failures separately from new failures.

4. Analyze blast radius
   - Inspect imports, call sites, public API users, schemas, config keys, jobs, queues, and external resources.
   - Identify high fan-in modules and hidden shared state.
   - Identify concurrency, lifecycle, and cleanup paths.
   - Decide whether the change needs a feature flag, adapter, compatibility shim, or staged migration.

5. Plan small reversible steps
   - PR 1: tests or observability only.
   - PR 2: compatibility scaffolding or seam.
   - PR 3: implementation change behind the seam or flag.
   - PR 4: rollout or default switch.
   - PR 5: cleanup after confidence.
   - Keep each step independently reviewable and revertible.

6. Implement with guardrails
   - Make one conceptual change at a time.
   - Run targeted tests after each meaningful edit.
   - Avoid opportunistic formatting, renames, dependency upgrades, or unrelated cleanup.
   - Preserve old behavior behind compatibility code when external consumers may exist.

7. Validate
   - Run targeted tests.
   - Run broader tests relevant to the blast radius.
   - Run lint, typecheck, build, race/concurrency checks, or migration dry-runs when relevant.
   - For runtime changes, require metrics by version or cohort: errors, latency, saturation, correctness, and business-critical signals.

8. Rollout and rollback
   - Define rollback before merge.
   - Prefer canary, dark launch, or feature flag for risky runtime changes.
   - For database changes, use expand-contract: add compatible schema, deploy compatible code, switch use, then remove old schema later.
   - Test rollback periodically if the system supports it.

## Stop conditions

Stop and ask for direction if any condition is true:

- No safe validation command exists for the touched behavior.
- Behavior baseline is unknown and cannot be characterized cheaply.
- Rollback would be impossible or data-destructive.
- Public API, schema, or config compatibility would break unexpectedly.
- The change combines refactor, behavior change, and dependency upgrade.
- The proposed edit touches many unrelated modules.
- The audit recommendation lacks evidence or success metric.

## Output format

Use this concise format unless the user asks otherwise:

```text
Finding: <risk being remediated>
Change type: <refactor|bug fix|API|schema|config|dependency|other>
Blast radius: <files/modules/consumers>
Safety baseline: <tests/commands/current status>
Plan:
1. <small step>
2. <small step>
Validation:
- <command or proof>
Rollback:
- <rollback path>
Stop conditions: <none or list>
```

## Checklist before final answer

- State files changed.
- State commands run and result.
- State commands skipped and why.
- State remaining risks.
- Do not claim safety beyond evidence.
