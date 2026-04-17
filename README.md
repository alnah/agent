# Agent

> This is my [Pi](https://github.com/badlogic/pi-mono) config with extensions, skills, prompts, themes, and context files for terminal workflows. It is not a Pi fork. It extends Pi.

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
| `aside/` | Opens a side conversation with `/aside`, keeps its own thread, and can inject a summary back into the main chat |
| `files/` | Adds `/files` and `/diff` to browse repo files, recent references, diffs, Finder reveal, and Quick Look |
| `loop/` | Adds `/loop` plus `signal_loop_success` so Pi can keep iterating until a stop condition is met |
| `notifyer/` | Sends terminal notifications when a Pi turn finishes |
| `review/` | Adds `/review` and `/end-review` for branch, commit, PR, folder, and uncommitted-change review workflows |
| `todos/` | Adds a shared file-backed todo tool and `/todos` UI for assigning, refining, and closing work |
| `typescript-symbols/` | Adds `ts_definition`, `ts_references`, `ts_rename`, and `ts_symbols` for TypeScript symbol navigation, lookup, and project-wide rename |
| `usage/` | Adds `/usage` to inspect recent Pi session activity across 7, 30, and 90 day windows |
| `window/` | Adds `/window` to inspect context-window usage, loaded resources, and observed skill reads |

### Skills

| Skill | What it does |
| --- | --- |
| `git-workflow/` | Git and GitHub operating rules for status, diffs, commits, sync, PRs, and recovery |
| `web-research/` | Web research workflow: use Codex for discovery and [Rodney](https://github.com/simonw/rodney) for fetching and verification |

### Prompt templates

| Prompt | What it does |
| --- | --- |
| `title.md` | Generates a short ISO-prefixed Pi session title |

### Themes

| Theme | What it does |
| --- | --- |
| `dracula.json` | Dracula-inspired theme for Pi |



## Quick start

### Clone the repo

```bash
git clone https://github.com/alnah/agent.git
```

### Tell Pi to load it as a local package root

Add this to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["/absolute/path/to/agent"]
}
```

Pi will auto-discover:

- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

### Link the global context files Pi expects at fixed paths

```bash
ln -s /absolute/path/to/agent/AGENTS.md ~/.pi/agent/AGENTS.md
ln -s /absolute/path/to/agent/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```

If those files already exist, replace them with `ln -sf`.

### Reload Pi

Use `/reload`, or restart Pi.

### Local setup for `typescript-symbols/`

`typescript-symbols/` depends on the local `tsconfig.json` or `jsconfig.json`.
I do not enable it globally.
I keep the code in this repo and turn it on only in the repos I want, through a local, untracked `.pi/settings.json`.

In this repo:

```json
{
  "extensions": ["../extensions/typescript-symbols"]
}
```

In another local repo, point to this clone from that repo's `.pi/settings.json`. Use either an absolute path or the relative path that matches your own directory layout.

```json
{
  "extensions": ["/absolute/path/to/agent/extensions/typescript-symbols"]
}
```

The extension stays local to that repo, uses its current working directory, and resolves the nearest matching `tsconfig.json` or `jsconfig.json` for the requested file. If a repo contains several nested TypeScript projects, pass a file path inside the target project.

## Development

Extension development lives under `extensions/`.

```bash
cd extensions
npm run check
npm run format
```

## Thanks

- [Mario Zechner](https://github.com/badlogic) for [Pi](https://github.com/badlogic/pi-mono)
- [Armin Ronacher](https://github.com/mitsuhiko) for the code and ideas behind the `answer`, `aside`, `files`, `loop`, `review`, `todos`, `usage`, and `window` extensions via [`agent-stuff`](https://github.com/mitsuhiko/agent-stuff)
- [Simon Willison](https://github.com/simonw) for [Rodney](https://github.com/simonw/rodney), which the `web-research` skill uses as its fetch and verification layer
