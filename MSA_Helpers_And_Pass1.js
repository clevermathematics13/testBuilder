/**
 * MSA_Helpers_And_Pass1.gs
 * Implements missing core functions for MSA_RunAndValidate.js
 */

// --- CONFIG & RULES ---
function msaGetConfig_() {
  // Returns the global constants defined in MSA_Config.js
  return {
    MSA_PARENT_FOLDER_ID: typeof MSA_PARENT_FOLDER_ID !== 'undefined' ? MSA_PARENT_FOLDER_ID : "",
    MSA_GRADING_RULES_SPREADSHEET_ID: typeof MSA_GRADING_RULES_SPREADSHEET_ID !== 'undefined' ? MSA_GRADING_RULES_SPREADSHEET_ID : "",
    MSA_GRADING_RULES_SHEET_NAME: typeof MSA_GRADING_RULES_SHEET_NAME !== 'undefined' ? MSA_GRADING_RULES_SHEET_NAME : "rules",
    MSA_PASS2_COVERAGE_TRIGGER: typeof MSA_PASS2_TRIGGER_MIN_COVERAGE_RATIO !== 'undefined' ? MSA_PASS2_TRIGGER_MIN_COVERAGE_RATIO : 0.7,
    MSA_PASS2_STRUCTURE_TRIGGER: typeof MSA_PASS2_TRIGGER_MIN_STRUCTURE_SCORE !== 'undefined' ? MSA_PASS2_TRIGGER_MIN_STRUCTURE_SCORE : 0.85,
    MSA_PASS2_DUP_REQ_TRIGGER: 0.3, // Default
    MSA_PASS2_NOTE_ONLY_TRIGGER: 0.5 // Default
  };
}

function msaLoadGradingRules_(cfg) {
  const defaults = msaDefaultRules_();
  let source = "defaults";
  let url = "";
  let sheetRules = [];

  try {
    if (cfg.MSA_GRADING_RULES_SPREADSHEET_ID) {
      const ss = SpreadsheetApp.openById(cfg.MSA_GRADING_RULES_SPREADSHEET_ID);
      url = ss.getUrl();
      const sheet = ss.getSheetByName(cfg.MSA_GRADING_RULES_SHEET_NAME);
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        const header = data[0].map(h => String(h || "").toLowerCase().trim());

        const idxKey = header.indexOf("rule_key");
        const idxEnabled = header.indexOf("enabled");
        const idxPattern = header.indexOf("pattern");
        const idxAction = header.indexOf("action");
        const idxNotes = header.indexOf("notes");

        if (idxPattern > -1 && idxAction > -1) {
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const isEnabled = (idxEnabled > -1) ? String(row[idxEnabled]).toLowerCase() === 'true' : true;
            if (!isEnabled) continue;

            sheetRules.push({
              rule_key: idxKey > -1 ? row[idxKey] : "sheet_rule_" + i,
              enabled: true,
              pattern: row[idxPattern],
              action: row[idxAction],
              notes: idxNotes > -1 ? row[idxNotes] : ""
            });
          }
          if (sheetRules.length > 0) {
            source = "sheet";
          }
        }
      }
    }
  } catch (e) {
    msaWarn_("Could not load rules from sheet, falling back to defaults: " + e.message);
  }

  const finalRules = (source === "sheet" && sheetRules.length > 0) ? sheetRules : defaults;

  // Pre-compile regexes for performance
  finalRules.forEach(rule => {
    try {
      rule._re = new RegExp(rule.pattern, "i"); // Case-insensitive by default
    } catch (e) {
      msaWarn_(`Invalid regex for rule '${rule.rule_key}': ${rule.pattern}`);
      rule.enabled = false; // Disable rule with bad regex
    }
  });

  return {
    rules: finalRules.filter(r => r.enabled),
    source: source,
    url: url
  };
}

function msaGetDocMeta_(cfg, docId) {
  try {
    var file = DriveApp.getFileById(docId);
    return { title: file.getName(), id: docId };
  } catch (e) {
    return { title: "Unknown Doc", id: docId };
  }
}

// --- DRIVE IO ---
function msaGetOrCreateQuestionFolder_(cfg, docId) {
  const parent = DriveApp.getFolderById(cfg.MSA_PARENT_FOLDER_ID);
  const meta = msaGetDocMeta_(cfg, docId);
  // Sanitize the title to remove characters that are invalid in folder names
  const cleanTitle = (meta.title || "Untitled").replace(/[\\/:"*?<>|]/g, '_');
  const name = "MSA_Q_" + docId + "_" + cleanTitle;
  const iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

function msaWritePreviewArtifacts_(cfg, docId, folder, combined, pages) {
  if (typeof msaBuildPreviewHtml_ !== 'function') {
    msaLog_("msaBuildPreviewHtml_ not found (MSA_Preview.gs missing?). Skipping preview.");
    return;
  }

  try {
    var meta = msaGetDocMeta_(cfg, docId);
    var html = msaBuildPreviewHtml_(meta.title, docId, combined.json);
    msaUpsertTextFile_(folder, "markscheme_preview.html", html);
  } catch (e) {
    msaWarn_("Failed to write preview HTML: " + e.message);
  }
}

// --- SCORING HELPERS (MOVED FROM SRG) ---

/**
 * Calculates the total possible score from a list of markscheme points,
 * correctly handling alternative METHOD branches.
 * @param {Array<Object>} points The array of points from markscheme_points_best.json.
 * @returns {number} The total possible score.
 */
function msaCalculateTotalPossibleScore_(points) {
  const byPart = {};
  (points || []).forEach(p => {
    const part = p.part || 'unknown';
    if (!byPart[part]) byPart[part] = [];
    byPart[part].push(p);
  });

  let totalScore = 0;
  for (const part in byPart) {
    const partPoints = byPart[part];
    const methods = {};
    let nonMethodScore = 0;

    partPoints.forEach(p => {
      const value = msaGetMarkValue_(p.mark);
      if (p.branch && p.branch.startsWith("METHOD")) {
        if (!methods[p.branch]) methods[p.branch] = 0;
        methods[p.branch] += value;
      } else {
        nonMethodScore += value;
      }
    });

    const methodScores = Object.values(methods);
    const maxMethodScore = methodScores.length > 0 ? Math.max(...methodScores) : 0;
    totalScore += nonMethodScore + maxMethodScore;
  }
  return totalScore;
}

/**
 * Extracts the integer value from a mark token (e.g., "A2" -> 2).
 * @param {string} mark The mark token.
 * @returns {number} The integer value of the mark.
 */
function msaGetMarkValue_(mark) {
  const m = String(mark || "").match(/\d+$/);
  return m ? parseInt(m[0], 10) : 1; // Default to 1 if no number found (e.g., for AG)
}

// --- IMAGES & OCR ---
function msaExtractPageImagesFromDoc_(cfg, docId, folder) {
  // NOTE: Google Docs API doesn't export pages as images directly.
  // This fallback extracts INLINE images (e.g. pasted screenshots).
  
  var doc = DocumentApp.openById(docId);
  var body = doc.getBody();
  var images = body.getImages();
  var results = [];
  
  for (var i = 0; i < images.length; i++) {
    var blob = images[i].getBlob();
    var name = "page_" + (i + 1) + ".png";
    blob.setName(name);
    var file = folder.createFile(blob);
    results.push({
      page: i + 1,
      fileName: name,
      fileId: file.getId()
    });
  }
  
  if (results.length === 0) {
    msaWarn_("No inline images found in Doc. If the Doc is text-based, OCR might not be needed or this step requires PDF conversion.");
  }
  
  return results;
}

function msaMathpixOcrFromDriveImage_(fileId, cfg, options) {
  // Fetch the image blob from Drive
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  
  // Call the actual Mathpix logic defined in MSA_Mathpix.gs
  return msaMathpixOCR_(blob);
}

function msaBuildCombinedOcr_(cfg, docId, folder, ocrPages) {
  var fullText = ocrPages.map(function(p) { return p.text; }).join("\n\n");
  return {
    readable: fullText,
    json: ocrPages
  };
}

function msaExtractTextFromDocDirectly_(docId) {
  try {
    var doc = DocumentApp.openById(docId);
    var text = doc.getBody().getText();
    return [{
      page: 1,
      text: text,
      confidence: 1.0,
      latex_styled: text, // Fallback
      request_id: "direct_text_extraction"
    }];
  } catch (e) {
    msaWarn_("Direct text extraction failed: " + e.message);
    return [];
  }
}