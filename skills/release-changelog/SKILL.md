---
name: release-changelog
description: Harmonize CHANGELOG.md and release notes across projects, independent of release assets. Use when writing or reviewing a changelog, preparing a release, extracting release notes for a tag, or wiring GoReleaser, gh, glab, or any release tool to a notes file.
---

# Release changelog

## Contract

- The project owns `CHANGELOG.md`: source of truth for user-facing changes.
- This skill owns format, curation rules, section extraction, and notes delivery.
- Assets stay out of scope: builds, binaries, archives, checksums, containers, registries, signing, SBOM, brew, npm.
- Output contract: a notes Markdown file for one tag. Any release tool can consume it.

## File format

Keep a Changelog, English, one file per releasable package.

- Header: `# Changelog`, short intro with links to Keep a Changelog and Semantic Versioning.
- `## [Unreleased]` first. Empty after a release.
- Released sections: `## [X.Y.Z] - YYYY-MM-DD`, most recent first.
- Section order: optional `### New Features` lead, then `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
- `### New Features`: bold lead-in, one line, links to docs at the tag. Use for headline changes. Remaining entries go in the classic sections.
- Entries: user-facing prose, consistent tense, no commit hashes, no `chore`, `style`, `ci`, `test`, `docs` noise.
- Links: relative paths in the file (`docs/guide.md#anchor`), rewritten to tag URLs at extraction. Issues and PRs use absolute URLs.

Template: `assets/CHANGELOG.template.md`.

## Release procedure

1. Preflight: clean tree, CI green, version chosen. SemVer: `feat` minor, `fix` patch, breaking major.
2. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`. Commit.
3. Tag and publish. The tag must contain the released section and no `[Unreleased]`, matching pi.
4. Extract notes with the vendored script: `scripts/release-notes.sh vX.Y.Z > notes.md`.
5. Publish the release with the notes file. See `references/adapters.md`.
6. After publication, add an empty `## [Unreleased]` back on the default branch. Commit.
7. Verify: release body equals the extracted section, links resolve at the tag, assets are attached by the project workflow.

Git operations (status, commits, tags, push) follow the `git-workflow` skill.

## Script

Vendor `scripts/release-notes.sh` into each project under `scripts/`, like pi vendors `scripts/release-notes.mjs`. Do not run it from this skill directory.

```bash
scripts/release-notes.sh v0.1.1
scripts/release-notes.sh v0.1.1 --changelog packages/app/CHANGELOG.md --base-path packages/app
scripts/release-notes.sh v0.1.1 --repo owner/repo > notes.md
```

Behavior:

- Tag from argument, else `GORELEASER_CURRENT_TAG`, else exact tag on HEAD.
- Changelog from `--changelog`, else `CHANGELOG.md` at the repository root.
- Repo from `--repo`, else parsed from `origin` (https or ssh).
- `--base-path` prefixes relative links for monorepos.
- Rewrites relative Markdown links to `https://github.com/OWNER/REPO/blob|tree/TAG/PATH`, directories use `tree`.
- Leaves absolute URLs, `#anchors`, `//` and scheme links untouched.
- Exits non-zero when the tag is invalid, the section is missing or empty, or the repo cannot be detected.

Honor the pi lesson: write the generated notes outside the repository when the release tool refuses a dirty tree, for example `"${RUNNER_TEMP}/release-notes.md"` in GitHub Actions.

## Monorepo

One repository, several releasable packages.

- Per-package changelog, repo-wide tag: pi pattern. File at `packages/app/CHANGELOG.md`, links relative to `packages/app`, extraction with `--changelog packages/app/CHANGELOG.md --base-path packages/app`.
- Single changelog at the root is valid when every package ships together. Pick one model per repository and stay consistent.

## Prereleases

Out of scope in v1, matching pi: stable SemVer releases only. If a project needs `X.Y.Z-rc.N`, treat it as a normal section heading and mark the hosting release as prerelease in the project adapter.

## Failure modes

- Missing or empty section: script fails. Fix the changelog. Never publish without notes.
- Relative links not rewritten: release page links break. Keep links relative in the file, rewrite at extraction.
- Notes file inside the repo: some tools refuse a dirty tree. Write to a temp directory.
- `[Unreleased]` left at the tag: notes leak unreleased entries. Rename before tagging.
- Tag moved after publication: notes and assets mismatch. Never move a published tag.

## Out of scope

Build and packaging steps. This skill never compiles, uploads, signs, or publishes artifacts.
