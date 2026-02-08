#!/usr/bin/env bash
set -euo pipefail

# Run from repo root
cd "$(dirname "$0")/.."

# 1) Pull from Apps Script, stage, commit (your existing workflow)
./scripts/gas_pull_commit.sh

# 2) Push commits to GitHub (your existing workflow)
./scripts/github_push.sh

