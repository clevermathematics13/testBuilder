#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f ".clasp.json" ]]; then
  echo "❌ .clasp.json not found in repo root."
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

# Commit if there are changes
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  MSG="sync: push $(date +"%Y-%m-%d %H:%M:%S")"
  git commit -m "$MSG"
  echo "✅ Committed: $MSG"
else
  echo "✅ No local changes to commit."
fi

echo "➡️  clasp push"
clasp push
echo "✅ Pushed to Apps Script."

