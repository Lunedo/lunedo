#!/usr/bin/env bash
set -euo pipefail
export MSYS_NO_PATHCONV=1

image="${1:?usage: scripts/reverse-proxy-check.sh <image> [caddy|nginx|traefik ...]}"
shift
proxies=("$@")
if [ "${#proxies[@]}" -eq 0 ]; then proxies=(caddy nginx traefik); fi

caddy_image="caddy:2.11-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f"
nginx_image="nginx:1.30-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5"
traefik_image="traefik:v3.7@sha256:6d3e069ee484ab1da5adfdda555a75eb9b1545ef09096a0cc7c3043101986a20"
curl_image="curlimages/curl:8.18.0@sha256:d94d07ba9e7d6de898b6d96c1a072f6f8266c687af78a74f380087a0addf5d17"
postgres_image="postgres:16-alpine"

root="$(cd "$(dirname "$0")/.." && pwd)"
docs="$root/docs/reverse-proxy.md"
suffix="$$"
network="pagehall-proxy-${suffix}"
subnet="172.30.$((suffix % 200 + 20)).0/24"
postgres="pagehall-proxy-db-${suffix}"
app="pagehall-proxy-app-${suffix}"
proxy="pagehall-proxy-${suffix}"
password="proxy-${suffix}"
work="$(mktemp -d "${TMPDIR:-/tmp}/pagehall-proxy-${suffix}-XXXX")"
if command -v cygpath >/dev/null; then work="$(cygpath -m "$work")"; fi
failures=0

cleanup() {
  docker rm -f "$proxy" "$app" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

block() {
  awk -v name="$1" '
    $0 == "<!-- reverse-proxy-check: " name " -->" { found = 1; next }
    found && /^```/ { if (inside) exit; inside = 1; next }
    inside { print }
  ' "$docs"
}

psql_in() {
  docker exec -i -e PGPASSWORD="$password" "$postgres" psql -v ON_ERROR_STOP=1 -qAt -U pagehall -d pagehall "$@"
}

client() {
  docker run --rm --network "$network" -v "$work:/work:ro" "$curl_image" "$@"
}

fail() {
  echo "  FAILED: $*" >&2
  failures=$((failures + 1))
}

expect_status() {
  local description="$1" expected="$2"
  shift 2
  local status
  status="$(client -sS -k -o /dev/null -w '%{http_code}' --max-time 60 "$@" || true)"
  if [ "$status" = "$expected" ]; then echo "  ok: $description ($status)"; else fail "$description: expected $expected, got $status"; fi
}

echo "Starting PostgreSQL and Pagehall"
docker network create --subnet "$subnet" "$network" >/dev/null
docker run -d --name "$postgres" --network "$network" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=pagehall -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=pagehall \
  "$postgres_image" -c fsync=off >/dev/null
for _ in $(seq 1 60); do
  docker exec "$postgres" pg_isready -h 127.0.0.1 -U pagehall -d pagehall >/dev/null 2>&1 && break
  sleep 1
done
docker run -d --name "$app" --network "$network" --network-alias pagehall \
  -e PAGEHALL_DATABASE_URL="postgres://pagehall:${password}@${postgres}:5432/pagehall" \
  -e PAGEHALL_INSTANCE_URL=https://wiki.example.org -e PAGEHALL_TRUSTED_PROXIES="$subnet" \
  -e PAGEHALL_OWNER_EMAIL=owner@example.org -e PAGEHALL_OWNER_NAME=Owner \
  -e PAGEHALL_OWNER_PASSWORD="proxy owner ${suffix}" -e PAGEHALL_ORGANIZATION_NAME=Proxy \
  "$image" >/dev/null
ready=""
for _ in $(seq 1 120); do
  if client -sf -o /dev/null --max-time 2 http://pagehall:3000/health/ready 2>/dev/null; then ready=1; break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  docker logs --tail 50 "$app" >&2
  echo "Pagehall did not become ready" >&2
  exit 1
fi
psql_in -c "insert into portal_domains (domain, organization_id) select 'help.example.org', id from organizations limit 1"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=wiki.example.org" \
  -addext "subjectAltName=DNS:wiki.example.org,DNS:help.example.org" \
  -keyout "$work/privkey.pem" -out "$work/fullchain.pem" >/dev/null 2>&1
chmod 644 "$work/privkey.pem" "$work/fullchain.pem"
head -c 60000000 /dev/zero > "$work/upload.bin"

start_caddy() {
  block caddy | sed 's/^\temail admin@example.org$/\tlocal_certs/' > "$work/Caddyfile"
  docker run -d --name "$proxy" --network "$network" \
    --network-alias wiki.example.org --network-alias help.example.org --network-alias other.example.org \
    -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy_image" >/dev/null
}

start_nginx() {
  block nginx | sed 's/server 127\.0\.0\.1:3000;/server pagehall:3000;/' > "$work/pagehall.conf"
  docker run -d --name "$proxy" --network "$network" \
    --network-alias wiki.example.org --network-alias help.example.org \
    -v "$work/pagehall.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$work/fullchain.pem:/etc/ssl/pagehall/fullchain.pem:ro" \
    -v "$work/privkey.pem:/etc/ssl/pagehall/privkey.pem:ro" "$nginx_image" >/dev/null
}

start_traefik() {
  block traefik | awk '/^certificatesResolvers:/ { exit } { print }' > "$work/traefik.yml"
  block traefik-dynamic | sed 's/certResolver: letsencrypt/options: default/' > "$work/dynamic.yml"
  docker run -d --name "$proxy" --network "$network" \
    --network-alias wiki.example.org --network-alias help.example.org \
    -v "$work/traefik.yml:/etc/traefik/traefik.yml:ro" \
    -v "$work/dynamic.yml:/etc/traefik/dynamic.yml:ro" "$traefik_image" >/dev/null
}

check_proxy() {
  local name="$1" up=""
  echo "Checking $name"
  "start_$name"
  for _ in $(seq 1 60); do
    if client -sk -o /dev/null --max-time 2 https://wiki.example.org/health/live 2>/dev/null; then up=1; break; fi
    sleep 1
  done
  if [ -z "$up" ]; then
    docker logs --tail 30 "$proxy" >&2
    fail "$name did not start"
    docker rm -f "$proxy" >/dev/null
    return
  fi

  expect_status "page over HTTPS" 200 https://wiki.example.org/
  if client -sk --max-time 10 https://wiki.example.org/ | grep -q '<div id="root"'; then
    echo "  ok: the web client is served"
  else
    fail "the response of / is not the web client"
  fi
  local redirect
  redirect="$(client -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 http://wiki.example.org/settings || true)"
  case "$redirect" in
    30[178]" https://wiki.example.org/settings") echo "  ok: HTTP redirects to HTTPS" ;;
    *) fail "HTTP does not redirect to HTTPS: $redirect" ;;
  esac
  local upgrade
  upgrade="$(client -sk -i --http1.1 --max-time 5 -o - \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Origin: https://wiki.example.org" \
    https://wiki.example.org/collab 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  case "$upgrade" in
    "HTTP/1.1 101"*) echo "  ok: WebSocket upgrade on /collab" ;;
    *) fail "WebSocket upgrade on /collab: $upgrade" ;;
  esac
  local upload
  upload="$(client -sk -o /dev/null -w '%{http_code} %{content_type}' --max-time 120 -X POST \
    -H "Content-Type: application/octet-stream" -H "Origin: https://wiki.example.org" -H "x-pagehall-request: 1" \
    --data-binary @/work/upload.bin \
    "https://wiki.example.org/api/v1/pages/0192f0e0-0000-7000-8000-000000000001/attachments?name=large.bin" || true)"
  case "$upload" in
    "401 application/problem+json"* | "403 application/problem+json"*) echo "  ok: a 60 MB upload reaches Pagehall ($upload)" ;;
    *) fail "a 60 MB upload did not reach Pagehall: $upload" ;;
  esac
  expect_status "the certificate check allows a portal domain" 200 "https://wiki.example.org/tls/ask?domain=help.example.org"
  expect_status "the certificate check refuses other domains" 404 "https://wiki.example.org/tls/ask?domain=other.example.org"
  if client -sk --max-time 10 https://help.example.org/ | grep -q "This help does not exist"; then
    echo "  ok: a portal domain reaches the portal"
  else
    fail "a portal domain does not reach the portal"
  fi
  if [ "$name" = "caddy" ]; then
    if client -sk -o /dev/null --max-time 10 https://other.example.org/ 2>/dev/null; then
      fail "Caddy issued a certificate for a domain that was not allowed"
    else
      echo "  ok: Caddy issues no certificate for a domain that was not allowed"
    fi
  fi
  docker rm -f "$proxy" >/dev/null
}

for name in "${proxies[@]}"; do
  case "$name" in
    caddy | nginx | traefik) check_proxy "$name" ;;
    *) echo "Unknown proxy: $name" >&2; exit 64 ;;
  esac
done

if [ "$failures" -gt 0 ]; then
  echo "$failures checks failed" >&2
  exit 1
fi
echo "All reverse proxy checks passed"
