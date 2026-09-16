#!/usr/bin/env bash
# Build the portable ChatGPT/Codex plugin source bundle.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

plugin_dir="plugins/athena"
version="$(node -p "require('./$plugin_dir/.codex-plugin/plugin.json').version")"
out="dist/athena-chatgpt-v${version}.zip"

mkdir -p dist
rm -f "$out"

package_stage_dir="$(mktemp -d)"
package_check_dir="$(mktemp -d)"
trap 'rm -rf "$package_stage_dir" "$package_check_dir"' EXIT
cp -R "$plugin_dir" "$package_stage_dir/athena"
cp LICENSE SECURITY.md "$package_stage_dir/athena/"
(cd "$package_stage_dir" && zip -q -r "$repo_root/$out" athena -x '*.DS_Store' '*/.git/*' '*/node_modules/*')
unzip -q "$out" -d "$package_check_dir"
for required in \
  "$package_check_dir/athena/.codex-plugin/plugin.json" \
  "$package_check_dir/athena/.app.json" \
  "$package_check_dir/athena/.mcp.json" \
  "$package_check_dir/athena/LICENSE" \
  "$package_check_dir/athena/SECURITY.md" \
  "$package_check_dir/athena/scripts/validate-data-block.mjs" \
  "$package_check_dir/athena/skills/help/SKILL.md"; do
  test -f "$required"
done
node "$package_check_dir/athena/scripts/validate-data-block.mjs" --selftest >/dev/null

echo "Wrote $out"
echo "ChatGPT/Codex source-bundle verification OK"
