/*************
 * MSA_Drive.gs
 *************/

function msaGetParentFolder_() {
  if (!MSA_PARENT_FOLDER_ID) {
    throw new Error("MSA_PARENT_FOLDER_ID is blank. Set it in MSA_Config.gs");
  }
  return DriveApp.getFolderById(MSA_PARENT_FOLDER_ID);
}

function msaGetOrCreateChildFolder_(parentFolder, name) {
  const it = parentFolder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(name);
}

function msaUpsertTextFile_(folder, filename, text) {
  const files = folder.getFilesByName(filename);
  let file;
  if (files.hasNext()) {
    file = files.next();
    file.setContent(text);
    return file;
  }
  return folder.createFile(filename, text, MimeType.PLAIN_TEXT);
}

function msaUpsertJsonFile_(folder, filename, obj) {
  return msaUpsertTextFile_(folder, filename, JSON.stringify(obj, null, 2));
}

function msaReadJsonFileIfExists_(folder, filename) {
  const files = folder.getFilesByName(filename);
  if (!files.hasNext()) return null;
  const file = files.next();
  try {
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (e) {
    msaWarn_("Could not parse JSON from " + filename + ": " + e.message);
    return null;
  }
}

function msaMoveFileToFolder_(fileId, folder) {
  const file = DriveApp.getFileById(fileId);
  folder.addFile(file);

  // Optional: remove from root if it's there (avoid clutter)
  try {
    DriveApp.getRootFolder().removeFile(file);
  } catch (e) {
    // Non-fatal; file might not be in root
  }
  return file;
}

function msaEnsureFolderPath_(parentFolder, pathParts) {
  let cur = parentFolder;
  (pathParts || []).forEach(function (p) {
    cur = msaGetOrCreateChildFolder_(cur, p);
  });
  return cur;
}

/**
 * Central logging helpers so we never crash on missing log functions.
 * Use these everywhere (msaLog_, msaWarn_, msaErr_).
 *
 * Three logging channels:
 *   1. Logger.log()       → GAS Execution log (visible in Apps Script editor,
 *                           ~50KB cap per execution, lost after viewing)
 *   2. console.log()      → Cloud Logging / Stackdriver (persistent 30 days,
 *                           unlimited entries, viewable via GCP console or
 *                           Apps Script → Project Settings → View Cloud Logs)
 *   3. CacheService buffer → Real-time streaming to browser UI (200 entries,
 *                           100KB cap, 10 min TTL, polled by getServerLogs)
 *
 * Optional: call msaDumpLogsToFile_() at end of execution to write a
 * permanent Drive file with the full GAS Logger output.
 */

/** @type {string|null} Active log-session key (null = no streaming) */
var currentLogSessionKey_ = null;
/** @type {number} Auto-incrementing sequence counter for dedup */
var logSeq_ = 0;
/** @type {number} Epoch ms when setLogSession_ was called (for relative timing) */
var logT0_ = 0;

/**
 * Create a new server-side log session. Returns the session ID.
 * Call this from the client BEFORE starting a long-running function,
 * then pass the sessionId into the function's options.
 */
function startLogSession() {
  var id = Utilities.getUuid();
  // Seed the cache entry so getServerLogs doesn't 404
  CacheService.getScriptCache().put('slog_' + id, JSON.stringify([]), 600); // 10 min TTL
  return id;
}

/**
 * Activate streaming for this execution context.
 * Called at the top of long-running server functions.
 */
function setLogSession_(sessionId) {
  currentLogSessionKey_ = sessionId ? ('slog_' + sessionId) : null;
  logSeq_ = 0;
  logT0_ = Date.now();
}

/**
 * Append a single message to the CacheService log buffer.
 * Each entry gets an auto-incrementing `seq` for client-side dedup
 * and a `dt` (ms since session start) for precise timing.
 * Keeps only the last 200 entries and stays under 100 KB.
 */
function appendToLogSession_(level, msg) {
  if (!currentLogSessionKey_) return;
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(currentLogSessionKey_);
    var arr = raw ? JSON.parse(raw) : [];
    arr.push({
      seq: logSeq_++,
      dt: Date.now() - logT0_,
      t: new Date().toLocaleTimeString(),
      l: level,
      m: String(msg)
    });
    // Keep tail — CacheService items max 100 KB
    if (arr.length > 200) arr = arr.slice(arr.length - 200);
    var json = JSON.stringify(arr);
    if (json.length < 95000) {
      cache.put(currentLogSessionKey_, json, 600);
    }
  } catch (e) {
    // Never let log buffering crash the real work
  }
}

/**
 * Poll endpoint: client calls this to get new log entries.
 * Returns entries from `fromIndex` onward (JSON string).
 */
function getServerLogs(sessionId, fromIndex) {
  if (!sessionId) return '[]';
  try {
    var raw = CacheService.getScriptCache().get('slog_' + sessionId);
    if (!raw) return '[]';
    var arr = JSON.parse(raw);
    var slice = arr.slice(fromIndex || 0);
    return JSON.stringify(slice);
  } catch (e) {
    return '[]';
  }
}

function msaLog_(msg) {
  var line = 'ℹ️ ' + msg;
  Logger.log(line);
  console.log(line);            // → Cloud Logging (persistent, unlimited)
  appendToLogSession_('info', msg);
}

function msaWarn_(msg) {
  var line = '⚠️ ' + msg;
  Logger.log(line);
  console.warn(line);           // → Cloud Logging as WARNING severity
  appendToLogSession_('warn', msg);
}

function msaErr_(msg) {
  var line = '❌ ' + msg;
  Logger.log(line);
  console.error(line);          // → Cloud Logging as ERROR severity
  appendToLogSession_('error', msg);
}

// ─────────────────────────────────────────────
// Persistent log dump (Drive file)
// ─────────────────────────────────────────────

/**
 * Write the full Logger output for this execution to a timestamped
 * text file in the MSA parent folder → _logs/ subfolder.
 * Call this at the end of any long-running function.
 * Returns the file ID.
 */
function msaDumpLogsToFile_(label) {
  try {
    var parent = msaGetParentFolder_();
    var logFolder = msaGetOrCreateChildFolder_(parent, '_logs');
    var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    var filename = ts + '_' + (label || 'execution') + '.log';
    var content = Logger.getLog();  // full GAS Logger buffer for this execution
    var file = logFolder.createFile(filename, content, MimeType.PLAIN_TEXT);
    return file.getId();
  } catch (e) {
    // Never let logging crash the real work
    return null;
  }
}

// ─────────────────────────────────────────────
// API-callable log retrieval (for VS Code CLI)
// ─────────────────────────────────────────────

/**
 * Return the Logger.getLog() contents from the CURRENT execution.
 * Useful when called via Execution API alongside another function.
 *
 * To retrieve from VS Code:
 *   node scripts/gas_run_api.js <deployId> getExecutionLog
 */
function getExecutionLog() {
  return Logger.getLog();
}

/**
 * List recent log files from the _logs/ folder.
 * Returns an array of {id, name, date, sizeKB}.
 *
 * Usage from VS Code:
 *   node scripts/gas_run_api.js <deployId> listLogFiles '[5]'
 */
function listLogFiles(limit) {
  limit = limit || 10;
  try {
    var parent = msaGetParentFolder_();
    var logFolder = msaGetOrCreateChildFolder_(parent, '_logs');
    var files = logFolder.getFiles();
    var results = [];
    while (files.hasNext()) {
      var f = files.next();
      results.push({
        id: f.getId(),
        name: f.getName(),
        date: f.getDateCreated().toISOString(),
        sizeKB: Math.round(f.getSize() / 1024)
      });
    }
    // Sort newest first
    results.sort(function(a, b) { return b.date.localeCompare(a.date); });
    return results.slice(0, limit);
  } catch (e) {
    return [{ error: e.message }];
  }
}

/**
 * Fetch the contents of a specific log file by ID.
 *
 * Usage from VS Code:
 *   node scripts/gas_run_api.js <deployId> fetchLogFile '["<fileId>"]'
 */
function fetchLogFile(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    return file.getBlob().getDataAsString();
  } catch (e) {
    return 'Error: ' + e.message;
  }
}
