/************************
 * MSA_RunAndValidate.gs
 ************************/

function runMSA_VR_Batch() {
  msaLog_("=== MSA-VR (Validation & Repair) BATCH START ===");

  // 🟢 PUT THE DOC IDs YOU WANT TO TEST HERE:
  const docIds = [
    "1Q0j5sk0-2xQWPEAS4NIO6jBq02IJvnNFvjc4cJJQu88", // Example 1
    "1ogg4P9-_Q5-7GVgrtIbo355WjhYgoYs7Mjk0OOjO7Ho", // 22M.2.AHL.TZ2.H_7
    "1zfGnVJHtGxrEGCVLR7PTsYFwcsbpyRU1aOcyO6MdNN4",  // Example 3
    "17VFlp49U15wcbOoSP7wNUdraz3TjElwYwyvavLErec8" // 22M.2.AHL.TZ2.H_6
  ];

  for (let i = 0; i < docIds.length; i++) {
    const docId = docIds[i];
    try {
      runMSA_VR_One(docId);
    } catch (e) {
      msaErr_("Batch: failed for docId=" + docId + " | " + (e && e.stack ? e.stack : e));
    }
  }

  msaLog_("=== MSA-VR (Validation & Repair) BATCH END ===");
}

function runMSA_VR_One(docId) {
  const t0 = Date.now();
  msaLog_("=== MSA-VR (Validation & Repair) START === docId=" + docId);

  const cfg = msaGetConfig_();

  // Load rules (sheet overrides + defaults)
  const rules = msaLoadGradingRules_(cfg);
  msaLog_("grading_rules sheet loaded: " + rules.rules.length + " rules (defaults also available).");
  msaLog_("grading_rules: source=" + rules.source + " | " + rules.url);

  // Build (or reuse) Drive folder
  const folder = msaGetOrCreateQuestionFolder_(cfg, docId);

  // Convert Doc -> images
  const pages = msaExtractPageImagesFromDoc_(cfg, docId, folder);
  msaLog_("Extracted page-like images: " + pages.length);

  // OCR each page
  const ocrPages = [];
  if (pages.length > 0) {
    // Case A: Images found (Standard)
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p];
      const ocr = msaMathpixOcrFromDriveImage_(page.fileId, cfg, {
        formats: ["text", "latex_styled", "data"]
      });

      msaLog_(
        "Page " + page.page +
        " Mathpix: latex_styled length=" + ((ocr.latex_styled || "").length) +
        ", text length=" + ((ocr.text || "").length)
      );

      ocrPages.push({
        page: page.page,
        fileName: page.fileName,
        fileId: page.fileId,
        request_id: ocr.request_id || "",
        confidence: typeof ocr.confidence === "number" ? ocr.confidence : null,
        latex_styled: ocr.latex_styled || "",
        text: ocr.text || "",
        data: ocr.data || []
      });
    }
  } else {
    // Case B: No images found (Text-based Doc)
    msaLog_("No images found. Extracting text directly from Google Doc body.");
    const directPages = msaExtractTextFromDocDirectly_(docId);
    directPages.forEach(p => ocrPages.push(p));
  }

  // Save combined OCR artifacts
  const combined = msaBuildCombinedOcr_(cfg, docId, folder, ocrPages);
  msaUpsertTextFile_(folder, "markscheme_ocr_combined.txt", combined.readable);
  msaUpsertJsonFile_(folder, "markscheme_ocr_combined.json", combined.json);

  // Validation baseline (found marks, stats, etc.)
  const validation = msaBuildValidationReport_(cfg, docId, folder, ocrPages);

  // PREPARE OCR MAP for Atomizers (Pass 2 & 3 require line-by-line text per page)
  const ocrByPage = {};
  ocrPages.forEach(p => { ocrByPage[p.page] = (p.text || "").split(/\r?\n/); });

  // PASS 1: primary extraction
  // Call the robust Pass 1 (requires rules and null for skipMap)
  const rawPass1 = msaAtomizePass1_(ocrPages, rules.rules, null);
  const pass1 = {
    json: rawPass1,
    readable: JSON.stringify(rawPass1.points, null, 2)
  };
  msaUpsertJsonFile_(folder, "markscheme_points_pass1.json", rawPass1);
  msaUpsertTextFile_(folder, "markscheme_points_pass1_readable.txt", pass1.readable);

  // Decide if Pass2 should run
  const pass1Score = msaScorePointsOutput_(pass1.json, validation, cfg);
  const pass2ShouldRun = msaShouldTriggerPass2_(pass1.json, pass1Score, validation, cfg);

  let pass2 = null;
  if (pass2ShouldRun.trigger) {
    msaLog_(
      "Pass2 triggered. coverage=" + pass1Score.coverage.toFixed(2) +
      " structure=" + pass1Score.structure.toFixed(2)
    );

    // Pass 2 takes the RAW json object, not the wrapper
    const rawPass2 = msaAtomizerPass2_(pass1.json, ocrByPage);
    pass2 = {
      json: rawPass2,
      readable: JSON.stringify(rawPass2.points, null, 2)
    };

    msaUpsertJsonFile_(folder, "markscheme_points_pass2.json", rawPass2);
    msaUpsertTextFile_(folder, "markscheme_points_pass2_readable.txt", pass2.readable);
  } else {
    msaLog_(
      "Pass2 not triggered. coverage=" + pass1Score.coverage.toFixed(2) +
      " structure=" + pass1Score.structure.toFixed(2)
    );
  }

  // PASS 3: enrichment pass (always run on "winner" candidate)
  // Winner candidate is pass2 if it exists; otherwise pass1.
  const candidate = pass2 ? pass2 : pass1;

  // Pass 3 takes the RAW json object
  const rawPass3 = msaAtomizerPass3_(candidate.json, ocrByPage);
  const pass3 = {
    json: rawPass3,
    readable: JSON.stringify(rawPass3.points, null, 2)
  };

  msaUpsertJsonFile_(folder, "markscheme_points_pass3.json", rawPass3);
  msaUpsertTextFile_(folder, "markscheme_points_pass3_readable.txt", pass3.readable);

  // Choose BEST output (pass1 vs pass2 vs pass3)
  const best = msaPickBestOutput_(pass1, pass2, pass3, validation, cfg);

  // Always write best to a single stable filename for downstream grading
  msaUpsertJsonFile_(folder, "markscheme_points_best.json", best.best.json);
  msaUpsertTextFile_(folder, "markscheme_points_best_readable.txt", best.best.readable);

  // Final validation report includes best decision info
  validation.best_pass = best.bestPass;
  validation.best_file = "markscheme_points_best.json";
  validation.pass1 = best.metrics.pass1;
  if (best.metrics.pass2) validation.pass2 = best.metrics.pass2;
  if (best.metrics.pass3) validation.pass3 = best.metrics.pass3;

  msaUpsertTextFile_(folder, "markscheme_validation_report.txt", msaFormatValidationReport_(validation));
  msaUpsertJsonFile_(folder, "markscheme_validation_report.json", validation);

  // Preview artifacts (HTML + PNG copy of page 1 for quick Drive viewing)
  msaWritePreviewArtifacts_(cfg, docId, folder, combined, pages);

  // Summary logs
  msaLog_("DONE ✅ Folder: " + folder.getName());
  msaLog_("Pass1 points: " + pass1.json.points.length + " (warnings: " + pass1.json.warnings.length + ")");
  if (pass2) msaLog_("Pass2 points: " + pass2.json.points.length + " (warnings: " + pass2.json.warnings.length + ")");
  msaLog_("Pass3 points: " + pass3.json.points.length + " (warnings: " + pass3.json.warnings.length + ")");
  msaLog_("BEST = " + best.bestPass + " points=" + best.best.json.points.length);

  const dt = Math.round((Date.now() - t0) / 1000);
  msaLog_("=== MSA-VR (Validation & Repair) END === (duration " + dt + "s)");
}

/* =========================================================
 * Scoring / triggering / best-pick
 * ========================================================= */

function msaShouldTriggerPass2_(pointsJson, score, validation, cfg) {
  // Check if any points look like "A1A1" (double marks)
  const hasDoubleMarks = (pointsJson.points || []).some(p => /^([A-Z]\d+)\1$/i.test(p.mark || ""));

  const trigger = (
    hasDoubleMarks || // 🟢 Force trigger if A1A1 is found
    (score.coverage < cfg.MSA_PASS2_COVERAGE_TRIGGER) ||
    (score.structure < cfg.MSA_PASS2_STRUCTURE_TRIGGER) ||
    (score.duplicateReqRatio > cfg.MSA_PASS2_DUP_REQ_TRIGGER) ||
    (score.noteOnlyRatio > cfg.MSA_PASS2_NOTE_ONLY_TRIGGER)
  );

  return {
    trigger: trigger,
    reason: hasDoubleMarks ? "double_marks_detected" : (trigger ? "threshold" : "ok")
  };
}

function msaPickBestOutput_(pass1, pass2, pass3, validation, cfg) {
  const m1 = msaScorePointsOutput_(pass1.json, validation, cfg);
  let m2 = null;
  let m3 = null;

  if (pass2) m2 = msaScorePointsOutput_(pass2.json, validation, cfg);
  if (pass3) m3 = msaScorePointsOutput_(pass3.json, validation, cfg);

  let bestPass = "pass1";
  let best = pass1;
  let bestScore = m1.score;

  if (m2 && m2.score > bestScore) {
    bestPass = "pass2";
    best = pass2;
    bestScore = m2.score;
  }
  if (m3 && m3.score > bestScore) {
    bestPass = "pass3";
    best = pass3;
    bestScore = m3.score;
  }

  return {
    bestPass: bestPass,
    best: best,
    metrics: { pass1: m1, pass2: m2, pass3: m3 }
  };
}

/**
 * Heuristic scoring for "how good" an extracted points JSON is.
 * (Used for pass triggering + choosing best.)
 */
function msaScorePointsOutput_(pointsJson, validation, cfg) {
  const pts = (pointsJson && pointsJson.points) ? pointsJson.points : [];
  const warnings = (pointsJson && pointsJson.warnings) ? pointsJson.warnings : [];

  // Coverage: extracted / marks found (loose)
  const found = (validation && validation.looseMarksFoundTotal) ? validation.looseMarksFoundTotal : 0;
  const extracted = pts.length;
  const coverage = found > 0 ? (extracted / found) : 1.0;

  // Duplicate requirements ratio (rough)
  const reqs = pts.map(p => String(p.requirement || "").trim()).filter(Boolean);
  const uniq = {};
  reqs.forEach(r => { uniq[r] = (uniq[r] || 0) + 1; });
  const dupCount = Object.keys(uniq).filter(k => uniq[k] > 1).length;
  const duplicateReqRatio = reqs.length > 0 ? (dupCount / reqs.length) : 0;

  // Note-only ratio (requirements that are basically Notes)
  const noteOnlyCount = pts.filter(p => {
    const r = String(p.requirement || "").trim().toLowerCase();
    return r.startsWith("note:") || r.startsWith("award ") || r.startsWith("accept ");
  }).length;
  const noteOnlyRatio = pts.length > 0 ? (noteOnlyCount / pts.length) : 0;

  // Structure score: basic sanity checks
  let structure = 1.0;

  // penalty for missing part labels
  const unknownParts = pts.filter(p => String(p.part || "").trim() === "" || String(p.part || "").indexOf("unknown") >= 0).length;
  if (pts.length > 0) structure -= 0.2 * (unknownParts / pts.length);

  // penalty for very short requirements (often “a correct numerator” is OK, but empty-ish is not)
  const tooShort = pts.filter(p => String(p.requirement || "").trim().length < 6).length;
  if (pts.length > 0) structure -= 0.2 * (tooShort / pts.length);

  // clamp
  structure = Math.max(0, Math.min(1, structure));

  // Score weighting (tweakable)
  // Higher is better.
  let score = 0;
  score += 100 * coverage;
  score += 20 * structure;
  score -= 25 * duplicateReqRatio;
  score -= 25 * noteOnlyRatio;
  score -= 2 * warnings.length;

  return {
    extracted: extracted,
    found: found,
    coverage: coverage,
    structure: structure,
    duplicateReqRatio: duplicateReqRatio,
    noteOnlyRatio: noteOnlyRatio,
    warnings: warnings.length,
    score: score
  };
}

/* =========================================================
 * Validation report builder
 * ========================================================= */

function msaBuildValidationReport_(cfg, docId, folder, ocrPages) {
  const started = new Date();
  const meta = msaGetDocMeta_(cfg, docId);

  const pageStats = ocrPages.map(p => ({
    page: p.page,
    confidence: p.confidence,
    text_len: (p.text || "").length,
    latex_styled_len: (p.latex_styled || "").length,
    request_id: p.request_id
  }));

  const allText = ocrPages.map(p => p.text || "").join("\n\n");
  const strict = msaCountMarkTokensStrict_(allText);
  const loose = msaCountMarkTokensLoose_(allText);

  const report = {
    process: "Markscheme Atomization (MSA)",
    doc_title: meta.title,
    doc_id: docId,
    run_started_iso: started.toISOString(),
    run_ended_iso: null,
    duration_seconds: null,

    pages_detected_after_dedupe: ocrPages.length,
    saved_page_files: ocrPages.map(p => p.fileName),

    ocr_page_stats: pageStats,

    strictMarksFoundTotal: strict.total,
    strictMarksFoundByType: strict.byType,

    looseMarksFoundTotal: loose.total,
    looseMarksFoundByType: loose.byType
  };

  report.run_ended_iso = new Date().toISOString();
  report.duration_seconds = Math.round((new Date(report.run_ended_iso) - new Date(report.run_started_iso)) / 1000);

  return report;
}

function msaFormatValidationReport_(validation) {
  const v = validation;

  const lines = [];
  lines.push("MARKSCHEME VALIDATION REPORT (Markscheme Atomization (MSA))");
  lines.push("Doc title: " + (v.doc_title || ""));
  lines.push("Doc ID: " + (v.doc_id || ""));
  lines.push("Run started: " + (v.run_started_iso || ""));
  lines.push("Run ended:   " + (v.run_ended_iso || ""));
  if (v.duration_seconds != null) lines.push("Duration: " + v.duration_seconds + "s");
  lines.push("");

  lines.push("Pages detected (after image dedupe): " + v.pages_detected_after_dedupe);
  lines.push("Saved page files: " + (v.saved_page_files || []).join(", "));
  lines.push("");

  lines.push("OCR PAGE STATS:");
  (v.ocr_page_stats || []).forEach(s => {
    lines.push(
      "- Page " + s.page +
      ": confidence=" + s.confidence +
      ", text_len=" + s.text_len +
      ", latex_styled_len=" + s.latex_styled_len +
      ", request_id=" + s.request_id
    );
  });
  lines.push("");

  lines.push("MARKS FOUND IN OCR (STRICT mark-lines only):");
  lines.push("Total strict marks found: " + v.strictMarksFoundTotal);
  Object.keys(v.strictMarksFoundByType || {}).forEach(k => {
    lines.push("  " + k + ": " + v.strictMarksFoundByType[k]);
  });
  lines.push("");

  lines.push("MARKS FOUND IN OCR (LOOSE tokens, avoids Award/Note lines where possible):");
  lines.push("Total loose marks found: " + v.looseMarksFoundTotal);
  Object.keys(v.looseMarksFoundByType || {}).forEach(k => {
    lines.push("  " + k + ": " + v.looseMarksFoundByType[k]);
  });
  lines.push("");

  if (v.pass1) {
    lines.push("PASS 1:");
    lines.push("- Extracted points: " + v.pass1.extracted);
    lines.push("- Coverage (extracted/looseFound): " + v.pass1.coverage.toFixed(2));
    lines.push("- Structure score: " + v.pass1.structure.toFixed(2));
    lines.push("- Duplicate req ratio: " + v.pass1.duplicateReqRatio.toFixed(2));
    lines.push("- Note-only ratio: " + v.pass1.noteOnlyRatio.toFixed(2));
    lines.push("- Score: " + v.pass1.score);
    lines.push("");
  }

  if (v.pass2) {
    lines.push("PASS 2:");
    lines.push("- Extracted points: " + v.pass2.extracted);
    lines.push("- Coverage (extracted/looseFound): " + v.pass2.coverage.toFixed(2));
    lines.push("- Structure score: " + v.pass2.structure.toFixed(2));
    lines.push("- Duplicate req ratio: " + v.pass2.duplicateReqRatio.toFixed(2));
    lines.push("- Note-only ratio: " + v.pass2.noteOnlyRatio.toFixed(2));
    lines.push("- Score: " + v.pass2.score);
    lines.push("");
  }

  if (v.pass3) {
    lines.push("PASS 3:");
    lines.push("- Extracted points: " + v.pass3.extracted);
    lines.push("- Coverage (extracted/looseFound): " + v.pass3.coverage.toFixed(2));
    lines.push("- Structure score: " + v.pass3.structure.toFixed(2));
    lines.push("- Duplicate req ratio: " + v.pass3.duplicateReqRatio.toFixed(2));
    lines.push("- Note-only ratio: " + v.pass3.noteOnlyRatio.toFixed(2));
    lines.push("- Score: " + v.pass3.score);
    lines.push("");
  }

  if (v.best_pass) {
    lines.push("BEST OUTPUT:");
    lines.push("- best_pass: " + v.best_pass);
    lines.push("- best_file: " + v.best_file);
    lines.push("");
    lines.push("Interpretation tips:");
    lines.push("- If coverage is high but structure score is low, the parser is probably attaching Note/Award lines poorly or duplicating requirements.");
    lines.push("- Pass2 triggers on structure problems, not just missing marks.");
    lines.push("- Downstream grading should always use markscheme_points_best.json.");
  }

  return lines.join("\n");
}

/* =========================================================
 * Mark token counters
 * ========================================================= */

function msaCountMarkTokensStrict_(text) {
  // “Strict” = marks that appear as their own lines (e.g., "(M1)" or "A1")
  const lines = String(text || "").split(/\r?\n/);
  const byType = {};
  let total = 0;

  lines.forEach(line => {
    const s = String(line || "").trim();
    if (!s) return;

    // common strict patterns
    const m = s.match(/^\(?\s*([A-Z]{1,2}\d)\s*\)?$/);
    if (m && m[1]) {
      const tok = m[1];
      byType[tok] = (byType[tok] || 0) + 1;
      total++;
    }
  });

  return { total: total, byType: byType };
}

function msaCountMarkTokensLoose_(text) {
  // “Loose” = marks found anywhere, but avoid counting Award/Note explanation lines where possible
  const lines = String(text || "").split(/\r?\n/);
  const byType = {};
  let total = 0;

  lines.forEach(line => {
    const s = String(line || "").trim();
    if (!s) return;

    // Skip lines that are clearly just instructions / meta
    const lower = s.toLowerCase();
    if (lower.startsWith("note:") || lower.startsWith("award ") || lower.startsWith("accept ")) {
      return;
    }

    // find tokens like A1, M1, R1, etc. Use a regex without word boundaries
    // to correctly count joined marks like A1A1.
    const matches = s.match(/[A-Z]{1,2}\d/g);
    if (!matches) return;

    matches.forEach(tok => {
      byType[tok] = (byType[tok] || 0) + 1;
      total++;
    });
  });

  return { total: total, byType: byType };
}

/* =========================================================
 * Question meta (skip map) loader
 * ========================================================= */

function msaLoadQuestionMetaSkipMap_(cfg) {
  try {
    const ss = SpreadsheetApp.openById(cfg.MSA_QUESTION_META_SHEET_ID);
    const sh = ss.getSheetByName(cfg.MSA_QUESTION_META_SHEET_TAB) || ss.getSheets()[0];
    const values = sh.getDataRange().getValues();

    // Expect header row. We’ll try to find:
    // - question_id / doc_id
    // - command_term
    // - skip_automated_grading (optional)
    const header = values[0].map(v => String(v || "").trim().toLowerCase());
    const idxDoc = header.indexOf("doc_id") >= 0 ? header.indexOf("doc_id") : header.indexOf("question_id");
    const idxCmd = header.indexOf("command_term");
    const idxSkip = header.indexOf("skip_automated_grading");

    if (idxDoc < 0 || idxCmd < 0) return null;

    const skipMap = {};
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const did = String(row[idxDoc] || "").trim();
      const cmd = String(row[idxCmd] || "").trim().toLowerCase();
      const skip = idxSkip >= 0 ? String(row[idxSkip] || "").trim().toLowerCase() : "";

      if (!did) continue;

      const shouldSkip = (skip === "true" || skip === "1" || skip === "yes");
      skipMap[did] = { command_term: cmd, skip_auto: shouldSkip };
    }

    return Object.keys(skipMap).length ? skipMap : null;
  } catch (e) {
    msaWarn_("skipMap: could not load question meta sheet (non-fatal): " + e.message);
    return null;
  }
}
