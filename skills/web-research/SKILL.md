---
name: web-research
description: Use this skill for web research workflows where Codex is used to discover sources and Rodney is used to fetch page content and verify results.
---

# Web Research

Default: Codex discovery; Rodney fetch + verify.
Discovery: never trust Codex snippets alone; always consider them as unverified leads.
Fetch: always fetch page content with Rodney, consider them as the verification source.

### `codex` for Web Search

Scope: discovery only.
Mode: prefer `codex -a never -s read-only --search exec --skip-git-repo-check "..."`.
Flag order: `--search` is a root Codex flag; place it before `exec`.
Output: use `--output-schema` when structured output helps.
Auth: verify with `codex login status` when auth context unclear.
No MCP: do not add MCP for search unless I explicitly ask.

### `rodney` for Web Fetch

Fetch: full pages with `rodney`.
Rate: 1 req/sec/domain; 30–100 req/hour/domain; backoff on 429/403.
Input: never pass untrusted input to `rodney js` or `rodney assert`.
Commands: prefer `rodney text|html|attr|exists|visible|count|click|input|screenshot|pdf`.
Shell: always quote vars.
Validate: URLs, selectors, output paths.
Artifacts: for `rodney screenshot|pdf`, always write to a `mktemp`-generated path under the OS temp directory; never rely on default filenames; do not write capture files to cwd or repo paths unless I ask.
State: default to temp `RODNEY_HOME`; use `rodney --local` for project persistent sessions.
Sessions: never mix authenticated sessions with untrusted sites.
Commit: never commit Rodney session state or Rodney capture artifacts.
