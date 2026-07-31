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

Other providers, APIs, and models keep their native request behavior. Fast mode
does not change Pi's thinking level or any reasoning payload field.

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

The extension installs a native Codex provider wrapper during runtime setup. It
unregisters that wrapper during session shutdown so reload, replacement, or
removal restores Pi's builtin provider before a new runtime is composed.

## Request behavior

### OpenAI Responses

The extension uses `before_provider_request` after Pi builds the provider body.
For an armed eligible request, it creates a new top-level object, preserves every
existing JSON field, and sets `service_tier` to `priority`. The original object is
never mutated.

### OpenAI Codex Responses

Codex additionally requires the requested tier in pi-ai's internal stream
options for response-tier resolution and cost accounting. The extension wraps a
fresh builtin Codex provider and delegates its model catalog, OAuth, headers,
transport, retry, streaming, response parsing, usage, and cost behavior.

For armed Codex Sol requests, the wrapper calls the native advanced stream with:

```text
serviceTier: priority
```

It then runs Pi's payload-hook chain once and enforces final top-level
`service_tier: "priority"`. Internal options and the transmitted body therefore
stay aligned. pi-ai remains the sole owner of tier resolution and cost
multiplication.

Disabled Codex requests and Luna, Terra, or any other Codex model call the
builtin `streamSimple` path with the original options object.

## Transport, retries, and summaries

The builtin Codex provider retains SSE, WebSocket, cached WebSocket, timeout,
retry, session, header, OAuth, and response-processing behavior.

Normal agent turns and tool continuations use priority while armed and eligible.
Codex compaction and branch-summary calls also pass through the provider wrapper,
so they now receive internal and body priority even though they bypass payload
hooks in Pi 0.83.0.

OpenAI Responses compaction and branch summaries still bypass the payload hook
and remain standard tier.

The extension does not change retry policy and never performs a standard-tier
fallback request.

## Failure and extension ordering

An invalid eligible payload latches `fast: error` and reports a sanitized error.
For Codex, the final wrapper enforcement fails the provider stream instead of
sending a body whose tier disagrees with accounting. Use `/fast on` or
`/fast off` to clear the fault.

For Codex priority requests, the final wrapper enforcement runs after the normal
payload-hook chain. Earlier and later hook changes are preserved except for the
root `service_tier`, which remains `priority`. For OpenAI Responses, a later hook
can still replace the tier because no direct-provider wrapper is installed.

The extension never logs prompts, complete payloads, OAuth tokens, or secrets.
It never reads credentials and does not calculate or patch usage costs itself.

## Maintenance constraints

The Codex adapter depends on the Pi 0.83.0 pi-ai provider contract. In
particular, it mirrors the native simple-stream reasoning clamp before calling
the advanced stream. Revalidate this mapping, service-tier accounting, and
provider lifecycle when upgrading Pi or pi-ai.

The adapter registers the global `openai-codex` provider ID. Running another
extension that replaces the same provider is unsupported: registration and
shutdown order could replace or unregister the other wrapper. Use only one
`openai-codex` provider owner at a time.

This extension intentionally has no automated tests, fixtures, mocks, or test
dependencies. Validation uses static checks, offline provider probes, and
controlled live requests./re

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
Reload or restart Pi to restore the builtin Codex provider.
