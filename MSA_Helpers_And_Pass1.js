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
  // Try to load from sheet, fallback to defaults
  try {
    if (cfg.MSA_GRADING_RULES_SPREADSHEET_ID) {
      // Logic to read sheet would go here. For now, returning defaults to ensure it runs.
      // var ss = SpreadsheetApp.openById(cfg.MSA_GRADING_RULES_SPREADSHEET_ID);
    }
  } catch (e) {
    msaWarn_("Could not load rules sheet: " + e.message);
  }
  return { rules: msaDefaultRules_(), source: "defaults", url: "" };
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
  var parent = DriveApp.getFolderById(cfg.MSA_PARENT_FOLDER_ID);
  var name = "MSA_Q_" + docId;
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

function msaWriteTextFile_(folder, filename, content) {
  var files = folder.getFilesByName(filename);
  while (files.hasNext()) files.next().setTrashed(true);
  folder.createFile(filename, content, MimeType.PLAIN_TEXT);
}

function msaWriteJsonFile_(folder, filename, object) {
  var files = folder.getFilesByName(filename);
  while (files.hasNext()) files.next().setTrashed(true);
  folder.createFile(filename, JSON.stringify(object, null, 2), MimeType.PLAIN_TEXT);
}

function msaWritePreviewArtifacts_(cfg, docId, folder, combined, pages) {
  // Placeholder for preview generation
  msaLog_("Preview artifacts generation skipped (placeholder).");
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