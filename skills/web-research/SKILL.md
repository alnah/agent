---
name: web-research
description: Use this skill for web research workflows where Moth search is used to discover sources and Moth browser is used to fetch page content and verify results.
---

# Web Research

- Default: Moth search discovery; Moth browser fetch + verify.
- Discovery: never trust search snippets alone; always consider them as unverified leads.
- Fetch: fetch page content with `moth browser`, consider it the verification source.
- Social: for Meta social domains and Reddit, do not fetch page text or HTML; screenshots only.
- Media: for YouTube, PDF text, X, and podcasts, use the dedicated Moth commands as-is; transcribe YouTube videos and podcasts when useful.

### `moth tools` for Readiness

- Doctor: run `moth tools doctor --pretty` before workflows that need external tools.
- Install: when doctor reports a missing trusted tool that blocks the task, install it; ask approval for barely adopted tools.

### `moth search` for Web Search

- Scope: discovery only.
- Mode: prefer `moth search web "..." --pretty`.
- Images: use `moth search images "..." --pretty` when image discovery helps.
- Videos: use `moth search videos "..." --pretty` when video discovery helps.
- Output: use `--output` when artifacts help.
- Limits: use `--count`, `--max-results`, `--offset`, `--lang`, `--country`, and `--safe` when useful.

### `moth browser` for Web Fetch

- Fetch: full pages with `moth browser`.
- Rate: Moth serializes browser work by registrable domain, but does not enforce 1 req/sec or hourly quotas; self-limit to 1 req/sec/domain and 30–100 req/hour/domain.
- Backoff: Moth API clients retry 429 with `Retry-After`/exponential backoff; treat 403 as stop/manual backoff, not automatic retry.
- Commands: prefer `moth browser open|ax-tree|metadata|screenshot|pdf|wait|click|input|download`.
- Shell: always quote vars.
- Validate: URLs, selectors, output paths.
- Artifacts: for `moth browser screenshot|pdf`, always write to a `mktemp`-generated path under the OS temp directory; never rely on default filenames; do not write capture files to cwd or repo paths unless I ask.
- State: default to local project browser state only when needed; otherwise avoid persistent sessions.
- Sessions: never mix authenticated sessions with untrusted sites.
- Commit: never commit browser session state or browser capture artifacts.
- Close: always close the browser when you're done with a prompt.

### Social Domains

- Scope: Meta social media domains and Reddit.
- Domains: `facebook.com`, `instagram.com`, `threads.net`, `reddit.com`, `old.reddit.com`, `redd.it`.
- Rule: no text fetch, no HTML fetch, no metadata extraction for content verification.
- Allowed: `moth browser screenshot` only, with temp output paths.

### Dedicated Moth Sources

- YouTube: use `moth youtube search|metadata|subtitles|audio` as-is; transcribe with `moth youtube audio`, then `moth transcribe`.
- PDF: use `moth pdf2txt` as-is.
- X: use `moth x search|post|user|user-lookup` as-is.
- Podcast: use `moth podcast search|episodes|audio` as-is; transcribe with `moth podcast audio`, then `moth transcribe`.
