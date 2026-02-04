#!/usr/bin/env bash
set -euo pipefail

# Always run from repo root
cd "$(dirname "$0")/.."

echo "=============================="
echo "1) GAS: Pull + Commit"
echo "=============================="
./scripts/gas_pull_commit.sh

echo ""
echo "=============================="
echo "2) GitHub: Push origin"
echo "=============================="
./scripts/github_push.sh

echo ""
echo "✅ Full sync complete."

