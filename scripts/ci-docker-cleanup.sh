#!/usr/bin/env bash
# Removes the containers, volumes and networks one CI job left behind on a shared runner host.
# Usage: scripts/ci-docker-cleanup.sh job <job id> [compose project...]
#        scripts/ci-docker-cleanup.sh stale
set -uo pipefail
export MSYS_NO_PATHCONV=1

max_age_seconds=$((6 * 60 * 60))

remove() {
  local kind="$1" age_limit="$2"
  shift 2
  local list=("$kind" ls -q) id created
  if [ "$kind" = container ]; then list=(container ls -a -q); fi
  while read -r id; do
    [ -n "$id" ] || continue
    if [ "$age_limit" = yes ]; then
      case "$kind" in
        volume) created="$(docker volume inspect -f '{{.CreatedAt}}' "$id" 2>/dev/null)" ;;
        *) created="$(docker "$kind" inspect -f '{{.Created}}' "$id" 2>/dev/null)" ;;
      esac
      created="${created%% m=*}"
      created="$(date -d "${created% UTC}" +%s 2>/dev/null)" || continue
      [ $(($(date +%s) - created)) -ge "$max_age_seconds" ] || continue
    fi
    case "$kind" in
      container) docker rm -f -v "$id" >/dev/null 2>&1 || true ;;
      *) docker "$kind" rm "$id" >/dev/null 2>&1 || true ;;
    esac
  done < <(docker "${list[@]}" "$@" 2>/dev/null | sort -u)
}

sweep() {
  local age_limit="$1"
  shift
  remove container "$age_limit" "$@"
  remove volume "$age_limit" "$@"
  remove network "$age_limit" "$@"
}

case "${1:-}" in
  job)
    job_id="${2:?usage: scripts/ci-docker-cleanup.sh job <job id> [compose project...]}"
    if [[ ! "$job_id" =~ ^([0-9]+-[0-9]+-[a-z0-9_-]+|local-[0-9]+)$ ]]; then
      echo "The job id must name the run, its attempt and the job: $job_id" >&2
      exit 2
    fi
    sweep no --filter "label=lunedo.ci.job=${job_id}"
    shift 2
    for project in "$@"; do
      if [[ "$project" != *"$job_id" ]]; then
        echo "The compose project must end with the job id: $project" >&2
        exit 2
      fi
      sweep no --filter "label=com.docker.compose.project=${project}"
    done
    ;;
  stale)
    sweep yes --filter "label=lunedo.ci.job"
    ;;
  *)
    echo "usage: scripts/ci-docker-cleanup.sh job <job id> [compose project...] | stale" >&2
    exit 2
    ;;
esac
