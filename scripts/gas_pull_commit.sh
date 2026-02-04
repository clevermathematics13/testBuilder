#!/usr/bin/env bash
set -euo pipefail

# Run from the repo root
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

# Only commit if GAS files changed (avoid auto-committing local tooling)
CHANGES="$(git status --porcelain)"
echo "$CHANGES"

if echo "$CHANGES" | grep -qE '^( M|M |A | 
D|\?\?)\s+(appsscript\.json|.*\.js|.*\.gs|.*\.html)$'; then
  git add appsscript.json *.js *.gs *.html 2>/dev/null || true
  MSG="sync: pull $(date +"%Y-%m-%d %H:%M:%S")"
  git commit -m "$MSG"
  echo "✅ Committed: $MSG"
else
  echo "✅ No GAS source changes to commit."
fi

