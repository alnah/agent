# Adapters

The script output is a plain Markdown notes file. Wire it to any release tool.

## GoReleaser

Keep the generated changelog as a fallback without low-signal groups:

```yaml
changelog:
  sort: asc
  filters:
    exclude:
      - "^docs:"
      - "^test:"
      - "^chore:"
      - "^ci:"
      - "^style:"
      - "^build:"
  groups:
    - title: Features
      regexp: '^feat(\(.+\))?:'
      order: 0
    - title: Bug Fixes
      regexp: '^fix(\(.+\))?:'
      order: 1
    - title: Refactoring
      regexp: '^refactor(\(.+\))?:'
      order: 2
```

Pass curated notes at release time:

```yaml
- name: Extract release notes
  run: scripts/release-notes.sh "${GITHUB_REF_NAME}" > "${RUNNER_TEMP}/release-notes.md"

- name: Run GoReleaser
  uses: goreleaser/goreleaser-action@v6
  with:
    distribution: goreleaser
    version: "~> v2"
    args: release --clean --release-notes=${{ runner.temp }}/release-notes.md
```

`--release-notes` replaces the generated changelog body. Write the file outside
the repository, otherwise GoReleaser refuses the dirty tree.

Note: GoReleaser is not Go-only. It ships native builders for Go, Rust, Zig,
Bun, Deno, Node.js, uv, and Poetry, plus build hooks and pre-built binary
imports for anything else. Assets stay in the project configuration and never
in this skill.

## GitHub CLI

```bash
scripts/release-notes.sh "$TAG" > notes.md
gh release create "$TAG" \
  --title "project $TAG" \
  --notes-file notes.md
# append assets from the project build, for example dist/*.tar.gz
```

## GitLab CLI

```bash
scripts/release-notes.sh "$TAG" > notes.md
glab release create "$TAG" --notes-file notes.md
```

## Generic

Any release tool that accepts a notes file works:

```bash
scripts/release-notes.sh "$TAG" > notes.md
release-tool publish --tag "$TAG" --notes "$(cat notes.md)"   # or --notes-file notes.md
```

For workflows that pass paths through environment variables, export
`NOTES_FILE=notes.md` and document it in the project workflow.
