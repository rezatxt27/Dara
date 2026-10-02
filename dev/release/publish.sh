#!/usr/bin/env bash
# Publish a GitHub release for every extension version that doesn't have one yet (idempotent).
# A version's release points at the first commit that carried it in extension/manifest.json; its zip is
# that commit's extension folder and its notes come from the current changelog.js. The newest is marked latest.
# Runs in GitHub Actions (needs GH_TOKEN with contents: write).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
out=$(mktemp -d)
declare -A seen
newest=""
while read -r sha; do
  v=$(git show "$sha:extension/manifest.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")
  [[ -n "${seen[$v]:-}" ]] && continue
  seen[$v]=1; newest=$v
  if git rev-parse -q --verify "refs/tags/v$v" >/dev/null || gh release view "v$v" >/dev/null 2>&1; then echo "v$v: already released"; continue; fi
  git archive --format=zip -o "$out/dara-extension-v$v.zip" "$sha:extension"
  node dev/release/notes.mjs "$v" > "$out/notes-$v.md"
  gh release create "v$v" "$out/dara-extension-v$v.zip" --title "دارا v$v" --notes-file "$out/notes-$v.md" --target "$sha" --latest=false
  echo "v$v: released from ${sha:0:7}"
done < <(git log --reverse --format=%H -- extension/manifest.json)
[[ -n "$newest" ]] && gh release edit "v$newest" --latest >/dev/null && echo "latest: v$newest"
