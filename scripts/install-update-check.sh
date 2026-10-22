#!/usr/bin/env bash
set -euo pipefail
export MSYS_NO_PATHCONV=1

previous="${1:?usage: scripts/install-update-check.sh <previous image> <image under test>}"
current="${2:?usage: scripts/install-update-check.sh <previous image> <image under test>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
suffix="$$"
parent="$(mktemp -d "${TMPDIR:-/tmp}/pagehall-install-${suffix}-XXXX")"
if command -v cygpath >/dev/null; then parent="$(cygpath -m "$parent")"; fi
directory="$parent/installation"
port=$((20000 + suffix % 20000))
subnet="172.31.$((suffix % 200 + 20)).0/24"
proxy="172.31.$((suffix % 200 + 20)).10"
linux=1
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN* | Darwin) linux=0 ;; esac

compose() { docker compose --project-directory "$directory" -f "$directory/compose.yml" "$@"; }

newest_backup() {
  docker run --rm --user 0 --entrypoint sh -v "$directory/backups:/backups:ro" "$current"     -c 'ls -t /backups/pagehall-backup-*-before-update-*.phbak 2>/dev/null | head -n 1' | tr -d '
'
}

cleanup() {
  if [ -f "$directory/compose.yml" ]; then compose down --volumes --remove-orphans >/dev/null 2>&1 || true; fi
  if [ -d "$directory/backups" ]; then
    docker run --rm --user 0 --entrypoint rm -v "$directory:/installation" "$current" -rf /installation/backups       >/dev/null 2>&1 || true
  fi
  rm -rf "$parent"
}
trap cleanup EXIT

mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

other_account_cannot_list() {
  if ! sudo -n true 2>/dev/null; then
    echo "  skipped: no sudo to try another account"
    return 0
  fi
  ! sudo -n -u nobody ls "$directory/backups" >/dev/null 2>&1
}

check() {
  local description="$1"
  shift
  if "$@"; then
    echo "  ok: $description"
  else
    echo "  FAILED: $description" >&2
    exit 1
  fi
}

in_pagehall() { compose exec -T -w /app/api pagehall "$@"; }

psql_in() { compose exec -T postgres psql -v ON_ERROR_STOP=1 -qAt -U pagehall -d pagehall -c "$1"; }

echo "Installing $previous with the setup script"
bash "$root/scripts/install.sh" install --dir "$directory" --url "http://localhost:$port" --image "$previous" \
  --port "$port" --subnet "$subnet" --proxy "$proxy" --no-pull --yes
check "the installation is recorded" grep -q '^method=script$' "$directory/.pagehall-install"
check "only the proxy address is trusted for forwarded headers" \
  grep -qx "PAGEHALL_TRUSTED_PROXIES=$proxy/32" "$directory/.env"
if [ "$linux" -eq 1 ]; then
  check "the installation directory is reachable by its owner only" test "$(mode_of "$directory")" = "700"
  check "the environment file is readable by the owner only" test "$(mode_of "$directory/.env")" = "600"
  check "the Compose file is readable by the owner only" test "$(mode_of "$directory/compose.yml")" = "600"
  check "another account cannot list the backups" other_account_cannot_list
else
  echo "  skipped: file permissions are only checked on Linux"
fi
check "the setup code is in the environment file" grep -Eq '^PAGEHALL_SETUP_CODE=[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$' "$directory/.env"

echo "Adding synthetic content"
in_pagehall node --input-type=module -e '
  import { accountPrincipal, createServerRuntime, SYSTEM } from "@pagehall/server";
  const runtime = await createServerRuntime({ role: "api", env: { ...process.env, PAGEHALL_LOG_LEVEL: "warn" } });
  try {
    const { services } = runtime;
    const owner = await runtime.database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email: "update-check@example.org",
        name: "Update Check",
        password: "a long passphrase for the update check",
        homeOrganizationId: null,
      }),
    );
    const organization = await services.organizations.createAsActor(SYSTEM, {
      name: "Update check",
      ownerAccountId: owner.id,
    });
    const space = await services.spaces.create(
      accountPrincipal(owner.id),
      organization.id,
      { name: "Survives updates", key: "SURVIVE", visibility: "private", grants: [] },
      services.spacePermissions.holders,
    );
    await services.tree.create(accountPrincipal(owner.id), space.id, {
      kind: "page",
      title: "Written before the update",
      mode: "live",
      placement: { parentId: null },
    });
  } finally {
    await runtime.close();
  }
'
check "the page exists before the update" \
  test "$(psql_in "select count(*) from tree_items where title = 'Written before the update'")" = "1"
before_migrations="$(psql_in "select count(*) from drizzle.__drizzle_migrations")"

echo "Updating to $current with one command"
"$directory/pagehall" update --image "$current" --no-pull --yes

check "the instance runs the image under test" grep -q "^    image: $current\$" "$directory/compose.yml"
if [ "$linux" -eq 1 ]; then
  check "the Compose file stays readable by the owner only" test "$(mode_of "$directory/compose.yml")" = "600"
fi
check "the update is recorded with the previous version" grep -q '^previous=' "$directory/.pagehall-install"
backup_file="$(newest_backup)"
check "a backup was taken before the update" test -n "$backup_file"
before_update_backups="$(docker run --rm --user 0 --entrypoint sh -v "$directory/backups:/backups:ro" "$current"   -c 'ls /backups/pagehall-backup-*-before-update-*.phbak 2>/dev/null | wc -l' | tr -d ' ')"
check "the first start of the new version took no second backup" test "$before_update_backups" = "1"
check "the backup is complete and readable" \
  compose exec -T pagehall pagehall backup verify --input "/var/lib/pagehall/backups/$(basename "$backup_file")"
check "the page is still there" \
  test "$(psql_in "select count(*) from tree_items where title = 'Written before the update'")" = "1"
check "the space is still there" test "$(psql_in "select count(*) from spaces where key = 'SURVIVE'")" = "1"
check "the migrations of the new version ran" \
  test "$(psql_in "select count(*) from drizzle.__drizzle_migrations")" -gt "$before_migrations"
check "the instance is ready" compose exec -T pagehall node -e \
  "fetch('http://127.0.0.1:3000/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
check "the update command was replaced by the one of the new image" cmp -s "$directory/pagehall" "$root/scripts/install.sh"

echo "Running the setup script again leaves the installation alone"
secrets="$(cat "$directory/.env")"
if [ "$linux" -eq 1 ]; then chmod 755 "$directory"; fi
rerun="$(bash "$root/scripts/install.sh" install --dir "$directory" --yes </dev/null 2>&1 >/dev/null)"
check "the secrets are unchanged" test "$secrets" = "$(cat "$directory/.env")"
if [ "$linux" -eq 1 ]; then
  check "it warns about a directory other accounts can reach" grep -q "has mode 755" <<<"$rerun"
  check "it does not change the mode of the directory" test "$(mode_of "$directory")" = "755"
  chmod 775 "$directory"
  set +e
  refused="$(bash "$root/scripts/install.sh" install --dir "$directory" --yes </dev/null 2>&1 >/dev/null)"
  refused_status=$?
  set -e
  check "it refuses a directory other accounts can write to" test "$refused_status" -ne 0
  check "it says how to restrict the directory" grep -q "chmod 700" <<<"$refused"
  check "it still does not change the mode" test "$(mode_of "$directory")" = "775"
  chmod 700 "$directory"
fi

echo "An update to a version that does not start stops with the rollback and restores nothing"
broken="pagehall:broken-${suffix}"
printf 'FROM %s\nLABEL org.opencontainers.image.version=broken\nENTRYPOINT ["sh", "-c", "echo Starting a broken build >&2; exit 1"]\n' "$current" |
  docker build --quiet --tag "$broken" - >/dev/null
trap 'docker image rm --force "$broken" >/dev/null 2>&1 || true; cleanup' EXIT
recorded="$(cat "$directory/.pagehall-install")"
set +e
output="$(PAGEHALL_READY_TIMEOUT=60 "$directory/pagehall" update --image "$broken" --no-pull --yes 2>&1)"
status=$?
set -e
check "the update fails" test "$status" -ne 0
check "it prints the logs of the new version" grep -q "Starting a broken build" <<<"$output"
check "it prints the rollback" grep -q "Nothing was restored automatically" <<<"$output"
check "the installation record is unchanged" test "$recorded" = "$(cat "$directory/.pagehall-install")"
check "the page is untouched" \
  test "$(psql_in "select count(*) from tree_items where title = 'Written before the update'")" = "1"

echo "Following the documented rollback"
rollback_backup="$(newest_backup)"
compose stop pagehall >/dev/null
sed -i.bak "s#^    image: $broken\$#    image: $current#" "$directory/compose.yml"
compose run --rm -T pagehall backup restore --input "/var/lib/pagehall/backups/$(basename "$rollback_backup")" --force
compose up -d --wait --wait-timeout 300 >/dev/null
check "the instance runs again after the rollback" compose exec -T pagehall node -e \
  "fetch('http://127.0.0.1:3000/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
check "the content is back" \
  test "$(psql_in "select count(*) from tree_items where title = 'Written before the update'")" = "1"

echo "Install and update checks passed"
