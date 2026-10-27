#!/usr/bin/env bash
set -euo pipefail

IMAGE_REPOSITORY="ghcr.io/lunedo/lunedo"
POSTGRES_IMAGE="postgres:17-alpine"
RECORD=".lunedo-install"
MIN_FREE_KB=$((4 * 1024 * 1024))
READY_TIMEOUT_SECONDS="${LUNEDO_READY_TIMEOUT:-600}"
CODE_ALPHABET="ABCDEFGHJKMNPQRSTVWXYZ23456789"

assume_yes=0
directory=""
instance_url=""
version=""
image=""
port=""
bind=""
subnet=""
proxy=""
proxy_given=0
pull=1

usage() {
  cat <<'USAGE'
Usage:
  install.sh [install] [options]       Install Lunedo with Docker Compose
  lunedo update [version] [options]  Update this installation, with a backup first
  lunedo maintenance on|off|status   Switch maintenance mode, see lunedo maintenance --help
  lunedo backup ...                  Run a backup command in the container
  lunedo version                     Show the installed version

Options:
  --dir <directory>     Installation directory (default /opt/lunedo, on macOS ~/lunedo)
  --url <address>       Address people open, for example https://wiki.example.org
  --version <version>   Version to install or update to (default: the newest release)
  --image <reference>   Image to use instead of ghcr.io/lunedo/lunedo:<version>
  --port <port>         Host port of Lunedo (default 3000)
  --bind <address>      Host address the port listens on (default 127.0.0.1)
  --subnet <cidr>       Subnet of the Compose network (default 172.30.0.0/24)
  --proxy <address>     Fixed address of a reverse proxy on the Compose network, the only address
                        Lunedo trusts for forwarded headers (default: none)
  --no-pull             Use a local image without pulling it
  --yes                 Answer every question with its default, for unattended runs
  --help                Show this help
USAGE
}

say() { printf '%s\n' "$*"; }
fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

interactive() { [ "$assume_yes" -eq 0 ] && [ -r /dev/tty ] && [ -t 1 ]; }

ask() {
  local question="$1" default="$2" answer=""
  if interactive; then
    read -r -p "$question [$default]: " answer </dev/tty || true
  fi
  printf '%s' "${answer:-$default}"
}

confirm() {
  local question="$1" answer=""
  [ "$assume_yes" -eq 1 ] && return 0
  interactive || fail "$question Run again with --yes to confirm without a terminal."
  read -r -p "$question [y/N]: " answer </dev/tty || true
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

is_release() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

version_lt() {
  local IFS=.
  local -a left right
  read -r -a left <<<"$1"
  read -r -a right <<<"$2"
  local index
  for index in 0 1 2; do
    if ((10#${left[index]} < 10#${right[index]})); then return 0; fi
    if ((10#${left[index]} > 10#${right[index]})); then return 1; fi
  done
  return 1
}

directory_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || true; }

check_directory_mode() {
  local mode
  mode="$(directory_mode "$1")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 0
  if (((8#$mode & 8#022) != 0)); then
    fail "$1 has mode $mode, so other accounts on this host can create or replace files in it, such as compose.yml. Restrict it, for example with: chmod 700 '$1', and run the command again."
  fi
  if (((8#$mode & 8#027) != 0)); then
    say "Warning: $1 has mode $mode, so other accounts on this host can reach the backups and the" >&2
    say "         configuration in it. Restrict it, for example with: chmod 700 '$1'" >&2
  fi
}

valid_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  local part
  for part in "${BASH_REMATCH[@]:1}"; do ((10#$part <= 255)) || return 1; done
}

gateway_of() {
  local base="${1%/*}"
  printf '%s.%s' "${base%.*}" "$((${base##*.} + 1))"
}

random_key() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }

random_text() {
  local length="$1" alphabet="$2" raw=""
  while [ "${#raw}" -lt "$length" ]; do
    raw="$raw$(head -c 256 /dev/urandom | LC_ALL=C tr -dc "$alphabet")"
  done
  printf '%s' "${raw:0:length}"
}

setup_code() {
  local raw
  raw="$(random_text 16 "$CODE_ALPHABET")"
  printf '%s-%s-%s-%s' "${raw:0:4}" "${raw:4:4}" "${raw:8:4}" "${raw:12:4}"
}

default_directory() {
  if [ "$(uname -s)" = "Darwin" ]; then printf '%s/lunedo' "$HOME"; else printf '/opt/lunedo'; fi
}

script_directory() {
  local found
  found="$(cd "$(dirname "$0")" && pwd)"
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$found"; else printf '%s' "$found"; fi
}

compose() { docker compose --project-directory "$directory" -f "$directory/compose.yml" "$@"; }

record_value() {
  local key="$1"
  [ -f "$directory/$RECORD" ] || return 0
  sed -n "s/^$key=//p" "$directory/$RECORD" | head -n 1
}

write_record() {
  local installed_version="$1" previous="${2:-}" installed
  installed="$(record_value installed)"
  {
    printf 'method=script\n'
    printf 'version=%s\n' "$installed_version"
    printf 'image=%s\n' "$(current_image)"
    printf 'installed=%s\n' "${installed:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    printf 'updated=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [ -n "$previous" ]; then printf 'previous=%s\n' "$previous"; fi
  } >"$directory/$RECORD.tmp"
  mv "$directory/$RECORD.tmp" "$directory/$RECORD"
}

image_version() {
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$1" 2>/dev/null || true
}

current_image() { sed -n 's/^    image: \(.*lunedo.*\)$/\1/p' "$directory/compose.yml" | head -n 1; }

compose_file() {
  local reference="$1"
  cat <<COMPOSE
name: lunedo

services:
  postgres:
    image: $POSTGRES_IMAGE
    restart: unless-stopped
    environment:
      POSTGRES_USER: lunedo
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: lunedo
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lunedo -d lunedo"]
      interval: 5s
      timeout: 5s
      retries: 30

  lunedo:
    image: $reference
    restart: unless-stopped
    init: true
    stop_grace_period: 45s
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      LUNEDO_DATABASE_URL: postgres://lunedo:\${POSTGRES_PASSWORD}@postgres:5432/lunedo
      LUNEDO_INSTANCE_URL: \${LUNEDO_INSTANCE_URL:-}
      LUNEDO_SETUP_CODE: \${LUNEDO_SETUP_CODE:-}
      LUNEDO_MASTER_KEYS: \${LUNEDO_MASTER_KEYS:-}
      LUNEDO_BACKUP_KEY: \${LUNEDO_BACKUP_KEY:-}
      LUNEDO_METRICS_TOKEN: \${LUNEDO_METRICS_TOKEN:-}
      LUNEDO_TRUSTED_PROXIES: \${LUNEDO_TRUSTED_PROXIES:-}
      LUNEDO_UPDATE_CHECK: \${LUNEDO_UPDATE_CHECK:-true}
      LUNEDO_INSTALL_METHOD: \${LUNEDO_INSTALL_METHOD:-compose}
      LUNEDO_INSTALL_DIR: \${LUNEDO_INSTALL_DIR:-}
    ports:
      - "\${LUNEDO_BIND:-127.0.0.1}:\${LUNEDO_PORT:-3000}:3000"
    volumes:
      - lunedo-data:/var/lib/lunedo
      - ./backups:/var/lib/lunedo/backups
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 10s
      timeout: 5s
      start_period: 300s
      retries: 6

volumes:
  postgres-data:
  lunedo-data:

networks:
  default:
    ipam:
      config:
        - subnet: \${LUNEDO_SUBNET:-172.30.0.0/24}
COMPOSE
}

check_requirements() {
  local problems=() parent free
  if ! command -v docker >/dev/null 2>&1; then
    problems+=("Docker is not installed. Install Docker Engine 24 or newer: https://docs.docker.com/engine/install/")
  elif ! docker info >/dev/null 2>&1; then
    problems+=("Docker is installed, but it is not running or this user may not use it. Start Docker, or run the script as root or as a member of the docker group.")
  elif ! docker compose version >/dev/null 2>&1; then
    problems+=("Docker Compose v2 is missing. Install the Compose plugin: https://docs.docker.com/compose/install/")
  fi
  parent="$directory"
  while [ ! -d "$parent" ]; do parent="$(dirname "$parent")"; done
  free="$(df -Pk "$parent" | awk 'NR == 2 { print $4 }')"
  if [ -n "$free" ] && [ "$free" -lt "$MIN_FREE_KB" ]; then
    problems+=("Only $((free / 1024 / 1024)) GB are free in $parent. Lunedo needs at least 4 GB for its images and first data; free space or choose another directory with --dir.")
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    problems+=("Port $port is already in use on this host. Stop the program that uses it, or choose another port with --port.")
  fi
  if [ "${#problems[@]}" -gt 0 ]; then
    say "Lunedo cannot be installed yet:" >&2
    local problem
    for problem in "${problems[@]}"; do say "  - $problem" >&2; done
    exit 1
  fi
}

valid_url() { [[ "$1" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; }

wait_ready() {
  if compose up -d --wait --wait-timeout "$READY_TIMEOUT_SECONDS"; then return 0; fi
  return 1
}

install_lunedo() {
  directory="${directory:-$(ask "Installation directory" "$(default_directory)")}"
  directory="${directory%/}"
  port="${port:-3000}"
  bind="${bind:-127.0.0.1}"
  subnet="${subnet:-172.30.0.0/24}"
  local existed=0
  if [ -d "$directory" ]; then
    existed=1
    check_directory_mode "$directory"
  fi

  if [ -f "$directory/$RECORD" ] || [ -f "$directory/compose.yml" ] || [ -f "$directory/.env" ]; then
    say "Lunedo is already installed in $directory (version $(record_value version))."
    say "Nothing was changed. Secrets and data stay as they are. To update it, run $directory/lunedo update."
    if interactive && confirm "Update this installation instead?"; then
      local arguments=(update --dir "$directory")
      if [ -n "$version" ]; then arguments+=("$version"); fi
      if [ -n "$image" ]; then arguments+=(--image "$image"); fi
      if [ "$pull" -eq 0 ]; then arguments+=(--no-pull); fi
      if [ "$assume_yes" -eq 1 ]; then arguments+=(--yes); fi
      exec "$directory/lunedo" "${arguments[@]}"
    fi
    exit 0
  fi

  [ -f "$0" ] || fail "Download the script first and run it from the file, for example: curl -fsSLO https://github.com/lunedo/lunedo/releases/latest/download/install.sh && bash install.sh"
  check_requirements

  instance_url="${instance_url:-$(ask "Address people open, for example https://wiki.example.org" "http://localhost:$port")}"
  instance_url="${instance_url%/}"
  valid_url "$instance_url" || fail "$instance_url is not an address like https://wiki.example.org: use http:// or https:// and no path."
  case "$instance_url" in
    https://* | http://localhost* | http://127.0.0.1*) ;;
    *) say "Warning: $instance_url does not use HTTPS. Signing in needs HTTPS; put Lunedo behind a reverse proxy with TLS." ;;
  esac

  if [ "$proxy_given" -eq 0 ]; then
    proxy="$(ask "Fixed address of a reverse proxy in this Compose project, trusted for forwarded headers (empty: none)" "")"
  fi
  if [ -n "$proxy" ]; then
    valid_ipv4 "$proxy" || fail "$proxy is not an IPv4 address like 172.30.0.10."
    [ "$proxy" != "$(gateway_of "$subnet")" ] ||
      fail "$proxy is the gateway of the Compose network. Every program on this host connects from it, so it must not be trusted. Give the proxy a fixed address of its own on the network."
  fi

  local reference target
  if [ -n "$image" ]; then
    reference="$image"
  else
    target="${version:-latest}"
    reference="$IMAGE_REPOSITORY:$target"
  fi

  if [ "$existed" -eq 0 ]; then
    mkdir -p "$(dirname "$directory")"
    mkdir -m 700 "$directory"
  fi
  mkdir -p "$directory/backups"

  local code
  code="$(setup_code)"
  (
    umask 077
    {
      printf 'POSTGRES_PASSWORD=%s\n' "$(random_text 40 'A-Za-z0-9')"
      printf 'LUNEDO_INSTANCE_URL=%s\n' "$instance_url"
      printf 'LUNEDO_SETUP_CODE=%s\n' "$code"
      printf 'LUNEDO_MASTER_KEYS=1:%s\n' "$(random_key)"
      printf 'LUNEDO_BACKUP_KEY=1:%s\n' "$(random_key)"
      printf 'LUNEDO_METRICS_TOKEN=%s\n' "$(random_text 43 'A-Za-z0-9')"
      printf 'LUNEDO_TRUSTED_PROXIES=%s\n' "${proxy:+$proxy/32}"
      printf 'LUNEDO_SUBNET=%s\n' "$subnet"
      printf 'LUNEDO_PORT=%s\n' "$port"
      printf 'LUNEDO_BIND=%s\n' "$bind"
      printf 'LUNEDO_INSTALL_METHOD=script\n'
      printf 'LUNEDO_INSTALL_DIR=%s\n' "$directory"
    } >"$directory/.env"
  )
  write_compose "$reference"
  cp "$0" "$directory/lunedo"
  chmod 755 "$directory/lunedo"

  say ""
  say "Open this link to set up Lunedo once it has started:"
  say ""
  say "  $instance_url/setup#code=$code"
  say ""
  say "The link works once. Lunedo is being downloaded and started now."
  say ""

  if [ "$pull" -eq 1 ]; then compose pull --quiet; fi
  docker run --rm --user 0 --entrypoint sh -v "$directory/backups:/backups" "$reference"     -c 'chown 1000:1000 /backups && chmod 750 /backups' ||
    fail "The backups directory $directory/backups could not be given to the user of the container."
  if [ -z "$image" ] && [ -z "$version" ]; then
    local resolved
    resolved="$(image_version "$reference")"
    if is_release "$resolved"; then
      reference="$IMAGE_REPOSITORY:$resolved"
      docker image tag "$IMAGE_REPOSITORY:latest" "$reference"
      write_compose "$reference"
    fi
  fi

  if ! wait_ready; then
    say "Lunedo did not become ready within $READY_TIMEOUT_SECONDS seconds. The last log lines:" >&2
    compose logs --tail 60 lunedo >&2 || true
    fail "Check the log above, fix the cause and run 'cd $directory && docker compose up -d'."
  fi
  write_record "$(image_version "$(current_image)")"

  say ""
  say "Lunedo $(record_value version) runs in $directory."
  say ""
  say "Next steps:"
  say "  1. Set up the instance: $instance_url/setup#code=$code"
  if [ -n "$proxy" ]; then
    say "  2. Run your reverse proxy with TLS at $proxy on the Compose network; only that address is"
    say "     trusted for forwarded headers:"
  else
    say "  2. Put a reverse proxy with TLS in front of $bind:$port. No proxy is trusted yet, so Lunedo"
    say "     ignores forwarded headers and sees every client as the proxy. Give a proxy in this Compose"
    say "     project a fixed address and set LUNEDO_TRUSTED_PROXIES in .env to it, never to the"
    say "     whole subnet or its gateway:"
  fi
  say "     https://github.com/lunedo/lunedo/blob/main/docs/admin/reverse-proxy.md"
  say "  3. Copy $directory/.env to a safe place. It holds the master key and the backup key;"
  say "     a backup cannot be restored without them."
  say "  4. Update later with: $directory/lunedo update"
}

update_lunedo() {
  directory="${directory:-$(script_directory)}"
  [ -f "$directory/compose.yml" ] && [ -f "$directory/.env" ] ||
    fail "$directory is not a Lunedo installation. Run the update from the installation directory, or pass --dir."
  [ "$(record_value method)" = "script" ] ||
    fail "$directory was not installed with the setup script. Update it as described in docs/admin/updates.md."
  check_directory_mode "$directory"
  check_requirements_for_update

  local current_reference current target_reference target
  current_reference="$(current_image)"
  current="$(record_value version)"
  if [ -n "$image" ]; then
    target_reference="$image"
  else
    target_reference="$IMAGE_REPOSITORY:${version:-latest}"
  fi

  say "Downloading $target_reference"
  if [ "$pull" -eq 1 ]; then docker pull --quiet "$target_reference" >/dev/null; fi
  target="$(image_version "$target_reference")"
  [ -n "$target" ] || fail "The image $target_reference has no version label; it is not a Lunedo image."
  if [ -z "$image" ] && is_release "$target"; then
    if [ "$target_reference" != "$IMAGE_REPOSITORY:$target" ]; then
      docker image tag "$target_reference" "$IMAGE_REPOSITORY:$target"
      target_reference="$IMAGE_REPOSITORY:$target"
    fi
  fi
  if [ "$target_reference" = "$current_reference" ] && [ "$target" = "$current" ]; then
    say "Lunedo $current is already installed. Nothing to do."
    return 0
  fi
  if is_release "$current" && is_release "$target" && ! version_lt "$current" "$target"; then
    fail "Lunedo $current is installed; $target is not newer. Downgrades are done by restoring a backup, see docs/admin/restore.md."
  fi

  say ""
  say "Update from Lunedo $current to $target"
  if is_release "$current" && is_release "$target"; then
    say ""
    if ! docker run --rm "$target_reference" release-notes --update-from "$current"; then
      fail "This update cannot be made in one step. Nothing was changed."
    fi
  else
    say "Release notes are only available between released versions."
  fi
  say ""
  confirm "Back up and update now?" || {
    say "Nothing was changed."
    exit 0
  }

  local location
  say "Creating the backup before the update"
  compose up -d --wait --wait-timeout "$READY_TIMEOUT_SECONDS" >/dev/null 2>&1 || true
  if ! location="$(compose exec -T lunedo lunedo backup create --before-update)" || [ -z "$location" ]; then
    fail "The backup before the update failed, so Lunedo was not updated. Fix the cause shown above and run the update again."
  fi
  location="$(printf '%s' "$location" | tail -n 1 | tr -d '\r')"
  say "The backup is $(host_location "$location")"

  say "Starting Lunedo $target"
  replace_image "$target_reference"
  if ! compose run --rm --no-deps -T lunedo backup skip-before-update --for-version "$target" >/dev/null 2>&1; then
    say "Lunedo $target could not record that the backup before the update is done; its first start takes a second one."
  fi
  if ! wait_ready; then
    say "" >&2
    say "Lunedo $target did not become ready. The last log lines:" >&2
    compose logs --tail 80 lunedo >&2 || true
    cat >&2 <<ROLLBACK

The update stopped. Nothing was restored automatically. To go back to Lunedo $current:

  cd $directory
  docker compose stop lunedo
  sed -i.bak 's#image: $target_reference#image: $current_reference#' compose.yml
  docker compose run --rm lunedo backup restore --input $(restore_input "$location") --force
  docker compose up -d

The backup is $(host_location "$location").$(s3_note "$location") See docs/admin/updates.md#rollback.
ROLLBACK
    exit 1
  fi
  write_record "$target" "$current"
  if docker run --rm --entrypoint cat "$target_reference" /app/install.sh >"$directory/lunedo.new" 2>/dev/null; then
    chmod 755 "$directory/lunedo.new"
    mv "$directory/lunedo.new" "$directory/lunedo"
  else
    rm -f "$directory/lunedo.new"
  fi
  say ""
  say "Lunedo runs version $target. The backup from before the update is $(host_location "$location")."
}

host_location() {
  case "$1" in
    /var/lib/lunedo/backups/*) printf '%s/backups/%s' "$directory" "${1#/var/lib/lunedo/backups/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

restore_input() {
  case "$1" in
    s3://*) printf '/var/lib/lunedo/backups/%s' "${1##*/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

s3_note() {
  case "$1" in
    s3://*) printf ' Download it to %s/backups/%s first.' "$directory" "${1##*/}" ;;
  esac
}

check_requirements_for_update() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
  docker info >/dev/null 2>&1 || fail "Docker is not running, or this user may not use it."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing."
}

write_compose() {
  (
    umask 077
    compose_file "$1" >"$directory/compose.yml.tmp"
  )
  chmod 600 "$directory/compose.yml.tmp"
  mv "$directory/compose.yml.tmp" "$directory/compose.yml"
}

replace_image() {
  local reference="$1"
  (
    umask 077
    awk -v reference="$reference" '
      !done && /^    image: / && $0 ~ /lunedo/ { print "    image: " reference; done = 1; next }
      { print }
    ' "$directory/compose.yml" >"$directory/compose.yml.tmp"
  )
  chmod 600 "$directory/compose.yml.tmp"
  mv "$directory/compose.yml.tmp" "$directory/compose.yml"
}

in_container() {
  directory="${directory:-$(script_directory)}"
  [ -f "$directory/compose.yml" ] || fail "$directory is not a Lunedo installation."
  compose exec -T lunedo lunedo "$@"
}

command="install"
if [ "$#" -gt 0 ]; then
  case "$1" in
    install | update | maintenance | backup | version | print-compose | help) command="$1"; shift ;;
    --help | -h) command="help"; shift ;;
  esac
fi

if [ "$command" = "maintenance" ] || [ "$command" = "backup" ]; then
  in_container "$command" "$@"
  exit $?
fi

positional=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) directory="${2:?--dir needs a directory}"; shift 2 ;;
    --url) instance_url="${2:?--url needs an address}"; shift 2 ;;
    --version) version="${2:?--version needs a version}"; shift 2 ;;
    --image) image="${2:?--image needs an image reference}"; shift 2 ;;
    --port) port="${2:?--port needs a port}"; shift 2 ;;
    --bind) bind="${2:?--bind needs an address}"; shift 2 ;;
    --subnet) subnet="${2:?--subnet needs a CIDR range}"; shift 2 ;;
    --proxy) proxy="${2?--proxy needs an address}"; proxy_given=1; shift 2 ;;
    --no-pull) pull=0; shift ;;
    --yes | -y) assume_yes=1; shift ;;
    --help | -h) command="help"; shift ;;
    -*) usage >&2; fail "Unknown option $1" ;;
    *)
      [ -z "$positional" ] || fail "Unexpected argument $1"
      positional="$1"
      shift
      ;;
  esac
done

if [ -n "$positional" ]; then
  [ "$command" = "update" ] || fail "Unexpected argument $positional"
  version="$positional"
fi
if [ -n "$version" ] && ! is_release "$version" && [ "$version" != "latest" ]; then
  fail "$version is not a version like 1.4.2."
fi
if [ -n "$port" ] && ! [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]]; then
  fail "$port is not a port number."
fi

case "$command" in
  help) usage ;;
  print-compose) compose_file "$IMAGE_REPOSITORY:${version:-<version>}" ;;
  version)
    directory="${directory:-$(script_directory)}"
    say "$(record_value version)"
    ;;
  install) install_lunedo ;;
  update) update_lunedo ;;
esac
