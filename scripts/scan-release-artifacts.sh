#!/usr/bin/env bash
# Scan packaged release artifacts (zip/mcpb) for secrets before they are published.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

target="${1:-dist}"
test -d "$target" || {
  echo "missing artifact directory: $target" >&2
  exit 1
}

if ! command -v gitleaks >/dev/null; then
  echo "gitleaks is required. Install https://github.com/gitleaks/gitleaks/releases" >&2
  exit 1
fi

# Nested archives (Claude/ChatGPT zips and mcpb) are the published surface.
gitleaks dir "$target" \
  --redact \
  --verbose \
  --max-archive-depth 3 \
  --exit-code 1
