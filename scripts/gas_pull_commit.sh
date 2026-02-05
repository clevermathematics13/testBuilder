#!/usr/bin/env bash
set -euo pipefail

# Run from repo root
cd "$(dirname "$0")/.."

# Guardrails
if [[ ! -f ".clasp.json" ]]; then
  echo "❌ .clasp.json not found in repo root."
  exit 1
fi

if ! command -v clasp >/dev/null 2>&1; then
  echo "❌ clasp not found."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "❌ git not found."
  exit 1
fi

echo "➡️  clasp pull"
clasp pull

echo ""
echo "➡️  git status"
git status --porcelain

# Stage ONLY GAS source files using git pathspec globs (NOT shell globs).
# This safely handles filenames with spaces.
git add -A -- \
  "appsscript.json" \
  "*.js" \
  "*.gs" \
  "*.html" \
  2>/dev/null || true

# Safety: make sure we never auto-stage tooling folders
git restore --staged -- .vscode scripts 2>/dev/null || true

# If nothing staged, don't commit
if git diff --cached --quiet; then
  echo "✅ No GAS source changes to commit."
  exit 0
fi

MSG="sync: pull $(date +"%Y-%m-%d %H:%M:%S")"
git commit -m "$MSG"
echo "✅ Committed: $MSG"

