---
name: git-workflow
description: Git and GitHub workflow. Use for status, diffs, commits, syncing with remote, recovery, PRs, issues, and GitHub Actions.
---

# Git and GitHub workflow

Tools: always `git` for repo and history, `gh` for PRs, issues, Actions, and repo hosting.

## Repo rules

Branching: always commit to current branch; only if I ask, topic branch.
Commands: prefer `git switch` and `git restore`; never run `git pull` blindly; always `git push --force-with-lease`; never `git push --force`.
Sync: always `git fetch`; then ask the user before running `git rebase <remote>/<branch>` or `git merge <remote>/<branch>`.
Push: if rewrite needed, use `--force-with-lease`, never plain `--force`.
Recovery: use `git reflog` before panic.

## Commit rules

Before: always `git status`; then `git diff`, then `git diff --cached`, then `git --no-pager log --pretty=format:'%h %s (%cr) <%an>' -n 50`.
Then: always small, atomic commits; prefer split unrelated changes.
Subject: short, imperative, informative; prefer <= 50 chars.
Body: blank line, then why/constraints when non-obvious.
Wrap: commit body prose at ~72 chars.
Types: `feat|fix|refactor|build|ci|chore|docs|style|perf|test`.
Scope: prefer no scopes; if codebase gets bigger, prefer based on repo's modules, historical/long-term support; never vague; always ask user before new scope.
Footers: use `BREAKING CHANGE:` and trailer-style footers when needed.

## GitHub rules

PRs: open or merge if the user asks, or the repo clearly uses PR review.
Auth: `gh auth status` when auth or host context unclear.
Repo: `gh repo view|create|fork|clone`.
Issues: `gh issue list|view|create`.
CI: `gh run list|view|watch`.
Merge: use `gh pr merge` with explicit strategy.

## Tracking files

Gitignore: always toptal-like, with comments.
