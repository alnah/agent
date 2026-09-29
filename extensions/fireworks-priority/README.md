# Fireworks Priority Mode

Adds an opt-in Fireworks priority service tier to Pi provider requests.

Developed and validated against Pi 0.99.1.

## Scope

Priority mode changes exactly one provider payload field:

```json
{
  "service_tier": "priority"
}
```

It is eligible only for these exact Fireworks targets:

| Model or router | Priority multiplier |
| --- | --- |
| `accounts/fireworks/models/deepseek-v4p1-flash` | 1.25 |
| `accounts/fireworks/models/ember-1` | 1.25 |
| `accounts/fireworks/models/gpt-oss-120b` | 1.2 |
| `accounts/fireworks/models/minimax-m3` | 1.5 |
| `accounts/fireworks/models/nemotron-3-ultra-nvfp4` | 1.25 |
| `accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b` | 1.25 |
| `accounts/fireworks/models/qwen3p8-max` | 1.5 |
| `accounts/fireworks/models/glm-5p3` | 1.25 |
| `accounts/fireworks/models/glm-5p3-flash` | 1.25 |
| `accounts/fireworks/models/kimi-k3` | 1.25 |

Fireworks serves Priority on both OpenAI-compatible chat completions and the
Anthropic-compatible messages API. Other providers and models keep their native
request behavior. Routers (`accounts/fireworks/routers/*`) and models without a
published Priority tier are never eligible: Fireworks does not publish Priority
rates for routers, so their cost would be unknown. Priority mode does not change
Pi's thinking level or any reasoning payload field.

## Usage

Toggle the mode for the current session and the global default:

```text
/fireworks-priority
```

Explicit forms:

```text
/fireworks-priority on
/fireworks-priority off
/fireworks-priority status
```

Footer states:

- no status: disabled
- `fireworks: waiting`: armed, but the current target is not eligible
- `fireworks: priority`: armed and the current target is eligible
- `fireworks: error`: provider payload contract failure

Enabling priority mode emits a pricing warning. Fireworks priority processing
costs 1.2x to 1.5x standard rates depending on the model. Check current provider
pricing before use.

## State and lifecycle

Priority mode has a global default and an independent state for each session.

`/fireworks-priority` writes both the current session and the global default
used by future sessions in every workspace. Sessions that are already open do
not change. If concurrent sessions update the default, the last completed write
wins.

A new session copies the global default. Resume and reload restore that
session's last mode. A fork inherits the source session's current mode. Tree
navigation restores the latest mode on the selected branch when one exists.

Session state uses versioned Pi custom entries. These entries never enter model
context. The global default uses this mode-only file:

```text
~/.pi/agent/fireworks-priority.json
```

`PI_CODING_AGENT_DIR` relocates that file with the rest of Pi's global config.
Writes use a mode-0600 temporary file and atomic rename. Only `armed` or
`disabled` is stored. Provider faults are never persisted.

Every session that opens or resumes while armed emits the priority-pricing
warning. Model changes do not disable an armed mode. They only switch the
derived footer and request behavior between `waiting` and `priority`.

The extension installs a native Fireworks provider wrapper during runtime
setup. It unregisters that wrapper during session shutdown so reload,
replacement, or removal restores Pi's builtin provider before a new runtime is
composed.

## Request behavior

The wrapper delegates the complete builtin Fireworks provider: model catalog,
authentication, headers, session affinity, refresh, filtering, transport,
retries, streaming, response parsing, and usage. Only two things change for an
armed eligible request.

### Payload

The wrapper chains Pi's payload-hook contract and appends top-level
`service_tier: "priority"`. It creates a new object, preserves every existing
JSON field, and never mutates the original. Earlier hooks run first; the tier is
enforced after them.

### Cost accounting

Fireworks priority rates are 1.2x to 1.5x standard rates per model. The wrapper
passes Pi a model whose cost rates are scaled by the published multiplier for
that target, including request-wide tiers. pi-ai remains the sole owner of cost
calculation; the extension never patches usage after the fact. Displayed cost,
`/session` totals, and stored usage therefore match Priority billing.

Disabled requests and ineligible models call the builtin provider with the
original model and options object.

## Factoring and failures

Invalid eligible payloads latch `fireworks: error`, throw, and fail the provider
stream. The footer refreshes on the next message. Use `/fireworks-priority on`
or `/fireworks-priority off` to clear the fault. Faults are never restored in
another runtime.

Malformed persisted state is ignored with a sanitized warning. A session-entry
write failure does not revert the current in-memory mode. A global write failure
does not revert the current session, but future sessions keep the previous
default.

The extension never logs prompts, complete payloads, or secrets. It never reads
credentials.

## Maintenance constraints

The wrapper depends on the pi-ai provider contract. The Fireworks catalog and
Priority eligibility table must be revalidated when Fireworks changes pricing
or Pi upgrades pi-ai.

The adapter registers the global `fireworks` provider ID. Running another
extension that replaces the same provider is unsupported: registration and
shutdown order could replace or unregister the other wrapper. Use only one
`fireworks` provider owner at a time.

This extension intentionally has no committed automated tests, fixtures, mocks,
or test dependencies. Validation uses static checks, offline provider probes,
and controlled live requests.

## Disable or remove

Use `/fireworks-priority off` to disable the current session and the global
default.

To disable the extension entirely, use `pi config` for the local package or add
this package filter to the package entry:

```json
{
  "extensions": ["-extensions/fireworks-priority/index.ts"]
}
```

Removing `extensions/fireworks-priority/` from the package removes the
extension. Reload or restart Pi to restore the builtin Fireworks provider. The
mode-only global preference is harmless when the extension is absent. Delete
`~/.pi/agent/fireworks-priority.json` if it should also be removed.
