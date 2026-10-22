#!/usr/bin/env bash
set -euo pipefail

target="${1:?usage: scripts/install-postgres-client.sh <directory> [<major version>]}"
major="${2:-16}"
bin="$target/bin"

if command -v pg_dump >/dev/null; then
  dirname "$(command -v pg_dump)"
  exit 0
fi

apt_root="$target/apt"
mkdir -p "$apt_root/lists/partial" "$apt_root/cache/archives/partial" "$apt_root/packages" "$apt_root/parts" "$bin"
cat >"$apt_root/apt.conf" <<EOF
Dir::Etc::Parts "$apt_root/parts";
Dir::State::Lists "$apt_root/lists";
Dir::Cache "$apt_root/cache";
Debug::NoLocking "true";
APT::Sandbox::User "$(id -un 2>/dev/null || id -u)";
EOF
export APT_CONFIG="$apt_root/apt.conf"

apt-get -qq update >&2
(cd "$apt_root/packages" && apt-get -qq download "postgresql-client-$major" libpq5 >&2)
for package in "$apt_root/packages"/*.deb; do dpkg-deb -x "$package" "$target/root"; done

libraries="$(dirname "$(find "$target/root" -name 'libpq.so.5' -print -quit)")"
for tool in pg_dump pg_restore psql; do
  cat >"$bin/$tool" <<EOF
#!/bin/sh
LD_LIBRARY_PATH="$libraries\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}" exec "$target/root/usr/lib/postgresql/$major/bin/$tool" "\$@"
EOF
  chmod +x "$bin/$tool"
done
"$bin/pg_dump" --version >&2
echo "$bin"
