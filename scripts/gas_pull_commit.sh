#!/usr/bin/env bash
set -euo pipefail

# Run from repo root
cd "$(dirname "$0")/.."

# Guardrails
if [[ ! -f ".clasp.json" ]]; then
  echo "❌ .clasp.json not found in repo root."
  echo "This folder needs to be a clasp-cloned Apps Script project."
  exit 1
fi

if ! command -v clasp >/dev/null 2>&1; then
  echo "❌ clasp not found."
  echo "Install: npm install -g @google/clasp"
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

# Stage ONLY GAS source files (handles spaces + deletions safely)
STAGED_ANY=0
while IFS= read -r -d '' f; do
  STAGED_ANY=1
  git add -A -- "$f"
done < <(
  {
    git ls-files -z -- '*.js' '*.gs' '*.html' 'appsscript.json'
    git ls-files -z --others --exclude-standard -- '*.js' '*.gs' '*.html' 
'appsscript.json'
  }
)

if [[ "$STAGED_ANY" -eq 0 ]]; then
  echo "✅ No GAS source files found to stage."
  exit 0
fi

# If nothing got staged, don't commit
if git diff --cached --quiet; then
  echo "✅ No GAS source changes to commit."
  exit 0
fi

MSG="sync: pull $(date +"%Y-%m-%d %H:%M:%S")"
git commit -m "$MSG"
echo "✅ Committed: $MSG"

