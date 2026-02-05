#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f ".clasp.json" ]]; then
  echo "❌ .clasp.json not found in repo root."
  exit 1
fi

echo "➡️  clasp pull"
clasp pull

echo ""
echo "➡️  git status"
git status --porcelain

# Stage ONLY GAS source files (git pathspec globs; safe with spaces)
git add -A -- "appsscript.json" "*.js" "*.gs" "*.html" 2>/dev/null || true

# Never auto-stage tooling folders
git restore --staged -- .vscode scripts 2>/dev/null || true

if git diff --cached --quiet; then
  echo "✅ No GAS source changes to commit."
  exit 0
fi

MSG="sync: pull $(date +"%Y-%m-%d %H:%M:%S")"
git commit -m "$MSG"
echo "✅ Committed: $MSG"
