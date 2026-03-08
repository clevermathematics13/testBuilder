# Copilot Instructions — testBuilder

## Project Context
This is a Google Apps Script (GAS) project managed via `clasp`. The codebase runs server-side on Google's infrastructure, not locally.

## GAS Execution Logs
When debugging GAS server-side issues, check for a recent execution log at:
- `logs/latest_gas.log` — fetched from Google Drive via `scripts/fetch_latest_gas_log.sh`

If the user mentions errors, QR failures, OCR issues, or pipeline problems, **read `logs/latest_gas.log` first** for server-side context before suggesting fixes.

To refresh the log file, run the VS Code task "GAS: Fetch Latest Log" or:
```bash
./scripts/fetch_latest_gas_log.sh
```

## Logging Convention
- `msaLog_()` = info (normal flow)
- `msaWarn_()` = warning (unexpected but non-fatal)
- `msaErr_()` = error (something broke)
- Log lines use `[phase/step]` prefixes like `[3/7 QR]`, `[QR.retry]`
- Timing deltas shown as `Δ123ms`

## Key Files
- `MSA_Drive.js` — logging infrastructure, Drive helpers
- `WebApp.js` — student OCR pipeline, QR decode, grading
- `Index.html` — MSA Validation & Repair UI
- `ExamUI.html` — Exam Management UI
- `MSA_Config.js` — configuration constants
