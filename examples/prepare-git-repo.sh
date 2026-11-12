#!/bin/sh
set -eu

# Roppo runs this in the ticket directory. A resumed ticket keeps its commits and edits.
if [ -d repo/.git ]; then exit 0; fi
stage=$(mktemp -d .prepare-repo.XXXXXX)
trap 'rm -rf "$stage"' EXIT
git clone --no-local --single-branch --no-tags -- "$SUPERAGENT_SOURCE_DIR" "$stage/repo"
git -C "$stage/repo" switch -C "superagent/$(basename "$PWD")"
git -C "$stage/repo" config user.name 'Roppo Worker'
git -C "$stage/repo" config user.email 'worker@roppo.invalid'
git -C "$stage/repo" remote remove origin
mv "$stage/repo" .
