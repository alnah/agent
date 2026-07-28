---
name: plane
description: Research and manage Plane through its public REST API, using local Plane documentation first and official online documentation only when local coverage is unavailable. Use for Plane workspaces, projects, work items, states, labels, modules, cycles, relations, configuration audits, and safe mutations.
---

# Plane

Use Plane's public REST API directly. Do not use a Plane extension, MCP server, private UI endpoint, authenticated Plane UI session, or undocumented authentication flow.

## Core rules

- Use local Plane documentation before online documentation.
- Research before constructing an unfamiliar request.
- Treat `GET` and `HEAD` as reads. Treat every other HTTP method as a mutation.
- Never mutate Plane during an audit, investigation, translation draft, or design discussion.
- Never expose credentials in chat, command output, logs, files, diffs, or error reports.
- Use documented public API endpoints only.
- Keep Plane configuration content in English unless the user explicitly requests another language.
- Do not invent product strategy, scope, metrics, identifiers, relationships, or workflow decisions.

## Resolve documentation

Set the stack root to `${STACK_ROOT:-$HOME/workspace/stack}`. The path may be a symbolic link, so use `find -H` when discovery must traverse it.

1. Read `$STACK_ROOT/AGENTS.md` before inspecting repositories under the stack.
2. Prefer `$STACK_ROOT/makeplane.docs` for product and developer documentation.
3. Use `$STACK_ROOT/makeplane.plane` only to clarify implementation details, routes, serializers, models, or generated OpenAPI behavior.
4. Read every applicable repository `AGENTS.md` before inspecting that repository.
5. Run `git fetch --all --prune` in each selected local Plane repository before relying on it. Never pull, merge, or rebase automatically.
6. Preserve dirty worktrees and macOS `._*` files. Documentation research is read-only.
7. Search narrowly with `rg` and read the complete relevant document. Follow local cross-references.

Useful implementation locations in `makeplane.plane` include:

- `apps/api/plane/api/urls/`
- `apps/api/plane/api/views/`
- `apps/api/plane/api/serializers/`
- `apps/api/plane/db/models/`
- `apps/api/plane/settings/openapi.py`

Local application source is not a substitute for a documented public API contract. If local documentation does not cover the required operation, load the `web-research` skill and follow its Moth workflow. Restrict authoritative sources to:

- `https://developers.plane.so/`
- `https://docs.plane.so/`
- `https://github.com/makeplane/`

Use search for discovery, then fetch and verify the exact official page. For SaaS behavior, current official API documentation takes precedence when it conflicts with an older local checkout. Report unresolved conflicts instead of guessing.

## Verify prerequisites

Before the first API call in a task:

1. Verify `curl` with `curl --version`.
2. Verify `jq` with `jq --version` when JSON filtering or payload construction is needed.
3. Confirm that `PLANE_API_KEY` and `PLANE_WORKSPACE_SLUG` are non-empty without printing their values.
4. Use `PLANE_BASE_URL` when set. Otherwise default to `https://api.plane.so`.
5. Treat `PLANE_BASE_URL` as the origin without `/api/v1`. Remove only its trailing slash, then append `/api/v1`.

Do not read shell history or unrelated configuration files to find missing credentials. State which variable is missing and stop.

Authentication uses:

```text
X-API-Key: $PLANE_API_KEY
```

Keep the literal variable reference in commands. Never paste the expanded secret. Do not enable shell tracing.

## Build API requests

Derive the exact path, method, query parameters, and body from the verified documentation. The API root is:

```bash
PLANE_ORIGIN="${PLANE_BASE_URL:-https://api.plane.so}"
PLANE_API_ROOT="${PLANE_ORIGIN%/}/api/v1"
```

A read follows this shape:

```bash
curl --silent --show-error --fail-with-body \
  --header "X-API-Key: $PLANE_API_KEY" \
  "$PLANE_API_ROOT/workspaces/$PLANE_WORKSPACE_SLUG/..."
```

For non-trivial responses, write the body to a temporary file, inspect selected fields with `jq`, and report the file path if the full response matters. Do not flood the conversation with raw JSON.

Capture and inspect the HTTP status for mutations. Use `Content-Type: application/json` and construct complex payloads in a temporary JSON file rather than fragile shell quoting.

## Resolve resources safely

- Resolve human identifiers to current UUIDs with documented read endpoints.
- Confirm the workspace, project, resource name, identifier, and UUID before mutation.
- Reject ambiguous matches. Ask the user to choose.
- Never treat work item counters as UUIDs.
- Never infer a project from the current code repository unless the user established that mapping.
- Check for an existing equivalent resource before every create operation.

## Handle pagination and limits

Plane uses cursor pagination. Follow `next_cursor` while `next_page_results` is true. Preserve the documented `per_page` limit. Do not request arbitrary oversized pages.

The published API limit is 60 requests per minute per API key. Prefer narrow fields and filters, run requests sequentially, and honor `429` responses plus rate-limit headers. Do not parallelize bulk mutations.

## Mutation protocol

Before every `POST`, `PATCH`, `PUT`, or `DELETE`:

1. Read the exact current resource and related state needed to assess impact.
2. Check dependencies, children, relations, and duplicate risk when relevant.
3. Save the relevant pre-mutation JSON to a private temporary directory.
4. Prepare the smallest possible payload.
5. Show the target, method, intended field changes, side effects, verification, and rollback limits.
6. Obtain explicit user approval after presenting that preview. General permission to investigate is not mutation approval.
7. Send one mutation at a time.
8. Read the resource again and verify every intended invariant.
9. Report the response status, resulting identifiers, verification result, and snapshot path.

For deletes, bulk changes, permission changes, workflow changes, or destructive relation changes, always request confirmation immediately before execution. A snapshot does not guarantee recoverability. Never claim a rollback is possible unless the documented API can restore all affected data.

Do not automatically roll back a failed verification. Report the observed state and propose the safest next action.

## Failure handling

- A timeout or cancelled request after transmission has an unknown outcome. Read Plane before retrying.
- Retry reads only when safe and bounded.
- Retry a mutation only after proving that it was not applied.
- On `401` or `403`, stop and report the authentication or authorization failure without exposing headers.
- On `404`, verify the documented path, workspace slug, project UUID, and resource UUID.
- On validation errors, inspect the official schema before changing the payload.
- On partial bulk success, stop, enumerate confirmed outcomes, and do not continue automatically.

## API coverage limits

If current public documentation does not expose an operation, say so. Do not substitute private application endpoints. Offer the Plane UI as the safe path when appropriate. This commonly affects some administrative configuration, templates, and saved views, but verify current documentation before declaring any limitation.

## Report work

Keep the final report concise. Include:

- documentation source used;
- read or mutation scope;
- resources changed, if any;
- verification result;
- unresolved limits or unknown outcomes;
- rollback information when real.

Redact credentials and sensitive response fields. Do not include authorization headers.
