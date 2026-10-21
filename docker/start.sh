#!/usr/bin/env bash
set -euo pipefail

roles=(api collab worker)
role="${1:-all}"

start_role() {
  node --enable-source-maps "/app/$1/dist/main.js"
}

case "$role" in
  backup | keys | audit | search | maintenance | version | help)
    exec node --enable-source-maps /app/worker/dist/cli/main.js "$@"
    ;;
  api | collab | worker)
    exec node --enable-source-maps "/app/$role/dist/main.js"
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
    echo "Unknown command '$role'. Use api, collab, worker, all, backup, keys, audit, search, maintenance or version." >&2
    exit 64
    ;;
esac
