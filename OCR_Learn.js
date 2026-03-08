/********************************
 * OCR_Learn.js
 *
 * Correction-learning engine for OCR output.
 *
 * When a user corrects OCR text in the UI, this module:
 *   1. Diffs the original OCR against the corrected version
 *   2. Extracts token-level substitution patterns
 *   3. Stores them in a Google Sheet with frequency tracking
 *   4. On subsequent OCR runs, auto-applies high-confidence rules
 *
 * The "learned_rules" sheet acts as a growing dictionary of
 * Mathpix OCR patterns that need correction for IB math handwriting.
 *
 * Entry points
 * ────────────
 *   extractCorrections_(originalText, correctedText)
 *     → [ { type, original, corrected, context } ]
 *
 *   saveLearnedCorrections_(corrections, meta)
 *     → { saved: N, updated: N }
 *
 *   applyLearnedCorrections_(ocrText)
 *     → { text, applied: [ { rule, count } ], stats }
 *
 *   getLearnedRulesSummary_()
 *     → { totalRules, highConfidence, recentlyUsed }
 ********************************/

/* ═══════════════════════════════════════════════════════
 * 1.  CORRECTIONS SPREADSHEET MANAGEMENT
 * ═══════════════════════════════════════════════════════ */

/**
 * Get or create the OCR Corrections spreadsheet.
 * Uses MSA_OCR_CORRECTIONS_SPREADSHEET_ID from config if set,
 * otherwise checks Script Properties, otherwise creates a new one.
 * @returns {SpreadsheetApp.Spreadsheet}
 */
function getOrCreateCorrectionsSheet_() {
  // 1. Try config constant
  if (typeof MSA_OCR_CORRECTIONS_SPREADSHEET_ID !== 'undefined' && MSA_OCR_CORRECTIONS_SPREADSHEET_ID) {
    try {
      return SpreadsheetApp.openById(MSA_OCR_CORRECTIONS_SPREADSHEET_ID);
    } catch (e) {
      msaLog_('Config corrections spreadsheet not found: ' + e.message);
    }
  }

  // 2. Try Script Properties
  var props = PropertiesService.getScriptProperties();
  var storedId = props.getProperty('OCR_CORRECTIONS_SHEET_ID');
  if (storedId) {
    try {
      return SpreadsheetApp.openById(storedId);
    } catch (e) {
      msaLog_('Stored corrections spreadsheet not found: ' + e.message);
    }
  }

  // 3. Create new spreadsheet
  msaLog_('Creating new OCR Corrections spreadsheet...');
  var ss = SpreadsheetApp.create('MSA OCR Corrections');

  // "learned_rules" sheet — the correction dictionary
  var rulesSheet = ss.getActiveSheet();
  rulesSheet.setName('learned_rules');
  rulesSheet.getRange(1, 1, 1, 7).setValues([[
    'Pattern', 'Replacement', 'Frequency', 'Last Seen',
    'First Seen', 'Context Sample', 'Type'
  ]]);
  rulesSheet.setFrozenRows(1);
  rulesSheet.getRange('A1:G1').setFontWeight('bold');
  rulesSheet.setColumnWidth(1, 250);
  rulesSheet.setColumnWidth(2, 250);
  rulesSheet.setColumnWidth(6, 300);

  // "corrections_log" sheet — full audit trail
  var logSheet = ss.insertSheet('corrections_log');
  logSheet.getRange(1, 1, 1, 8).setValues([[
    'Timestamp', 'File ID', 'Question Code', 'Type',
    'Original', 'Corrected', 'Context', 'Line'
  ]]);
  logSheet.setFrozenRows(1);
  logSheet.getRange('A1:H1').setFontWeight('bold');

  // Move to MSA parent folder
  try {
    var cfg = msaGetConfig_();
    var parentFolder = DriveApp.getFolderById(cfg.MSA_PARENT_FOLDER_ID);
    var file = DriveApp.getFileById(ss.getId());
    parentFolder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  } catch (e) {
    msaLog_('Could not move corrections sheet to parent folder: ' + e.message);
  }

  // Store ID for future use
  props.setProperty('OCR_CORRECTIONS_SHEET_ID', ss.getId());
  msaLog_('Created corrections spreadsheet: ' + ss.getId());
  msaLog_('💡 Add this to MSA_Config.js: const MSA_OCR_CORRECTIONS_SPREADSHEET_ID = "' + ss.getId() + '";');

  return ss;
}


/* ═══════════════════════════════════════════════════════
 * 2.  DIFF ENGINE — Extract corrections from user edits
 * ═══════════════════════════════════════════════════════ */

/**
 * Character-level similarity between two strings (0..1).
 * Uses LCS length / max(len(a), len(b)).  O(n·m) but only called
 * on short lines inside change groups, so fine in practice.
 */
function similarityScore_(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  var n = a.length, m = b.length;
  if (n === 0 && m === 0) return 1;
  // Quick exit for identical strings
  if (a === b) return 1;
  // Character-level LCS (two-row optimisation to save memory)
  var prev = new Array(m + 1);
  var curr = new Array(m + 1);
  for (var j = 0; j <= m; j++) prev[j] = 0;
  for (var i = 1; i <= n; i++) {
    for (var j2 = 0; j2 <= m; j2++) curr[j2] = 0;
    for (var j3 = 1; j3 <= m; j3++) {
      if (a[i - 1] === b[j3 - 1]) curr[j3] = prev[j3 - 1] + 1;
      else curr[j3] = Math.max(prev[j3], curr[j3 - 1]);
    }
    var tmp = prev; prev = curr; curr = tmp;
  }
  return prev[m] / Math.max(n, m);
}

/**
 * Given a list of deleted lines and inserted lines inside a change group,
 * pair them by similarity (greedy best-match) instead of by sequential
 * position.  Returns { pairs:[[delIdx,insIdx],...], unmatchedDels:[], unmatchedIns:[] }.
 */
function pairBySimilarity_(deletes, inserts) {
  var usedDel = {}, usedIns = {};
  var pairs = [];

  // Build similarity matrix
  var scores = [];
  for (var d = 0; d < deletes.length; d++) {
    for (var i = 0; i < inserts.length; i++) {
      scores.push({ d: d, i: i, score: similarityScore_(deletes[d].trim(), inserts[i].trim()) });
    }
  }
  // Sort descending by score
  scores.sort(function(a, b) { return b.score - a.score; });

  // Greedy assignment — pick the best pair that hasn't been used
  for (var k = 0; k < scores.length; k++) {
    var s = scores[k];
    if (usedDel[s.d] || usedIns[s.i]) continue;
    // Minimum similarity threshold — below this, treat as unrelated
    if (s.score < 0.15) break;
    pairs.push([s.d, s.i]);
    usedDel[s.d] = true;
    usedIns[s.i] = true;
  }

  var unmatchedDels = [];
  for (var d2 = 0; d2 < deletes.length; d2++) {
    if (!usedDel[d2]) unmatchedDels.push(d2);
  }
  var unmatchedIns = [];
  for (var i2 = 0; i2 < inserts.length; i2++) {
    if (!usedIns[i2]) unmatchedIns.push(i2);
  }
  return { pairs: pairs, unmatchedDels: unmatchedDels, unmatchedIns: unmatchedIns };
}

/**
 * Extract correction patterns by diffing original OCR text against user-corrected text.
 * Uses line-level LCS alignment, then token-level diffing within changed lines.
 * Within each change group, lines are paired by *similarity* (not sequential order)
 * so that e.g. M_{a_{n}}=1 pairs with Max_{n}=13 rather than with u_{1}=14.
 *
 * @param {string} originalText  The raw OCR text (before user edits)
 * @param {string} correctedText The user-corrected text
 * @returns {Array} Array of { type, original, corrected, context } objects
 */
function extractCorrections_(originalText, correctedText) {
  if (!originalText || !correctedText) return [];
  if (originalText.trim() === correctedText.trim()) return [];

  var origLines = originalText.split('\n');
  var corrLines = correctedText.split('\n');

  // ── Line-level LCS to align the two texts ──
  var n = origLines.length, m = corrLines.length;
  var dp = [];
  for (var i = 0; i <= n; i++) {
    dp[i] = new Array(m + 1);
    for (var j = 0; j <= m; j++) {
      if (i === 0 || j === 0) {
        dp[i][j] = 0;
      } else if (origLines[i - 1].trim() === corrLines[j - 1].trim()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build alignment
  var alignment = [];
  var i = n, j = m;
  while (i > 0 && j > 0) {
    if (origLines[i - 1].trim() === corrLines[j - 1].trim()) {
      alignment.unshift({ type: 'match', oi: i - 1, ci: j - 1 });
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      alignment.unshift({ type: 'delete', oi: i - 1 });
      i--;
    } else {
      alignment.unshift({ type: 'insert', ci: j - 1 });
      j--;
    }
  }
  while (i > 0) { alignment.unshift({ type: 'delete', oi: i - 1 }); i--; }
  while (j > 0) { alignment.unshift({ type: 'insert', ci: j - 1 }); j--; }

  // ── Group consecutive non-match entries into change regions ──
  var corrections = [];
  var groups = [];
  var currentGroup = null;

  for (var k = 0; k < alignment.length; k++) {
    var entry = alignment[k];
    if (entry.type === 'match') {
      if (currentGroup) { groups.push(currentGroup); currentGroup = null; }
    } else {
      if (!currentGroup) currentGroup = { deletes: [], inserts: [] };
      if (entry.type === 'delete') currentGroup.deletes.push(origLines[entry.oi]);
      if (entry.type === 'insert') currentGroup.inserts.push(corrLines[entry.ci]);
    }
  }
  if (currentGroup) groups.push(currentGroup);

  // ── For each change group, extract token-level corrections ──
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];

    // Pair deleted/inserted lines by similarity (not position)
    var pairing = pairBySimilarity_(group.deletes, group.inserts);

    for (var p = 0; p < pairing.pairs.length; p++) {
      var dIdx = pairing.pairs[p][0];
      var iIdx = pairing.pairs[p][1];
      var origLine = group.deletes[dIdx].trim();
      var corrLine = group.inserts[iIdx].trim();
      if (origLine && corrLine && origLine !== corrLine) {
        var tokenChanges = extractTokenChanges_(origLine, corrLine);
        corrections = corrections.concat(tokenChanges);
      }
    }

    // Pure deletions (unmatched deleted lines)
    for (var d = 0; d < pairing.unmatchedDels.length; d++) {
      var deleted = group.deletes[pairing.unmatchedDels[d]].trim();
      if (deleted) {
        corrections.push({
          type: 'delete_line',
          original: deleted,
          corrected: '',
          context: deleted.substring(0, 80)
        });
      }
    }

    // Pure insertions (lines the user added) — less useful for learning
    // We log them but don't create replacement rules from them
  }

  return corrections;
}

/**
 * Extract token-level changes between two similar lines.
 * Uses LCS on whitespace-split tokens to find specific substitutions.
 *
 * @param {string} origLine  Original OCR line
 * @param {string} corrLine  User-corrected line
 * @returns {Array} Array of { type, original, corrected, context }
 */
function extractTokenChanges_(origLine, corrLine) {
  var changes = [];
  var origTokens = origLine.split(/(\s+)/).filter(function(t) { return t.trim(); });
  var corrTokens = corrLine.split(/(\s+)/).filter(function(t) { return t.trim(); });

  // Token-level LCS
  var n = origTokens.length, m = corrTokens.length;

  // Guard: if either side is very large, fall back to full-line comparison
  if (n > 200 || m > 200) {
    return [{
      type: 'replace',
      original: origLine,
      corrected: corrLine,
      context: origLine.substring(0, 80)
    }];
  }

  var dp = [];
  for (var i = 0; i <= n; i++) {
    dp[i] = new Array(m + 1);
    for (var j = 0; j <= m; j++) {
      if (i === 0 || j === 0) dp[i][j] = 0;
      else if (origTokens[i - 1] === corrTokens[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to build token diff
  var result = [];
  var i = n, j = m;
  while (i > 0 && j > 0) {
    if (origTokens[i - 1] === corrTokens[j - 1]) {
      result.unshift({ type: 'keep', text: origTokens[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      result.unshift({ type: 'delete', text: origTokens[i - 1] });
      i--;
    } else {
      result.unshift({ type: 'insert', text: corrTokens[j - 1] });
      j--;
    }
  }
  while (i > 0) { result.unshift({ type: 'delete', text: origTokens[i - 1] }); i--; }
  while (j > 0) { result.unshift({ type: 'insert', text: corrTokens[j - 1] }); j--; }

  // Merge adjacent same-type operations into compound patterns.
  // e.g. delete(\quad) + delete(M) + delete(1) → delete("\quad M 1")
  // and  delete(A) + insert(B) + delete(C) + insert(D) → replace("A C", "B D")
  var k = 0;
  while (k < result.length) {
    if (result[k].type === 'delete') {
      // Collect all consecutive deletes
      var delTokens = [];
      while (k < result.length && result[k].type === 'delete') {
        delTokens.push(result[k].text);
        k++;
      }
      // Check if followed by consecutive inserts (= compound substitution)
      var insTokens = [];
      while (k < result.length && result[k].type === 'insert') {
        insTokens.push(result[k].text);
        k++;
      }
      if (insTokens.length > 0) {
        // Substitution: "A B C" → "X Y"
        changes.push({
          type: 'replace',
          original: delTokens.join(' '),
          corrected: insTokens.join(' '),
          context: origLine.substring(0, 80)
        });
      } else {
        // Pure deletion: "\quad M 1" → ""
        changes.push({
          type: 'delete',
          original: delTokens.join(' '),
          corrected: '',
          context: origLine.substring(0, 80)
        });
      }
    } else if (result[k].type === 'insert') {
      // Collect consecutive inserts
      var insTokens2 = [];
      while (k < result.length && result[k].type === 'insert') {
        insTokens2.push(result[k].text);
        k++;
      }
      changes.push({
        type: 'insert',
        original: '',
        corrected: insTokens2.join(' '),
        context: origLine.substring(0, 80)
      });
    } else {
      k++; // keep — skip
    }
  }

  return changes;
}


/* ═══════════════════════════════════════════════════════
 * 3.  PERSISTENCE — Save/load corrections to Spreadsheet
 * ═══════════════════════════════════════════════════════ */

/**
 * Save extracted corrections to the learned_rules sheet.
 * Increments frequency for existing rules, adds new ones.
 *
 * @param {Array}  corrections  Array from extractCorrections_()
 * @param {object} meta         { fileId, questionCode }
 * @returns {object} { saved, updated, total }
 */
function saveLearnedCorrections_(corrections, meta) {
  if (!corrections || corrections.length === 0) return { saved: 0, updated: 0, total: 0 };

  var ss = getOrCreateCorrectionsSheet_();
  var rulesSheet = ss.getSheetByName('learned_rules');
  var logSheet = ss.getSheetByName('corrections_log');
  var now = new Date();
  var stats = { saved: 0, updated: 0, total: 0 };

  // Load existing rules into a lookup map: "pattern||replacement" → row index
  var existingData = rulesSheet.getDataRange().getValues();
  var ruleMap = {};
  for (var r = 1; r < existingData.length; r++) {
    var key = existingData[r][0] + '||' + existingData[r][1];
    ruleMap[key] = { row: r + 1, frequency: existingData[r][2] || 0 };
  }

  // Process each correction
  var newRows = [];
  var logRows = [];

  for (var i = 0; i < corrections.length; i++) {
    var c = corrections[i];

    // Skip trivial changes (whitespace-only, empty)
    if (!c.original && !c.corrected) continue;
    if (c.original === c.corrected) continue;

    // Only learn from replacements and deletions (not pure insertions)
    if (c.type === 'insert') continue;

    // Skip very long patterns (>100 chars) — too specific to generalize
    if ((c.original || '').length > 100) continue;

    // SAFETY: Skip dangerously short deletion patterns (≤ 3 chars) that would
    // match everywhere. e.g. deleting "M" or "1" would destroy all M's and 1's.
    // Exception: patterns containing CJK or clearly non-math characters are OK to delete.
    if (c.type === 'delete' && (c.original || '').length <= 3) {
      var hasCJK = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(c.original);
      if (!hasCJK) continue;
    }

    // SAFETY: Skip patterns that are common LaTeX tokens, single digits,
    // single letters, or operators — these would match far too broadly.
    // BUT allow multi-digit numbers (e.g. '15'→'13') even if short.
    var UNSAFE_PATTERNS = /^(\\?[a-zA-Z]|[+\-=()\[\]{}.,;:!?\/<>|\\])$/;
    if (UNSAFE_PATTERNS.test((c.original || '').trim())) continue;
    // Also skip single-digit patterns (too common) but allow 2+ digit numbers
    if (/^\d$/.test((c.original || '').trim())) continue;

    // Skip single-character changes that are just case differences
    if (c.original && c.corrected &&
        c.original.length === 1 && c.corrected.length === 1 &&
        c.original.toLowerCase() === c.corrected.toLowerCase()) continue;

    // SAFETY: reject likely mis-paired rules — if pattern and replacement
    // share almost no characters, they probably came from misaligned lines.
    // Threshold: require ≥ 20% character overlap for multi-token replacements.
    // Short patterns (≤ 8 chars) or digit-only swaps are exempt.
    if (c.type === 'replace' && c.original && c.corrected &&
        c.original.length > 8 && c.corrected.length > 8) {
      var sim = similarityScore_(c.original, c.corrected);
      if (sim < 0.20) {
        msaLog_('  ⚠ Skipping mis-paired rule (similarity=' + sim.toFixed(2) + '): "' +
                c.original.substring(0, 40) + '" → "' + c.corrected.substring(0, 40) + '"');
        continue;
      }
    }

    var key = (c.original || '') + '||' + (c.corrected || '');

    if (ruleMap[key]) {
      // Update existing rule — increment frequency
      var rowIdx = ruleMap[key].row;
      var newFreq = ruleMap[key].frequency + 1;
      rulesSheet.getRange(rowIdx, 3).setValue(newFreq);      // Frequency
      rulesSheet.getRange(rowIdx, 4).setValue(now);           // Last Seen
      ruleMap[key].frequency = newFreq;
      stats.updated++;
    } else {
      // New rule
      newRows.push([
        c.original || '',     // Pattern
        c.corrected || '',    // Replacement
        1,                    // Frequency
        now,                  // Last Seen
        now,                  // First Seen
        c.context || '',      // Context Sample
        c.type || 'replace'   // Type
      ]);
      ruleMap[key] = { row: existingData.length + newRows.length, frequency: 1 };
      stats.saved++;
    }

    // Always log the individual correction event
    logRows.push([
      now,
      (meta && meta.fileId) || '',
      (meta && meta.questionCode) || '',
      c.type || 'replace',
      c.original || '',
      c.corrected || '',
      c.context || '',
      ''  // Line (reserved)
    ]);
  }

  // Batch write new rules
  if (newRows.length > 0) {
    var startRow = rulesSheet.getLastRow() + 1;
    rulesSheet.getRange(startRow, 1, newRows.length, 7).setValues(newRows);
  }

  // Batch write log entries
  if (logRows.length > 0) {
    var logStartRow = logSheet.getLastRow() + 1;
    logSheet.getRange(logStartRow, 1, logRows.length, 8).setValues(logRows);
  }

  stats.total = Object.keys(ruleMap).length - 1; // minus header
  msaLog_('Saved corrections: ' + stats.saved + ' new, ' + stats.updated + ' updated (' + stats.total + ' total rules)');

  return stats;
}

/**
 * Load learned correction rules from the spreadsheet.
 * Returns rules sorted by frequency (highest first).
 * Only returns rules with frequency >= minFrequency.
 *
 * @param {object} opts  { minFrequency: 2 } — minimum times a rule must be seen
 * @returns {Array} Array of { pattern, replacement, frequency, type }
 */
function loadLearnedCorrections_(opts) {
  opts = opts || {};
  var minFreq = opts.minFrequency || 2;

  try {
    var ss = getOrCreateCorrectionsSheet_();
    var rulesSheet = ss.getSheetByName('learned_rules');
    var data = rulesSheet.getDataRange().getValues();
    var rules = [];

    for (var r = 1; r < data.length; r++) {
      var frequency = data[r][2] || 0;
      if (frequency < minFreq) continue;

      var pattern = data[r][0];
      var replacement = data[r][1];
      if (!pattern && pattern !== 0 && !replacement && replacement !== 0) continue;

      // Coerce to String — spreadsheet may return Number/Date objects
      pattern = String(pattern);
      replacement = String(replacement || '');

      // ── Safety guards: skip obviously destructive rules ──
      if (pattern.length <= 2) {
        // Single/double-char patterns like '{', '}', 'M', '\\' destroy LaTeX
        // BUT allow short numeric patterns (e.g. '15'→'13') which are valid digit-swap corrections
        var isNumericSwap = /^\d+$/.test(pattern) && /^\d+$/.test(replacement) && pattern.length === replacement.length;
        if (!isNumericSwap) continue;
      }
      if (pattern === replacement) continue;  // no-op
      if (!replacement && pattern.length < 5) continue;  // short deletion

      // Block rules that modify LaTeX structural commands
      if (/\\begin|\\end|\\frac|\\sqrt|\\left|\\right|\\array/.test(pattern)) continue;

      // Block bare LaTeX commands (e.g. "\text"→"", "\quad"→"")
      // These are formatting commands, not OCR misreads
      if (/^\\[a-zA-Z]+$/.test(pattern)) continue;

      // Block patterns containing '=' — these are expression-specific answers,
      // not generalizable OCR errors (e.g. "u_{1}=14"→"n+7")
      if (/=/.test(pattern)) continue;

      // Block line-break patterns
      if (pattern === '\\\\' || pattern === '\\\n') continue;

      rules.push({
        pattern: pattern,
        replacement: replacement,
        frequency: frequency,
        type: data[r][6] || 'replace',
        lastSeen: data[r][3],
        context: data[r][5]
      });
    }

    // Sort by frequency descending (most common corrections first)
    rules.sort(function(a, b) { return b.frequency - a.frequency; });

    msaLog_('Loaded ' + rules.length + ' learned correction rules (freq >= ' + minFreq + ')');
    return rules;
  } catch (e) {
    msaLog_('Could not load learned corrections: ' + e.message);
    return [];
  }
}


/* ═══════════════════════════════════════════════════════
 * 4.  APPLICATION — Apply learned rules to new OCR text
 * ═══════════════════════════════════════════════════════ */

/**
 * Apply learned correction rules to OCR text.
 * Only applies rules that have been seen at least `minFrequency` times.
 *
 * @param {string} ocrText  Raw OCR text from Mathpix
 * @param {object} opts     { minFrequency: 2 }
 * @returns {object} { text, applied: [{pattern,replacement,count}], stats }
 */
function applyLearnedCorrections_(ocrText, opts) {
  if (!ocrText) return { text: ocrText, applied: [], stats: { rulesLoaded: 0, rulesApplied: 0, totalReplacements: 0 } };

  var t0 = Date.now();
  opts = opts || {};
  var rules = loadLearnedCorrections_(opts);
  msaLog_('  [CLEAN.learned] loaded ' + rules.length + ' rules (minFreq=' + (opts.minFrequency || 2) + ') Δ' + (Date.now() - t0) + 'ms');

  if (rules.length === 0) {
    return {
      text: ocrText,
      applied: [],
      stats: { rulesLoaded: 0, rulesApplied: 0, totalReplacements: 0 }
    };
  }

  var correctedText = ocrText;
  var applied = [];
  var totalReplacements = 0;

  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (!rule.pattern) continue;

    // Escape special regex characters in the pattern for literal matching
    var escaped = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re;
    try {
      re = new RegExp(escaped, 'g');
    } catch (e) {
      continue; // skip broken patterns
    }

    var matches = correctedText.match(re);
    if (matches && matches.length > 0) {
      correctedText = correctedText.replace(re, rule.replacement);
      applied.push({
        pattern: rule.pattern,
        replacement: rule.replacement,
        count: matches.length,
        frequency: rule.frequency
      });
      totalReplacements += matches.length;
    }
  }

  msaLog_('  [CLEAN.learned] DONE applied=' + applied.length + '/' + rules.length + ' replacements=' + totalReplacements + ' chars=' + ocrText.length + '→' + correctedText.length + ' Δ' + (Date.now() - t0) + 'ms');

  return {
    text: correctedText,
    applied: applied,
    stats: {
      rulesLoaded: rules.length,
      rulesApplied: applied.length,
      totalReplacements: totalReplacements
    }
  };
}


/* ═══════════════════════════════════════════════════════
 * 5.  SUMMARY / DIAGNOSTICS
 * ═══════════════════════════════════════════════════════ */

/**
 * Get a summary of the learned rules for UI display.
 * @returns {object} { totalRules, highConfidence, topRules[] }
 */
function getLearnedRulesSummary_() {
  try {
    var ss = getOrCreateCorrectionsSheet_();
    var rulesSheet = ss.getSheetByName('learned_rules');
    var data = rulesSheet.getDataRange().getValues();

    var totalRules = data.length - 1; // minus header
    var highConfidence = 0;
    var topRules = [];

    for (var r = 1; r < data.length; r++) {
      var freq = data[r][2] || 0;
      if (freq >= 2) highConfidence++;
      if (freq >= 2 && topRules.length < 10) {
        topRules.push({
          pattern: data[r][0],
          replacement: data[r][1],
          frequency: freq
        });
      }
    }

    // Sort top rules by frequency
    topRules.sort(function(a, b) { return b.frequency - a.frequency; });

    return {
      totalRules: totalRules,
      highConfidence: highConfidence,
      topRules: topRules
    };
  } catch (e) {
    return { totalRules: 0, highConfidence: 0, topRules: [] };
  }
}


/* ═══════════════════════════════════════════════════════
 * 6.  CRUD — Manage learned rules from the UI
 * ═══════════════════════════════════════════════════════ */

/**
 * Return ALL learned correction rules (no frequency filter) for the rules manager UI.
 * @returns {object} { rules: [{row, pattern, replacement, frequency, lastSeen, firstSeen, context, type}] }
 */
function getAllLearnedRules() {
  try {
    var ss = getOrCreateCorrectionsSheet_();
    var sheet = ss.getSheetByName('learned_rules');
    var data = sheet.getDataRange().getValues();
    var rules = [];
    for (var r = 1; r < data.length; r++) {
      rules.push({
        row: r + 1,
        pattern: String(data[r][0] || ''),
        replacement: String(data[r][1] || ''),
        frequency: data[r][2] || 0,
        lastSeen: data[r][3] ? new Date(data[r][3]).toISOString() : '',
        firstSeen: data[r][4] ? new Date(data[r][4]).toISOString() : '',
        context: String(data[r][5] || ''),
        type: String(data[r][6] || 'replace')
      });
    }
    rules.sort(function(a, b) { return b.frequency - a.frequency; });
    return JSON.stringify({ rules: rules, total: rules.length });
  } catch (e) {
    return JSON.stringify({ rules: [], total: 0, error: e.message });
  }
}

/**
 * Delete a learned rule by its sheet row number.
 * @param {number} row  The 1-based row in the spreadsheet
 * @returns {string} JSON result
 */
function deleteLearnedRule(row) {
  try {
    var ss = getOrCreateCorrectionsSheet_();
    var sheet = ss.getSheetByName('learned_rules');
    if (row < 2 || row > sheet.getLastRow()) {
      return JSON.stringify({ success: false, error: 'Invalid row: ' + row });
    }
    var deleted = sheet.getRange(row, 1, 1, 7).getValues()[0];
    sheet.deleteRow(row);
    msaLog_('Deleted learned rule row ' + row + ': "' + deleted[0] + '"→"' + deleted[1] + '"');
    return JSON.stringify({ success: true, deletedPattern: String(deleted[0]) });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * Update a learned rule's pattern and replacement.
 * @param {number} row         The 1-based row in the spreadsheet
 * @param {string} pattern     New pattern value
 * @param {string} replacement New replacement value
 * @returns {string} JSON result
 */
function updateLearnedRule(row, pattern, replacement) {
  try {
    var ss = getOrCreateCorrectionsSheet_();
    var sheet = ss.getSheetByName('learned_rules');
    if (row < 2 || row > sheet.getLastRow()) {
      return JSON.stringify({ success: false, error: 'Invalid row: ' + row });
    }
    sheet.getRange(row, 1).setValue(pattern);
    sheet.getRange(row, 2).setValue(replacement);
    msaLog_('Updated learned rule row ' + row + ': "' + pattern + '"→"' + replacement + '"');
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}
