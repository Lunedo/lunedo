#!/usr/bin/env bash
set -euo pipefail

roles=(api collab worker)
role="${1:-all}"

start_role() {
  node "/app/server/$1.js"
}

case "$role" in
  backup | keys | audit | search | maintenance | version | release-notes | help)
    exec node /app/server/cli.js "$@"
    ;;
  api | collab | worker)
    exec node "/app/server/$role.js"
    ;;
  all)
    pids=()
    for name in "${roles[@]}"; do
      start_role "$name" &
      pids+=("$!")
    done
    trap 'kill -TERM "${pids[@]}" 2>/dev/null || true' TERM INT
    status=0
    wait -n "${pids[@]}" || status=$?
    kill -TERM "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
    exit "$status"
    ;;
  *)
    echo "Unknown command '$role'. Use api, collab, worker, all, backup, keys, audit, search, maintenance, version or release-notes." >&2
    exit 64
    ;;
esac
