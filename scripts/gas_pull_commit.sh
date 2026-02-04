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

if [[ -z "$(git status --porcelain)" ]]; then
  echo "✅ No changes to commit."
  exit 0
fi

git add -A
MSG="sync: pull $(date +"%Y-%m-%d %H:%M:%S")"
git commit -m "$MSG"
echo "✅ Committed: $MSG"

