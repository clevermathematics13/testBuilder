#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/PROJECT_OVERVIEW.md}"

die() { echo "❌ $*" >&2; exit 1; }

# Always create/overwrite the output file
: > "$OUT" || die "Cannot write to: $OUT"

ts() { date "+%Y-%m-%d %H:%M:%S"; }

section() {
  echo "" >> "$OUT"
  echo "## $1" >> "$OUT"
  echo "" >> "$OUT"
}

append_cmd() {
  local title="$1"
  shift
  echo "**$title**" >> "$OUT"
  echo "" >> "$OUT"
  echo '```' >> "$OUT"
  "$@" 2>&1 || true
  echo '```' >> "$OUT"
  echo "" >> "$OUT"
}

safe_grep() {
  local pattern="$1"
  local title="$2"

  section "$title"
  echo "Pattern: \`$pattern\`" >> "$OUT"
  echo "" >> "$OUT"
  echo '```' >> "$OUT"

  local tmp
  tmp="$(mktemp)"

  find "$ROOT" \
    -type d -name ".git" -prune -o \
    -type f \( -name "*.gs" -o -name "*.js" -o -name "*.json" \) \
    -print0 > "$tmp"

  if [[ ! -s "$tmp" ]]; then
    echo "(No files found.)" >> "$OUT"
    echo '```' >> "$OUT"
    rm -f "$tmp"
    return 0
  fi

  xargs -0 -I {} bash -c 'grep -nE -I -- "$0" "$1" 2>/dev/null || true' \
    "$pattern" {} < "$tmp" \
    | sed "s|$ROOT/||" \
    | head -n 250 >> "$OUT"

  echo '```' >> "$OUT"
  rm -f "$tmp"
}

{
  echo "# Project Overview"
  echo ""
  echo "- Generated: $(ts)"
  echo "- Repo root: $ROOT"
  echo ""
} >> "$OUT"

section "Git"
append_cmd "git status -sb" git -C "$ROOT" status -sb
append_cmd "recent commits (last 10)" git -C "$ROOT" log --oneline -n 10

section "Files (code-ish)"
echo '```' >> "$OUT"
find "$ROOT" \
  -type d -name ".git" -prune -o \
  -type f \( -name "*.gs" -o -name "*.js" -o -name "*.json" \) \
  -print \
  | sed "s|$ROOT/||" \
  | sort \
  | head -n 300 >> "$OUT"
echo '```' >> "$OUT"

safe_grep "msaGetConfig_" "Hotspot: msaGetConfig_ references"
safe_grep "msaErr_" "Hotspot: msaErr_ references"
safe_grep "runMSA_VR" "Hotspot: MSA-VR entry points"
safe_grep "Pass2|MSA_Atomizer_Pass2" "Hotspot: Pass2 wiring"
safe_grep "Pass3|MSA_Atomizer_Pass3" "Hotspot: Pass3 wiring"

echo "" >> "$OUT"
echo "✅ Done." >> "$OUT"

echo "✅ Wrote: $OUT"
open "$OUT" >/dev/null 2>&1 || true

