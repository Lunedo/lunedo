#!/usr/bin/env bash
# Backup round trip with the container image: create sample data, back it up, verify the backup,
# restore it into a fresh database and file store, and compare the result with the original.
# Usage: scripts/backup-roundtrip.sh <image>
set -euo pipefail

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
}
trap cleanup EXIT

url() { echo "postgres://pagehall:${password}@${postgres}:5432/$1"; }

pagehall() {
  local data="$1" database="$2"
  shift 2
  docker run --rm --network "$network" \
    -e PAGEHALL_DATABASE_URL="$(url "$database")" \
    -v "$data:/var/lib/pagehall" -v "$backups:/backups" \
    "$image" "$@"
}

psql_in() {
  docker exec -i -e PGPASSWORD="$password" "$postgres" psql -v ON_ERROR_STOP=1 -qAt -U pagehall -d "$1" "${@:2}"
}

echo "Starting PostgreSQL"
docker network create "$network" >/dev/null
docker run -d --name "$postgres" --network "$network" \
  -e POSTGRES_USER=pagehall -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=source \
  postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$postgres" pg_isready -U pagehall -d source >/dev/null 2>&1 && break
  sleep 1
done
psql_in source -c "create database target"

echo "Migrating the source instance and creating sample data"
docker run -d --name "${postgres}-worker" --network "$network" \
  -e PAGEHALL_DATABASE_URL="$(url source)" -v "$source_data:/var/lib/pagehall" "$image" worker >/dev/null
for _ in $(seq 1 60); do
  if [ "$(psql_in source -c "select to_regclass('public.setting_values') is not null")" = "t" ]; then break; fi
  sleep 1
done
docker rm -f "${postgres}-worker" >/dev/null
psql_in source -c "insert into setting_values (id, level, scope_id, key, value, locked) values
  ('0192f0e0-0000-7000-8000-000000000001', 'instance', '00000000-0000-0000-0000-000000000000', 'locale.language', '\"de\"', true),
  ('0192f0e0-0000-7000-8000-000000000002', 'organization', '0192f0e0-0000-7000-8000-00000000000a', 'locale.timeZone', '\"Europe/Vienna\"', false)"
docker run --rm -v "$source_data:/var/lib/pagehall" --entrypoint sh "$image" -c \
  'mkdir -p /var/lib/pagehall/files/attachments/2026 && head -c 3000000 /dev/urandom > /var/lib/pagehall/files/attachments/2026/large.bin && echo "report" > /var/lib/pagehall/files/report.txt'

echo "Creating and verifying the backup"
pagehall "$source_data" source backup create --output /backups/roundtrip.phbak
pagehall "$source_data" source backup verify --input /backups/roundtrip.phbak

echo "Restoring into a fresh instance"
docker run --rm -v "$source_data:/source" -v "$target_data:/target" --entrypoint sh "$image" -c \
  'mkdir -p /target/secrets && cp /source/secrets/* /target/secrets/'
pagehall "$target_data" target backup restore --input /backups/roundtrip.phbak

echo "Comparing"
query="select level, scope_id, key, value, locked from setting_values order by id"
diff <(psql_in source -c "$query") <(psql_in target -c "$query")
checksums='cd /var/lib/pagehall/files && find . -type f -exec sha256sum {} + | sort'
diff <(docker run --rm -v "$source_data:/var/lib/pagehall" --entrypoint sh "$image" -c "$checksums") \
  <(docker run --rm -v "$target_data:/var/lib/pagehall" --entrypoint sh "$image" -c "$checksums")

echo "Checking that a second restore is refused"
if pagehall "$target_data" target backup restore --input /backups/roundtrip.phbak 2>/dev/null; then
  echo "A restore into a non-empty instance was not refused" >&2
  exit 1
fi

echo "Checking that the restored instance starts"
pagehall "$target_data" target keys status

echo "Backup round trip succeeded"
