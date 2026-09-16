#!/usr/bin/env bash
# Build every currently supported production distribution artifact.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

./scripts/package-claude.sh
./scripts/package-chatgpt.sh
