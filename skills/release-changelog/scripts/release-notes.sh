#!/bin/sh

# Extract release notes for a tag from a Keep a Changelog file and rewrite
# relative Markdown links to absolute URLs pinned to that tag.
#
# Asset agnostic: produces a notes file for any release tool.

set -u

die() {
	printf '%s\n' "$1" >&2
	exit 1
}

usage() {
	cat >&2 <<'EOF'
usage: release-notes.sh [TAG] [--changelog PATH] [--base-path DIR] [--repo OWNER/REPO]

Extracts the section for TAG from CHANGELOG.md and rewrites relative Markdown
links to https://github.com/OWNER/REPO/blob|tree/TAG/PATH.

Defaults:
  TAG        argument, else GORELEASER_CURRENT_TAG, else exact tag on HEAD
  changelog  CHANGELOG.md at the repository root
  base-path  empty
  repo       parsed from the origin remote
EOF
}

tag=""
changelog=""
base_path=""
repo=""

while [ "$#" -gt 0 ]; do
	case "$1" in
	--changelog)
		[ "$#" -ge 2 ] || die "--changelog requires a value"
		changelog=$2
		shift 2
		;;
	--base-path)
		[ "$#" -ge 2 ] || die "--base-path requires a value"
		base_path=$2
		shift 2
		;;
	--repo)
		[ "$#" -ge 2 ] || die "--repo requires a value"
		repo=$2
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	-*)
		die "unknown option: $1"
		;;
	*)
		[ -z "$tag" ] || die "unexpected argument: $1"
		tag=$1
		shift
		;;
	esac
done

if [ -z "$tag" ]; then
	if [ -n "${GORELEASER_CURRENT_TAG:-}" ]; then
		tag=$GORELEASER_CURRENT_TAG
	else
		tag=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
	fi
	[ -n "$tag" ] || die "no release tag given and HEAD is not tagged; expected vX.Y.Z"
fi

case "$tag" in
v[0-9]*.[0-9]*.[0-9]*) ;;
*) die "invalid release tag: $tag; expected vX.Y.Z, for example v0.1.1" ;;
esac

if [ -z "$changelog" ]; then
	repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
	changelog="$repo_root/CHANGELOG.md"
fi

if [ -z "$repo" ]; then
	origin=$(git remote get-url origin 2>/dev/null || true)
	case "$origin" in
	https://github.com/*)
		repo=${origin#https://github.com/}
		repo=${repo%.git}
		;;
	git@github.com:*)
		repo=${origin#git@github.com:}
		repo=${repo%.git}
		;;
	*)
		die "cannot detect a GitHub repository from origin; pass --repo OWNER/REPO"
		;;
	esac
fi

base_path=${base_path#./}
base_path=${base_path%/}

version=${tag#v}

[ -f "$changelog" ] || die "changelog not found: $changelog"

notes=$(
	awk -v version="$version" '
		BEGIN { heading = "^## \\[" version "\\]([[:space:]]+-[[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2})?[[:space:]]*$" }
		$0 ~ heading { found = 1; next }
		found && /^## \[/ { exit }
		found { print }
	' "$changelog"
)

case "$notes" in
*[![:space:]]*) ;;
*) die "no changelog section found for $tag" ;;
esac

printf '%s\n' "$notes" | awk -v tag="$tag" -v repo="$repo" -v base="$base_path" '
function rewrite(target,   fragment, path, route, hash) {
	if (target ~ /^[a-zA-Z][a-zA-Z0-9+.-]*:/ || target ~ /^#/ || target ~ /^\/\//) {
		return target
	}
	fragment = ""
	path = target
	hash = index(path, "#")
	if (hash > 0) {
		fragment = substr(path, hash)
		path = substr(path, 1, hash - 1)
	}
	route = "blob"
	if (path ~ /\/$/) {
		route = "tree"
	}
	if (path ~ /^\//) {
		sub(/^\/+/, "", path)
	} else if (base != "") {
		path = base "/" path
	}
	return "https://github.com/" repo "/" route "/" tag "/" path fragment
}
{
	out = ""
	line = $0
	while ((start = index(line, "](")) > 0) {
		head = substr(line, 1, start + 1)
		rest = substr(line, start + 2)
		end = index(rest, ")")
		if (end == 0) {
			break
		}
		out = out head rewrite(substr(rest, 1, end - 1))
		line = substr(rest, end)
	}
	print out line
}'
