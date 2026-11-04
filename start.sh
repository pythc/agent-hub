#!/bin/sh
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
task_node=""
for task_candidate in "${SUPERAGENT_NODE:-}" /opt/homebrew/bin/node "$(command -v node || true)"; do
  if [ -n "$task_candidate" ] && [ -x "$task_candidate" ] && "$task_candidate" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' 2>/dev/null; then
    task_node=$task_candidate
    break
  fi
done
if [ -z "$task_node" ]; then echo "Node 22.19+ is required. Set SUPERAGENT_NODE to its executable." >&2; exit 1; fi
cd "$task_root"
if [ ! -f node_modules/tsx/dist/loader.mjs ]; then echo "Run npm ci with Node 22.19+ in this directory first." >&2; exit 1; fi
if [ "$#" -eq 0 ]; then set -- serve examples/config.json; fi
exec "$task_node" --import "$task_root/node_modules/tsx/dist/loader.mjs" "$task_root/src/cli.ts" "$@"
