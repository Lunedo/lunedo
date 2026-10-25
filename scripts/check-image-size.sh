#!/usr/bin/env bash
# Fails when the files in the runtime image grow beyond the budget.
# Measures the files inside the image, so the result does not depend on the storage driver.
# Usage: scripts/check-image-size.sh <image>
set -euo pipefail
export MSYS_NO_PATHCONV=1

budget_mb=600

image="${1:?Usage: scripts/check-image-size.sh <image>}"
bytes="$(docker run --rm --user root --entrypoint du "$image" -sxb --apparent-size / | cut -f1)"
size_mb=$((bytes / 1000000))
if [ "$size_mb" -gt "$budget_mb" ]; then
  echo "The image $image holds $size_mb MB of files, more than its budget of $budget_mb MB." >&2
  echo "Find what grew with: docker run --rm --entrypoint du $image -xm --max-depth=3 /app | sort -rn | head" >&2
  exit 1
fi
echo "The image $image holds $size_mb MB of files (budget $budget_mb MB)."
