# Fireworks Priority Mode

Opt-in Fireworks priority tier for Pi provider requests.

## Scope

Adds one top-level field to eligible provider payloads:

```json
{ "service_tier": "priority" }
```

Eligible targets and their Priority multiplier:

| Model | Multiplier |
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
Anthropic-compatible messages API. Everything else, including routers and Fast
models, keeps native behavior.

## Usage

```text
/fireworks-priority            # toggle
/fireworks-priority on|off
/fireworks-priority status
```

Footer shows `fireworks: priority` when armed on an eligible model,
`fireworks: waiting` when armed on anything else, `fireworks: error` after a
payload contract failure, nothing when off.

Arming warns: Priority costs 1.2x to 1.5x standard rates.

## State and lifecycle

Global default plus per-session state. A toggle writes both and applies to
future sessions in every workspace; open sessions stay unchanged. New sessions
copy the default, resume and reload restore the session mode, forks inherit the
source mode, tree navigation restores the latest mode on the branch.

Session state is a versioned custom entry that never enters model context. The
global default lives in:

```text
~/.pi/agent/fireworks-priority.json
```

`PI_CODING_AGENT_DIR` relocates it. Writes are atomic, mode 0600, and store only
`armed` or `disabled`.

The runtime installs a native `fireworks` provider wrapper and unregisters it on
session shutdown, so reload or removal restores the builtin.

## Request behavior

The wrapper delegates catalog, auth, headers, refresh, filtering, transport,
retries, streaming, usage, and image/classifier hooks to the builtin provider.
Two changes apply only to armed eligible requests.

Payload: chains Pi's payload hook and returns a new object with top-level
`service_tier: "priority"`. Earlier hooks run first; nothing is mutated.

Cost: scales the model's cost rates by the published multiplier, including
tiers, then hands that model to pi-ai, which remains the only cost calculator.
Assistant usage, `/session`, stored usage, and the footer therefore reflect
Priority rates.

Boundaries:

- `/model` and metadata estimates show standard rates; only per-request usage is
  scaled.
- `models.json` cost overrides are the scaled baseline.
- The cache warmer decides with standard rates.

## Failures

An invalid eligible payload latches `fireworks: error`, fails the stream, and
refreshes the footer on the next message. `/fireworks-priority on|off` clears
it. Faults are never persisted.

Malformed persisted state is ignored with a warning. Session and global write
failures keep the in-memory mode; a failed global write leaves the previous
default for future sessions.

## Maintenance

Revalidate the eligibility table and multipliers when Fireworks changes pricing,
and the adapter when Pi upgrades pi-ai.

One extension must own the `fireworks` provider ID; a second wrapper breaks
registration and shutdown order.

## Disable or remove

`/fireworks-priority off` disables the session and the global default. To unload
the extension, exclude it in the package entry:

```json
{ "extensions": ["-extensions/fireworks-priority/index.ts"] }
```

Removing the directory and reloading restores the builtin provider.
`~/.pi/agent/fireworks-priority.json` is inert without the extension; delete it
to reset.
