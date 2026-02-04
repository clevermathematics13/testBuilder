#!/usr/bin/env bash
set -euo pipefail

# Run from repo root
cd "$(dirname "$0")/.."

# Guardrails
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ Not inside a git repository."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "❌ Remote 'origin' not found."
  echo "Open GitHub Desktop and confirm the repo is published."
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "➡️  git status (short)"
git status -sb

echo "➡️  git push origin ${BRANCH}"
git push origin "${BRANCH}"

echo "✅ Pushed to GitHub: origin/${BRANCH}"

