/************************
 * MSA_RunAndValidate.gs
 ************************/

function runMSA_VR_Batch() {
  msaLog_("=== MSA-VR (Validation & Repair) BATCH START ===");

  const docIds = [
    "1Q0j5sk0-2xQWPEAS4NIO6jBq02IJvnNFvjc4cJJQu88",
    "1ogg4P9-_Q5-7GVgrtIbo355WjhYgoYs7Mjk0OOjO7Ho",
    "1zfGnVJHtGxrEGCVLR7PTsYFwcsbpyRU1aOcyO6MdNN4",
    "17VFlp49U15wcbOoSP7wNUdraz3TjElwYwyvavLErec8",
    "10JpdOR7L4xDl9gN0Ixckplf9kVLPTSmwRQ7cpeoQRdY"
  ];

  const cfg = msaGetConfig_();
  for (let i = 0; i < docIds.length; i++) {
    const docId = docIds[i];

    if (msaCheckIfReconciled_(cfg, docId)) {
      msaLog_(`Skipping ${docId} - already marked as reconciled.`);
      continue;
    }

    try {
      runMSA_VR_One(docId);
    } catch (e) {
      msaErr_("Batch: failed for docId=" + docId + " | " + (e && e.stack ? e.stack : e));
    }
  }

  msaLog_("=== MSA-VR (Validation & Repair) BATCH END ===");
}

function runMSA_VR_One_ForWebApp(docId) {
  const { ocrPages } = _getOcrPages(docId);
  return _runMsaPipeline(docId, ocrPages);
}

function _runMsaPipeline(docId, ocrPages) {
  msaLog_(`_runMsaPipeline: Started for docId=${docId}. Received ${ocrPages.length} OCR pages.`);
  const cfg = msaGetConfig_();
  const rules = msaLoadGradingRules_(cfg);
  const folder = msaGetOrCreateQuestionFolder_(cfg, docId);

  const combined = msaBuildCombinedOcr_(cfg, docId, folder, ocrPages);
  msaUpsertTextFile_(folder, "markscheme_ocr_combined.txt", combined.readable);
  msaUpsertJsonFile_(folder, "markscheme_ocr_combined.json", combined.json);

  const allOcrText = ocrPages.map(p => p.text || "").join("\n");
  let officialTotalMarks = null;
  const totalMarksRegex = /(?:Total\s*:?\s*)?\[\s*(?:Total\s*:?\s*)?(\d+)\s*marks?\s*\]/ig;
  const allMatches = allOcrText.match(totalMarksRegex);
  if (allMatches && allMatches.length > 0) {
    const lastMatchStr = allMatches[allMatches.length - 1];
    const finalMatch = lastMatchStr.match(/(?:Total\s*:?\s*)?\[\s*(?:Total\s*:?\s*)?(\d+)\s*marks?\s*\]/i);
    if (finalMatch && finalMatch[1]) {
      officialTotalMarks = parseInt(finalMatch[1], 10);
    }
  }

  const validation = msaBuildValidationReport_(cfg, docId, folder, ocrPages);
  const ocrByPage = {};
  ocrPages.forEach(p => { ocrByPage[p.page] = (p.text || "").split(/\r?\n/); });

  const rawPass1 = msaAtomizePass1_(ocrPages, rules.rules, null);
  const pass1 = { json: rawPass1, readable: JSON.stringify(rawPass1.points, null, 2) };
  const pass1Score = msaScorePointsOutput_(pass1.json, validation, cfg);
  const pass2ShouldRun = msaShouldTriggerPass2_(pass1.json, pass1Score, validation, cfg);
  
  let pass2 = null;
  if (pass2ShouldRun.trigger) {
    const rawPass2 = msaAtomizerPass2_(pass1.json, ocrByPage);
    pass2 = { json: rawPass2, readable: JSON.stringify(rawPass2.points, null, 2) };
  }
  const candidate = pass2 ? pass2 : pass1;
  const rawPass3 = msaAtomizerPass3_(candidate.json, ocrByPage);
  const pass3 = { json: rawPass3, readable: JSON.stringify(rawPass3.points, null, 2) };
  const best = msaPickBestOutput_(pass1, pass2, pass3, validation, cfg);

  msaUpsertJsonFile_(folder, "markscheme_points_pass1.json", rawPass1);
  if (pass2) msaUpsertJsonFile_(folder, "markscheme_points_pass2.json", pass2.json);
  msaUpsertJsonFile_(folder, "markscheme_points_pass3.json", rawPass3);
  msaUpsertJsonFile_(folder, "markscheme_points_best.json", best.best.json);
  msaUpsertTextFile_(folder, "markscheme_points_best_readable.txt", best.best.readable);

  msaWritePreviewArtifacts_(cfg, docId, folder, combined, ocrPages);

  const extractedScoreInfo = msaCalculateTotalPossibleScore_(best.best.json.points);
  const officialTotal = officialTotalMarks;
  const extractedTotal = extractedScoreInfo.total;

  if (officialTotal !== null && extractedTotal !== officialTotal) {
    msaDeleteFileIfExists_(folder, "_RECONCILED.txt");
    return {
      status: 'NEEDS_REVIEW',
      doc_id: docId,
      doc_title: validation.doc_title,
      officialTotal: officialTotal,
      calculatedTotal: extractedTotal,
      ocrText: combined.readable,
      folderUrl: folder.getUrl(),
      ocrPages: ocrPages,
      pass1_points: rawPass1.points.length,
      best_pass: best.bestPass,
      score_breakdown: extractedScoreInfo.breakdown
    };
  } else {
    if (officialTotal !== null) msaUpsertTextFile_(folder, "_RECONCILED.txt", `Reconciled on: ${new Date().toISOString()}`);
    return {
      status: 'SUCCESS',
      doc_id: docId,
      doc_title: validation.doc_title,
      officialTotal: officialTotal,
      calculatedTotal: extractedTotal,
      best_pass: best.bestPass,
      score_breakdown: extractedScoreInfo.breakdown
    };
  }
}

function runMSA_VR_One(docId) {
  const t0 = Date.now();
  msaLog_("=== MSA-VR START === docId=" + docId);
  const { ocrPages, folder } = _getOcrPages(docId);
  const result = _runMsaPipeline(docId, ocrPages);

  msaLog_("BEST = " + result.best_pass + " Extracted Total: " + result.calculatedTotal);
  if (result.status === 'NEEDS_REVIEW') {
    msaWarn_("Discrepancy: Official " + result.officialTotal + " vs Extracted " + result.calculatedTotal);
  }
  const dt = Math.round((Date.now() - t0) / 1000);
  msaLog_("=== MSA-VR END === (" + dt + "s)");
}

/**
 * UPDATED: Uses Drastic Tiling Strategy for OCR
 */
function _getOcrPages(docId) {
  const cfg = msaGetConfig_();
  const folder = msaGetOrCreateQuestionFolder_(cfg, docId);
  const pages = msaExtractPageImagesFromDoc_(cfg, docId, folder);
  const ocrPages = [];

  if (pages.length > 0) {
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p];
      msaLog_(`Page ${page.page} - Applying Drastic Tiling OCR.`);

      const GRID_SIZE = 3; 
      const OVERLAP = 0.15; 
      const tileWidth = 1 / GRID_SIZE;
      const tileHeight = 1 / GRID_SIZE;
      const regions = [];

      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const x = col * tileWidth;
          const y = row * tileHeight;
          const overlapX = tileWidth * OVERLAP;
          const overlapY = tileHeight * OVERLAP;
          const region = {
            top_left_x: Math.max(0, x - overlapX),
            top_left_y: Math.max(0, y - overlapY),
            width: tileWidth + (2 * overlapX),
            height: tileHeight + (2 * overlapY)
          };
          if (region.top_left_x + region.width > 1) region.width = 1 - region.top_left_x;
          if (region.top_left_y + region.height > 1) region.height = 1 - region.top_left_y;
          regions.push(region);
        }
      }

      const uniqueLines = new Set();
      regions.forEach((region, index) => {
        msaLog_(`Page ${page.page} - Scanning tile ${index + 1}/${regions.length}: x:${region.top_left_x.toFixed(2)}, y:${region.top_left_y.toFixed(2)}, w:${region.width.toFixed(2)}, h:${region.height.toFixed(2)}`);
        const tileOcr = msaMathpixOcrFromDriveImage_(page.fileId, cfg, { region: region });
        if (tileOcr && tileOcr.text && tileOcr.text.trim() !== '') {
          msaLog_(`   > Tile ${index + 1} found text length: ${tileOcr.text.length}. First 50 chars: "${tileOcr.text.substring(0,50).replace(/\n/g, ' ')}"`);
          tileOcr.text.split('\n').forEach(line => {
            if (line.trim() !== '') uniqueLines.add(line.trim());
          });
        } else {
          msaLog_(`   > Tile ${index + 1} found no text.`);
        }
      });

      const combinedText = Array.from(uniqueLines).join('\n');
      msaLog_(`Page ${page.page}: Tiling strategy produced combined text length: ${combinedText.length}`);
      ocrPages.push({
        page: page.page,
        fileName: page.fileName,
        fileId: page.fileId,
        request_id: "tiling_strategy",
        confidence: null,
        latex_styled: combinedText,
        text: combinedText,
        data: []
      });
    }
  } else {
    const directPages = msaExtractTextFromDocDirectly_(docId);
    directPages.forEach(p => ocrPages.push(p));
  }
  return { ocrPages: ocrPages, folder: folder };
}

/* --- Scoring & Utilities --- */

function msaShouldTriggerPass2_(pointsJson, score, validation, cfg) {
  const hasCompoundMarks = (pointsJson.points || []).some(p => msaSplitCompoundMark_(p.mark));
  const trigger = (hasCompoundMarks || score.coverage < cfg.MSA_PASS2_COVERAGE_TRIGGER);
  return { trigger: trigger, reason: hasCompoundMarks ? "compound_marks" : "threshold" };
}

function msaPickBestOutput_(pass1, pass2, pass3, validation, cfg) {
  const m1 = msaScorePointsOutput_(pass1.json, validation, cfg);
  let best = pass1, bestPass = "pass1", bestScore = m1.score;

  if (pass2) {
    const m2 = msaScorePointsOutput_(pass2.json, validation, cfg);
    if (m2.score > bestScore) { best = pass2; bestPass = "pass2"; bestScore = m2.score; }
  }
  if (pass3) {
    const m3 = msaScorePointsOutput_(pass3.json, validation, cfg);
    if (m3.score > bestScore) { best = pass3; bestPass = "pass3"; }
  }
  return { bestPass: bestPass, best: best };
}

function msaScorePointsOutput_(pointsJson, validation, cfg) {
  const pts = pointsJson.points || [];
  const found = (validation && validation.looseMarksFoundTotal) || 0;
  const coverage = found > 0 ? (pts.length / found) : 1.0;
  return { coverage: coverage, score: (coverage * 100) - (pointsJson.warnings || []).length };
}

function msaBuildValidationReport_(cfg, docId, folder, ocrPages) {
  const meta = msaGetDocMeta_(cfg, docId);
  const allText = ocrPages.map(p => p.text || "").join("\n\n");
  return {
    doc_title: meta.title,
    doc_id: docId,
    pages_detected_after_dedupe: ocrPages.length,
    looseMarksFoundTotal: msaCountMarkTokensLoose_(allText).total
  };
}

function msaCountMarkTokensLoose_(text) {
  const lines = String(text || "").split(/\r?\n/);
  let total = 0;
  lines.forEach(line => {
    const s = line.trim();
    if (!s || /note:|award |accept /i.test(s)) return;
    const matches = s.match(/[A-Z]{1,2}\d/g);
    if (matches) total += matches.length;
  });
  return { total: total };
}