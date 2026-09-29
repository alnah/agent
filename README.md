# Agent

> This is my [Pi](https://github.com/badlogic/pi-mono) config with extensions, skills, prompts, and context files for terminal workflows. It is not a Pi fork. It extends Pi.

## Why Pi?

I tried Claude Code, Codex, and Open Code. All of them are good. But I switched to Pi, which is now the only agent I use.

I also like the fact its name does not refer to coding, because I use agentic workflows for my teaching materials, and people could use agents for non-coding tasks.

Pi has a very small core set of features, such as Read, Write, Edit, and Bash. I can add whatever I want on top of it.

It supports prompt templates, skills, and extensions that give me a stronger harness for coding with LLMs. I can use custom tools, plenty of events, extend the UI, and more.

It also offers an excellent portability across models, whether I use subscriptions or API keys. It has useful features such as session export and sharing, which, for me, should be standard in any agent.

## What is inside

### Context files

 I like to save tokens and context for the agent. So I phrase my rules this way:

 ```markdown
Topic 1: always rule 1a, prefer 1b, never 1c, etc.
Topic 2: if rule 2; else rule 3; then rule 4; no rule 5a, rule 5b, etc.
 ```

 I use those words to structure the rules: `always`, `prefer`, `never`, `then`, `if`, `else`, and `no`.
 I also use `,` for enumerating the aspects of one rule, and I use `;` for the next rule of the same topic.

| File | What it does |
| --- | --- |
| `AGENTS.md` | Global working rules for user interaction, language, and tool behavior |
| `APPEND_SYSTEM.md` | Global addendum for direct, critical, factual behavior |

### Extensions

| Extension | What it does |
| --- | --- |
| `answer/` | Turns unanswered assistant questions into an interactive Q&A flow with `/answer` or `Ctrl+.` |
| `files/` | Adds `/files` and `/diff` to browse repo files, recent references, diffs, Finder reveal, and Quick Look |
| `fireworks-priority/` | Adds opt-in Fireworks priority-tier requests with `/fireworks-priority` |
| `notifyer/` | Sends terminal notifications when a Pi turn finishes |
| `review/` | Adds `/review` and `/end-review` for branch, commit, PR, folder, and uncommitted-change review workflows |
| `todos/` | Adds a shared file-backed todo tool and `/todos` UI for assigning, refining, and closing work |
| `usage/` | Adds `/usage` to inspect recent Pi session activity across 7, 30, and 90 day windows |
| `window/` | Adds `/window` to inspect context-window usage, loaded resources, and observed skill reads |

### Skills

| Skill | What it does |
| --- | --- |
| `git-workflow/` | Git and GitHub operating rules for status, diffs, commits, sync, PRs, and recovery |
| `safe-remediation/` | Guardrails for applying audit, migration, security, and architecture recommendations safely |
| `web-research/` | Web research workflow: Moth search for discovery, Moth browser for fetching and verification |
| `release-changelog/` | Changelog format and release notes extraction for any project, independent of release assets |

### Prompt templates

| Prompt | What it does |
| --- | --- |
| `audit-quality.md` | Runs an architecture quality audit using GRASP, ATAM, and ISO/IEC 25010 |
| `title.md` | Generates a short ISO-prefixed Pi session title |



## Quick start

### Clone the repo

```bash
git clone https://github.com/alnah/agent.git
cd agent/extensions
npm ci
```

### Tell Pi to load it as a local package root

Add this to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "/absolute/path/to/agent"
    }
  ]
}
```

Pi will auto-discover:

- `extensions/`
- `skills/`
- `prompts/`

### Link the global context files Pi expects at fixed paths

```bash
ln -s /absolute/path/to/agent/AGENTS.md ~/.pi/agent/AGENTS.md
ln -s /absolute/path/to/agent/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```

If those files already exist, replace them with `ln -sf`.

### Reload Pi

Use `/reload`, or restart Pi.

## Development

Extension development lives under `extensions/`.

```bash
cd extensions
npm ci
npm run check
npx tsc --noEmit
npm run format
```

## Thanks

- [Mario Zechner](https://github.com/badlogic) for [Pi](https://github.com/badlogic/pi-mono)
- [Armin Ronacher](https://github.com/mitsuhiko) for the code and ideas behind the `answer`, `files`, `review`, `todos`, `usage`, and `window` extensions via [`agent-stuff`](https://github.com/mitsuhiko/agent-stuff)

