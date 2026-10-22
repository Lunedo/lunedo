#!/usr/bin/env bash
set -euo pipefail
export MSYS_NO_PATHCONV=1

image="${1:?usage: scripts/backup-network-check.sh <image with node, such as the Pagehall image under test>}"
curl_image="curlimages/curl:8.18.0@sha256:d94d07ba9e7d6de898b6d96c1a072f6f8266c687af78a74f380087a0addf5d17"

root="$(cd "$(dirname "$0")/.." && pwd)"
docs="$root/docs/backup.md"
project="pagehall-storage-$$"
work="$(mktemp -d "${TMPDIR:-/tmp}/pagehall-storage-$$-XXXX")"
if command -v cygpath >/dev/null; then work="$(cygpath -m "$work")"; fi
failures=0

compose() { docker compose --project-name "$project" --project-directory "$work" -f "$work/compose.yml" -f "$work/storage.yml" "$@"; }

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "  FAILED: $*" >&2
  failures=$((failures + 1))
}

awk '
  $0 == "<!-- backup-network-check -->" { found = 1; next }
  found && /^```/ { if (inside) exit; inside = 1; next }
  inside { print }
' "$docs" >"$work/storage.yml"
[ -s "$work/storage.yml" ] || { echo "The example marked backup-network-check is missing in docs/backup.md" >&2; exit 1; }
bash "$root/scripts/install.sh" print-compose >"$work/compose.yml"
sed -i.bak "s#^    image: ghcr.io/pagehall/pagehall:.*#    image: $image#" "$work/compose.yml"
{
  printf 'POSTGRES_PASSWORD=%s\n' "storage-check-$$"
  printf 'STORAGE_ACCESS_KEY=%s\n' "pagehall"
  printf 'STORAGE_SECRET_KEY=%s\n' "storage-check-secret-$$"
} >"$work/.env"

echo "Checking the storage example of docs/backup.md with the Compose file of the setup script"
compose config --format json >"$work/config.json"
read_config() {
  docker run --rm -i --entrypoint node "$image" -e "
    const config = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    $1
  " <"$work/config.json"
}
allowed="$(read_config 'process.stdout.write(config.services.pagehall.environment.PAGEHALL_OUTBOUND_ALLOWED_NETWORKS ?? "");')"
storage_address="$(read_config '
  const networks = config.services.storage.networks ?? {};
  process.stdout.write(Object.values(networks).map((network) => network?.ipv4_address).find(Boolean) ?? "");')"
pagehall_networks="$(read_config 'process.stdout.write(Object.keys(config.services.pagehall.networks ?? {}).sort().join(" "));')"

[ -n "$storage_address" ] || fail "The storage service has no fixed address"
[ "$allowed" = "$storage_address/32" ] ||
  fail "PAGEHALL_OUTBOUND_ALLOWED_NETWORKS is '$allowed', not only the address of the storage service ($storage_address/32)"
[ "$pagehall_networks" = "default storage" ] ||
  fail "Pagehall must stay on the default network and join the storage network, but is on: $pagehall_networks"

compose up -d --wait postgres storage >/dev/null
postgres_address="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(compose ps -q postgres)")"
for address in $postgres_address; do
  if [ "$address/32" = "$allowed" ]; then fail "The allowed address $allowed is the address of PostgreSQL"; fi
done
storage_networks="$(docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}' "$(compose ps -q storage)")"
case " $storage_networks " in
  *" ${project}_default "*) fail "The storage service is on the default network with PostgreSQL" ;;
esac

status=""
for _ in $(seq 1 60); do
  status="$(docker run --rm --network "${project}_storage" "$curl_image" -s -o /dev/null -w '%{http_code}' \
    -X PUT "http://$storage_address:8333/storage-check-$$" || true)"
  [ "$status" != "000" ] && break
  sleep 1
done
case "$status" in
  401 | 403) echo "  The storage service refuses a request without a key ($status)" ;;
  *) fail "The storage service answered a request without a key with $status instead of refusing it" ;;
esac

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) of the storage example failed" >&2
  exit 1
fi
echo "The storage example allows only $allowed and refuses requests without a key"
