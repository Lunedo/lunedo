#!/usr/bin/env bash
# Backup round trip with the container image: create sample data, back it up, verify the backup,
# restore it into a fresh database and file store, and compare the result with the original.
# The same backup is then restored into the next PostgreSQL major version, and a scheduled backup
# to S3-compatible storage is restored into another fresh instance.
# Usage: scripts/backup-roundtrip.sh <image>
set -euo pipefail
# Keeps Git Bash on Windows from rewriting container paths.
export MSYS_NO_PATHCONV=1

image="${1:?usage: scripts/backup-roundtrip.sh <image>}"
suffix="$$"
network="pagehall-roundtrip-${suffix}"
postgres="pagehall-roundtrip-db-${suffix}"
postgres_next="pagehall-roundtrip-db-next-${suffix}"
s3="pagehall-roundtrip-s3-${suffix}"
worker="pagehall-roundtrip-worker-${suffix}"
source_data="pagehall-roundtrip-source-${suffix}"
target_data="pagehall-roundtrip-target-${suffix}"
next_data="pagehall-roundtrip-next-${suffix}"
s3_data="pagehall-roundtrip-s3-target-${suffix}"
backups="pagehall-roundtrip-backups-${suffix}"
password="roundtrip-${suffix}"
s3_secret="roundtrip-s3-${suffix}"
seaweedfs="chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d"
work="${TMPDIR:-/tmp}/pagehall-roundtrip-${suffix}"
mkdir -p "$work"

cleanup() {
  docker rm -f "$postgres" "$postgres_next" "$s3" "$worker" "${postgres}-api" >/dev/null 2>&1 || true
  docker volume rm -f "$source_data" "$target_data" "$next_data" "$s3_data" "$backups" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

url() { echo "postgres://pagehall:${password}@${2:-$postgres}:5432/$1"; }

pagehall() {
  local data="$1" database="$2"
  shift 2
  docker run --rm --network "$network" \
    -e PAGEHALL_DATABASE_URL="$(url "$database")" \
    -v "$data:/var/lib/pagehall" -v "$backups:/var/lib/pagehall/backups" \
    "$image" "$@"
}

psql_on() {
  local container="$1" database="$2"
  shift 2
  docker exec -i -e PGPASSWORD="$password" "$container" psql -v ON_ERROR_STOP=1 -qAt -U pagehall -d "$database" "$@"
}

psql_in() {
  local database="$1"
  shift
  psql_on "$postgres" "$database" "$@"
}

start_postgres() {
  local name="$1" version="$2"
  local postgres_args=() postgres_settings=()
  if [ -n "${CI:-}" ]; then
    postgres_args=(--tmpfs /var/lib/postgresql/data)
    postgres_settings=(-c fsync=off -c synchronous_commit=off -c full_page_writes=off)
  fi
  docker run -d --name "$name" --network "$network" ${postgres_args[@]+"${postgres_args[@]}"} \
    -e POSTGRES_USER=pagehall -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=source \
    "postgres:${version}-alpine" ${postgres_settings[@]+"${postgres_settings[@]}"} >/dev/null
  for _ in $(seq 1 60); do
    # Only the final server listens on TCP; the temporary one during initialization uses the socket.
    docker exec "$name" pg_isready -h 127.0.0.1 -U pagehall -d source >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "PostgreSQL ${version} did not start" >&2
  exit 1
}

# Every table in every schema, with its row count and a checksum of its content.
database_summary() {
  local container="$1" database="$2" table
  psql_on "$container" "$database" -c "select format('%I.%I', table_schema, table_name) from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name" |
    while read -r table; do
      printf '%s ' "$table"
      psql_on "$container" "$database" -c "select count(*), coalesce(md5(string_agg(t::text, E'\n' order by t::text)), '-')
        from $table t" </dev/null
    done
}

# The content tables of an instance, for comparisons with a source that kept running after the backup.
content_summary() {
  local container="$1" database="$2" table
  for table in instance accounts organizations spaces tree_items page_versions stored_files setting_values; do
    printf '%s ' "$table"
    psql_on "$container" "$database" -c "select count(*), coalesce(md5(string_agg(t::text, E'\n' order by t::text)), '-')
      from $table t" </dev/null
  done
}

file_checksums() {
  docker run --rm -v "$1:/var/lib/pagehall" --entrypoint sh "$image" -c \
    'cd /var/lib/pagehall/files && find . -type f -exec sha256sum {} + | sort'
}

copy_secrets() {
  # The operator keeps the secrets separately from backups; the new instance gets the same keys.
  docker run --rm -v "$1:/var/lib/pagehall" -v "$source_data:/source:ro" --entrypoint sh "$image" -c \
    'cp /source/secrets/* /var/lib/pagehall/secrets/'
}

echo "Starting PostgreSQL"
docker network create "$network" >/dev/null
start_postgres "$postgres" 16
psql_in source -c "create database target"
psql_in source -c "create database target_s3"

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
copy_secrets "$target_data"
pagehall "$target_data" target backup restore --input /var/lib/pagehall/backups/roundtrip.phbak

echo "Comparing"
database_summary "$postgres" source > "$work/source.txt"
database_summary "$postgres" target > "$work/target.txt"
if [ "$(wc -l < "$work/source.txt")" -lt 5 ]; then
  echo "The source database has fewer tables than expected" >&2
  exit 1
fi
diff "$work/source.txt" "$work/target.txt"
echo "Compared $(wc -l < "$work/source.txt") tables"
diff <(file_checksums "$source_data") <(file_checksums "$target_data")

echo "Checking that a second restore is refused"
if pagehall "$target_data" target backup restore --input /var/lib/pagehall/backups/roundtrip.phbak 2>/dev/null; then
  echo "A restore into a non-empty instance was not refused" >&2
  exit 1
fi

echo "Checking the restored instance"
pagehall "$target_data" target keys status
pagehall "$target_data" target audit verify

echo "Restoring into the next PostgreSQL major version"
start_postgres "$postgres_next" 17
copy_secrets "$next_data"
docker run --rm --network "$network" \
  -e PAGEHALL_DATABASE_URL="$(url source "$postgres_next")" \
  -v "$next_data:/var/lib/pagehall" -v "$backups:/var/lib/pagehall/backups" \
  "$image" backup restore --input /var/lib/pagehall/backups/roundtrip.phbak
database_summary "$postgres_next" source > "$work/next.txt"
diff "$work/source.txt" "$work/next.txt"
diff <(file_checksums "$source_data") <(file_checksums "$next_data")
echo "Restored into PostgreSQL $(psql_on "$postgres_next" source -c "show server_version" | cut -d. -f1)"

echo "Backing up to S3-compatible storage on a schedule"
docker run -d --name "$s3" --network "$network" \
  -e AWS_ACCESS_KEY_ID=pagehall -e AWS_SECRET_ACCESS_KEY="$s3_secret" "$seaweedfs" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$s3" wget -qO- http://127.0.0.1:8333/healthz >/dev/null 2>&1 && break
  sleep 1
done
subnet="$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' "$network")"
# The schedule fires at the next full minute but one, in UTC, the default time zone of an instance.
daily_time="$(date -u -d '+2 minutes' +%H:%M)"
docker run --rm --network "$network" -e PAGEHALL_DATABASE_URL="$(url source)" \
  -v "$source_data:/var/lib/pagehall" -w /app/worker --entrypoint node "$image" --input-type=module -e '
const { backupS3SecretContext, createDatabasePool, createKeyProvider, Encryption, loadConfig } =
  await import("@pagehall/server");
const [endpoint, secret, dailyTime] = process.argv.slice(1);
const config = loadConfig(process.env);
const ring = await createKeyProvider(config).load();
const value = new Encryption(() => ring).encrypt(secret, backupS3SecretContext());
const pool = createDatabasePool({ connectionString: config.database.url.reveal(), applicationName: "roundtrip" });
await pool.query(
  `insert into backup_configuration (singleton, enabled, daily_time, target_kind, s3_endpoint, s3_region,
     s3_bucket, s3_prefix, s3_force_path_style, s3_access_key_id)
   values (true, true, $1, $2, $3, $4, $5, $6, true, $7)`,
  [dailyTime, "s3", endpoint, "us-east-1", "roundtrip", "scheduled/", "pagehall"],
);
await pool.query("insert into instance_secrets (name, value) values ($1, $2)", ["backup.s3SecretAccessKey", value]);
await pool.query("insert into backup_state (singleton, last_slot, enabled_at) values (true, now(), now())");
await pool.end();
' "http://${s3}:8333" "$s3_secret" "$daily_time"
docker run -d --name "$worker" --network "$network" -e PAGEHALL_DATABASE_URL="$(url source)" \
  -e PAGEHALL_OUTBOUND_ALLOWED_NETWORKS="$subnet" \
  -v "$source_data:/var/lib/pagehall" -v "$backups:/var/lib/pagehall/backups" "$image" worker >/dev/null
state=""
for _ in $(seq 1 90); do
  state="$(psql_in source -c "select state from backup_runs where trigger = 'scheduled' order by started_at desc limit 1")"
  if [ "$state" = "succeeded" ] || [ "$state" = "failed" ] || [ "$state" = "skipped" ]; then break; fi
  sleep 5
done
if [ "$state" != "succeeded" ]; then
  psql_in source -c "select state, error from backup_runs"
  docker logs "$worker" | tail -50
  echo "The scheduled backup to S3 did not succeed (state: ${state:-none})" >&2
  exit 1
fi
name="$(psql_in source -c "select name from backup_runs where trigger = 'scheduled' and state = 'succeeded' limit 1")"
docker rm -f "$worker" >/dev/null
content_summary "$postgres" source > "$work/s3-source.txt"
docker run --rm --network "$network" -v "$backups:/var/lib/pagehall/backups" -w /app/worker \
  --entrypoint node "$image" --input-type=module -e '
import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
const require = createRequire(createRequire(import.meta.url).resolve("@pagehall/server"));
const { GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const [endpoint, secret, key, output] = process.argv.slice(1);
const client = new S3Client({
  region: "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: "pagehall", secretAccessKey: secret },
});
const object = await client.send(new GetObjectCommand({ Bucket: "roundtrip", Key: key }));
await pipeline(object.Body, createWriteStream(output));
' "http://${s3}:8333" "$s3_secret" "scheduled/${name}" "/var/lib/pagehall/backups/${name}"

echo "Restoring the scheduled backup from S3 into a fresh instance"
copy_secrets "$s3_data"
pagehall "$s3_data" target_s3 backup restore --input "/var/lib/pagehall/backups/${name}"
content_summary "$postgres" target_s3 > "$work/s3-target.txt"
diff "$work/s3-source.txt" "$work/s3-target.txt"
diff <(file_checksums "$source_data") <(file_checksums "$s3_data")

echo "Backup round trip succeeded"
