#!/bin/bash
# Fetch the most recent GAS execution log from Drive and save it locally.
# Uses the web app's doGet endpoint — no Execution API needed.
#
# Output: logs/latest_gas.log (overwritten each run)
# Also prints to stdout for terminal visibility.
#
# The web app URL is your production deployment:
#   ?action=listLogs  → JSON array of recent log files
#   ?action=fetchLog&id=<fileId> → plain text log content

set -euo pipefail
cd "$(dirname "$0")/.."

LOGS_DIR="logs"
mkdir -p "$LOGS_DIR"
OUT_FILE="$LOGS_DIR/latest_gas.log"

# Web app base URL — same one your browser uses, minus the ?ui= part
WEBAPP_URL="${GAS_WEBAPP_URL:-}"
if [ -z "$WEBAPP_URL" ]; then
  # Try to read from .env
  if [ -f .env ]; then
    WEBAPP_URL=$(grep '^GAS_WEBAPP_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
fi

if [ -z "$WEBAPP_URL" ]; then
  echo "❌ GAS_WEBAPP_URL not set."
  echo ""
  echo "Add this line to your .env file:"
  echo '  GAS_WEBAPP_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
  echo ""
  echo "You can find your deployment URL in:"
  echo "  Apps Script editor → Deploy → Manage deployments → Web app URL"
  exit 1
fi

echo "=== Fetching log file list from GAS... ==="
LIST_JSON=$(curl -sL "${WEBAPP_URL}?action=listLogs&limit=1")

# Check for valid JSON
if ! echo "$LIST_JSON" | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" 2>/dev/null; then
  echo "❌ Invalid response from web app. Got:"
  echo "$LIST_JSON" | head -5
  echo ""
  echo "Make sure you've pushed the latest code (clasp push) and"
  echo "created a new web app deployment."
  exit 1
fi

# Extract file ID and name
FILE_ID=$(echo "$LIST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (Array.isArray(d) && d.length > 0 && d[0].id) {
    console.log(d[0].id);
  } else if (d.error) {
    process.stderr.write('GAS error: ' + d.error + '\n');
    process.exit(1);
  } else {
    process.stderr.write('No log files found. Run a pipeline first to generate logs.\n');
    process.exit(1);
  }
") || exit 1

FILE_NAME=$(echo "$LIST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d[0].name || 'unknown');
")

echo "=== Fetching: $FILE_NAME ==="
curl -sL "${WEBAPP_URL}?action=fetchLog&id=${FILE_ID}" > "$OUT_FILE"

LINE_COUNT=$(wc -l < "$OUT_FILE" | tr -d ' ')
BYTE_COUNT=$(wc -c < "$OUT_FILE" | tr -d ' ')
echo "=== Saved $LINE_COUNT lines ($BYTE_COUNT bytes) → $OUT_FILE ==="
echo ""
cat "$OUT_FILE"
