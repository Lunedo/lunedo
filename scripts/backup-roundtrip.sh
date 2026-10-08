#!/usr/bin/env bash
# Backup round trip with the container image: create sample data, back it up, verify the backup,
# restore it into a fresh database and file store, and compare the result with the original.
# Usage: scripts/backup-roundtrip.sh <image>
set -euo pipefail
# Keeps Git Bash on Windows from rewriting container paths.
export MSYS_NO_PATHCONV=1

image="${1:?usage: scripts/backup-roundtrip.sh <image>}"
suffix="$$"
network="pagehall-roundtrip-${suffix}"
postgres="pagehall-roundtrip-db-${suffix}"
source_data="pagehall-roundtrip-source-${suffix}"
target_data="pagehall-roundtrip-target-${suffix}"
backups="pagehall-roundtrip-backups-${suffix}"
password="roundtrip-${suffix}"

cleanup() {
  docker rm -f "$postgres" >/dev/null 2>&1 || true
  docker volume rm -f "$source_data" "$target_data" "$backups" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -f "${TMPDIR:-/tmp}/roundtrip-source-${suffix}.txt" "${TMPDIR:-/tmp}/roundtrip-target-${suffix}.txt"
}
trap cleanup EXIT

url() { echo "postgres://pagehall:${password}@${postgres}:5432/$1"; }

pagehall() {
  local data="$1" database="$2"
  shift 2
  docker run --rm --network "$network" \
    -e PAGEHALL_DATABASE_URL="$(url "$database")" \
    -v "$data:/var/lib/pagehall" -v "$backups:/var/lib/pagehall/backups" \
    "$image" "$@"
}

psql_in() {
  docker exec -i -e PGPASSWORD="$password" "$postgres" psql -v ON_ERROR_STOP=1 -qAt -U pagehall -d "$1" "${@:2}"
}

echo "Starting PostgreSQL"
docker network create "$network" >/dev/null
postgres_args=()
postgres_settings=()
if [ -n "${CI:-}" ]; then
  postgres_args=(--tmpfs /var/lib/postgresql/data)
  postgres_settings=(-c fsync=off -c synchronous_commit=off -c full_page_writes=off)
fi
docker run -d --name "$postgres" --network "$network" ${postgres_args[@]+"${postgres_args[@]}"} \
  -e POSTGRES_USER=pagehall -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=source \
  postgres:16-alpine ${postgres_settings[@]+"${postgres_settings[@]}"} >/dev/null
for _ in $(seq 1 60); do
  # Only the final server listens on TCP; the temporary one during initialization uses the socket.
  docker exec "$postgres" pg_isready -h 127.0.0.1 -U pagehall -d source >/dev/null 2>&1 && break
  sleep 1
done
psql_in source -c "create database target"

echo "Setting up the source instance through configuration and creating sample data"
docker run -d --name "${postgres}-api" --network "$network" \
  -e PAGEHALL_DATABASE_URL="$(url source)" -e PAGEHALL_INSTANCE_URL=https://wiki.example.org \
  -e PAGEHALL_OWNER_EMAIL=owner@example.org -e PAGEHALL_OWNER_NAME=Owner \
  -e PAGEHALL_OWNER_PASSWORD="roundtrip owner ${suffix}" -e PAGEHALL_ORGANIZATION_NAME=Roundtrip \
  -v "$source_data:/var/lib/pagehall" "$image" api >/dev/null
for _ in $(seq 1 60); do
  if [ "$(psql_in source -c "select to_regclass('public.instance') is not null
    and exists (select 1 from instance where setup_completed_at is not null)" 2>/dev/null)" = "t" ]; then break; fi
  sleep 1
done
docker rm -f "${postgres}-api" >/dev/null
if [ "$(psql_in source -c "select count(*) from audit_events")" -lt 3 ]; then
  echo "Setup through configuration wrote no audit events" >&2
  exit 1
fi
psql_in source -c "insert into setting_values (id, level, scope_id, key, value, locked) values
  ('0192f0e0-0000-7000-8000-000000000001', 'instance', '00000000-0000-0000-0000-000000000000', 'locale.language', '\"de\"', true),
  ('0192f0e0-0000-7000-8000-000000000002', 'organization', '0192f0e0-0000-7000-8000-00000000000a', 'locale.timeZone', '\"Europe/Vienna\"', false)"
docker run --rm -v "$source_data:/var/lib/pagehall" --entrypoint sh "$image" -c \
  'mkdir -p /var/lib/pagehall/files/attachments/2026 && head -c 3000000 /dev/urandom > /var/lib/pagehall/files/attachments/2026/large.bin && echo "report" > /var/lib/pagehall/files/report.txt'

echo "Creating and verifying the backup"
pagehall "$source_data" source backup create --output /var/lib/pagehall/backups/roundtrip.phbak
pagehall "$source_data" source backup verify --input /var/lib/pagehall/backups/roundtrip.phbak

echo "Restoring into a fresh instance"
# The operator keeps the secrets separately from backups; the new instance gets the same keys.
docker run --rm -v "$target_data:/var/lib/pagehall" -v "$source_data:/source:ro" --entrypoint sh "$image" -c \
  'cp /source/secrets/* /var/lib/pagehall/secrets/'
pagehall "$target_data" target backup restore --input /var/lib/pagehall/backups/roundtrip.phbak

echo "Comparing"
# Every table in every schema, with its row count and a checksum of its content.
database_summary() {
  local database="$1" table
  psql_in "$database" -c "select format('%I.%I', table_schema, table_name) from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name" |
    while read -r table; do
      printf '%s ' "$table"
      psql_in "$database" -c "select count(*), coalesce(md5(string_agg(t::text, E'\n' order by t::text)), '-')
        from $table t" </dev/null
    done
}
database_summary source > "${TMPDIR:-/tmp}/roundtrip-source-${suffix}.txt"
database_summary target > "${TMPDIR:-/tmp}/roundtrip-target-${suffix}.txt"
if [ "$(wc -l < "${TMPDIR:-/tmp}/roundtrip-source-${suffix}.txt")" -lt 5 ]; then
  echo "The source database has fewer tables than expected" >&2
  exit 1
fi
diff "${TMPDIR:-/tmp}/roundtrip-source-${suffix}.txt" "${TMPDIR:-/tmp}/roundtrip-target-${suffix}.txt"
echo "Compared $(wc -l < "${TMPDIR:-/tmp}/roundtrip-source-${suffix}.txt") tables"
checksums='cd /var/lib/pagehall/files && find . -type f -exec sha256sum {} + | sort'
diff <(docker run --rm -v "$source_data:/var/lib/pagehall" --entrypoint sh "$image" -c "$checksums") \
  <(docker run --rm -v "$target_data:/var/lib/pagehall" --entrypoint sh "$image" -c "$checksums")

echo "Checking that a second restore is refused"
if pagehall "$target_data" target backup restore --input /var/lib/pagehall/backups/roundtrip.phbak 2>/dev/null; then
  echo "A restore into a non-empty instance was not refused" >&2
  exit 1
fi

echo "Checking the restored instance"
pagehall "$target_data" target keys status
pagehall "$target_data" target audit verify

echo "Backup round trip succeeded"
