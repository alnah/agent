# OpenAI Fast Mode

Adds an opt-in OpenAI priority service tier to Pi provider requests.

Requires Pi 0.83.0 or newer.

## Scope

Fast mode changes exactly one provider payload field:

```json
{
  "service_tier": "priority"
}
```

It is eligible only for these exact targets:

| Provider | API | Model |
| --- | --- | --- |
| `openai` | `openai-responses` | `gpt-5.6-sol` |
| `openai-codex` | `openai-codex-responses` | `gpt-5.6-sol` |

Other providers, APIs, and models keep the original payload reference and content.
Fast mode does not change Pi's thinking level or any reasoning payload field.

## Usage

Start Pi with fast mode armed:

```bash
pi --fast
```

Control the current extension runtime:

```text
/fast on
/fast off
/fast status
```

`/fast` without an argument is equivalent to `/fast status`.

Footer states:

- no status: disabled
- `fast: waiting`: armed, but the current target is not eligible
- `fast: priority`: armed and the current target is eligible
- `fast: error`: provider payload contract failure

Enabling fast mode emits a pricing warning. OpenAI priority processing can cost
more than standard processing. Check current provider pricing before use.

## State and lifecycle

State is in memory only. It is not written to sessions or settings.

Reload, new, resume, and fork create a fresh extension runtime. The new runtime
starts disabled unless Pi was launched with `--fast`.

Model changes do not disable an armed mode. They only switch the derived footer
and request behavior between `waiting` and `priority`.

## Request behavior

The extension uses `before_provider_request` after Pi builds the provider body.
For an armed eligible request, it creates a new top-level object, preserves every
existing JSON field, and sets `service_tier` to `priority`. The original object is
never mutated.

Normal agent turns and tool continuations pass through this hook in Pi 0.83.0.
The hook is transport-neutral, but actual SSE and WebSocket acceptance has not
been validated against the providers.

Provider-internal retries remain owned by Pi. The extension does not change retry
policy or perform a fallback request.

Compaction and branch-summary requests are excluded in Pi 0.83.0. Those paths
use the session stream function without the payload hook, so they do not receive
`service_tier: "priority"`.

## Failure and extension ordering

An invalid eligible provider payload latches `fast: error`, reports a sanitized
error once, and returns the original value to Pi. Pi can continue that request
without priority. Use `/fast on` or `/fast off` to clear the fault.

The extension preserves changes made by earlier payload hooks. A later-loaded
extension can still replace `service_tier`; this extension does not lock the
field or control extension load order.

The extension never logs prompts, complete payloads, OAuth tokens, or secrets.
It does not register or replace a provider and does not adjust usage or cost.

## Validation status

Offline checks confirm discovery, command and flag registration, exact target
gating, immutable payload decoration, no-op behavior, state transitions, UI
guards, and fault recovery.

OpenAI Responses and OpenAI Codex Responses have not received controlled live
requests from this implementation. Applied tier and Pi cost accounting are not
provider-validated. Do not treat either provider as release-validated until that
gate is completed.

## Disable or remove

Use `/fast off` for the current runtime. Omit `--fast` on future starts.

To disable the extension entirely, use `pi config` for the local package or add
this package filter to the package entry:

```json
{
  "extensions": ["-extensions/openai-fast-mode/index.ts"]
}
```

Removing `extensions/openai-fast-mode/` from the package removes the extension.
