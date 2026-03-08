/********************************
 * WebApp.gs
 *
 * Server-side logic for the MSA Validation & Repair UI.
 * 
 * NOTE: The main doGet() is now in ExamSystem_Integration.js
 * which serves the new Exam Management UI by default.
 ********************************/

function _findDocByTitle(title) {
  const cfg = msaGetConfig_();
  const sourceFolderId = cfg.MSA_PARENT_FOLDER_ID;
  if (!sourceFolderId) {
    throw new Error("The MSA_PARENT_FOLDER_ID is not set in your MSA_Config.js file.");
  }
  const folder = DriveApp.getFolderById(sourceFolderId);
  const files = folder.getFilesByName(title);
  if (!files.hasNext()) {
    throw new Error(`Document with title "${title}" not found in the parent folder.`);
  }
  const file = files.next();
  if (files.hasNext()) {
    msaWarn_(`Multiple documents found with title "${title}". Using the first one found.`);
  }
  return file;
}

/**
 * Called by the UI to process a single document.
 * This is the entry point for the initial OCR and parse.
 */
function processSingleDocByTitle(title) {
  const file = _findDocByTitle(title);
  return runMSA_VR_One_ForWebApp(file.getId());
}

/**
 * Called by the UI to re-process a document with corrected OCR text.
 */
function reprocessWithCorrection(docId, correctedOcrText, originalOcrPages) {
  // The user edited the combined text. We will replace the text of all pages with this single block,
  // treating it as a single, corrected page. This is simple and robust.
  const correctedPages = [{
    page: 1,
    text: correctedOcrText,
    // Preserve metadata from the original first page for consistency
    fileName: (originalOcrPages && originalOcrPages[0]) ? originalOcrPages[0].fileName : 'corrected_page_1.png',
    fileId: (originalOcrPages && originalOcrPages[0]) ? originalOcrPages[0].fileId : '',
    latex_styled: correctedOcrText, // Use corrected text as fallback
    confidence: 1.0, // Manually corrected, so confidence is 1.0
    request_id: "manual_correction",
    data: [] // Data field is complex, safe to clear it for corrected text
  }];
  return _runMsaPipeline(docId, correctedPages);
}

/**
 * Called by the UI to get the data needed for the comparison view.
 * @param {string} title The title (question code) of the document to compare.
 * @returns {object} An object containing the source doc URL and the preview HTML.
 */
function getPreviewDataByTitle(title) {
  const file = _findDocByTitle(title);
  const docId = file.getId();

  const cfg = msaGetConfig_();
  // Assumes msaFindQuestionFolderByDocId_ is available from MSA_Helpers_And_Pass1.js
  const folder = msaFindQuestionFolderByDocId_(cfg, docId);
  if (!folder) {
    // Instead of throwing, return a specific status object for the UI to handle.
    return { status: 'NOT_PROCESSED', docId: docId, title: title, message: "Output folder not found. Please process the document first." };
  }

  const sourceDocUrl = DriveApp.getFileById(docId).getUrl();

  const previewFileIterator = folder.getFilesByName("markscheme_preview.html");
  if (!previewFileIterator.hasNext()) {
    // This is also a state where processing is incomplete.
    return { status: 'NOT_PROCESSED', docId: docId, title: title, message: "'markscheme_preview.html' not found. Please re-process the document." };
  }
  const previewHtml = previewFileIterator.next().getBlob().getDataAsString();

  // Also fetch the new structured preview, if it exists.
  const structuredPreviewFileIterator = folder.getFilesByName("markscheme_structured_preview.html");
  let structuredPreviewHtml = null;
  if (structuredPreviewFileIterator.hasNext()) {
    structuredPreviewHtml = structuredPreviewFileIterator.next().getBlob().getDataAsString();
  }

  return { status: 'SUCCESS', sourceDocUrl: sourceDocUrl, previewHtml: previewHtml, structuredPreviewHtml: structuredPreviewHtml };
}

/**
 * Called by the UI to run a batch process on unreconciled documents.
 * To prevent timeouts, this will only process a limited number of documents at a time.
 * @param {number} [limit=5] The maximum number of documents to process in this batch.
 * @returns {string} A summary message of the batch operation.
 */
function runBatchOnUnreconciled(limit) {
  const BATCH_LIMIT = limit || 5;
  msaLog_(`Starting batch process with a limit of ${BATCH_LIMIT} documents.`);

  try {
    const cfg = msaGetConfig_();
    const sourceFolderId = cfg.MSA_PARENT_FOLDER_ID;
    if (!sourceFolderId) {
      throw new Error("The MSA_PARENT_FOLDER_ID is not set in your MSA_Config.js file.");
    }

    const folder = DriveApp.getFolderById(sourceFolderId);
    const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    
    const unreconciledIds = [];
    while (files.hasNext()) {
      const file = files.next();
      const docId = file.getId();
      // The msaCheckIfReconciled_ function returns true if a "_RECONCILED.txt" file exists.
      if (!msaCheckIfReconciled_(cfg, docId)) {
        unreconciledIds.push(docId);
      }
    }

    const totalUnreconciled = unreconciledIds.length;
    if (totalUnreconciled === 0) {
      msaLog_("Batch complete: No unreconciled documents found.");
      return "Batch complete: No unreconciled documents found.";
    }

    const docsToProcess = unreconciledIds.slice(0, BATCH_LIMIT);
    let successCount = 0;
    let errorCount = 0;

    msaLog_(`Found ${totalUnreconciled} unreconciled documents. Processing the first ${docsToProcess.length}.`);

    docsToProcess.forEach(docId => {
      try {
        msaLog_(`Batch processing: ${docId}`);
        runMSA_VR_One_ForWebApp(docId);
        successCount++;
      } catch (e) {
        msaErr_(`Error processing ${docId} in batch: ${e.message}`);
        errorCount++;
      }
    });

    const remaining = totalUnreconciled - docsToProcess.length;
    const summary = `Batch finished. Processed: ${successCount}. Errors: ${errorCount}. Remaining unreconciled: ${remaining}.`;
    msaLog_(summary);
    return summary;

  } catch (e) {
    msaErr_(`Fatal error during batch process: ${e.stack}`);
    throw new Error(`Batch process failed. Details: ${e.message}`);
  }
}

/**
 * Test OCR on a single student work image (for MSA UI testing).
 * This provides a single-question test case for the full exam system workflow.
 * @param {string} fileId The Google Drive File ID of the student work image.
 * @param {object} options Optional settings like {detectMarkers: true}
 * @returns {object} OCR result with image URL, text, confidence, etc.
 */
function testStudentWorkOcr(fileId, options = {}) {
  // Activate log streaming if client passed a session ID
  if (options.logSessionId) {
    setLogSession_(options.logSessionId);
  }
  var T = Date.now(); // pipeline epoch
  var tPhase;         // per-phase timer
  try {
    msaLog_('═══════════════════════════════════════════');
    msaLog_('▶ STUDENT WORK OCR PIPELINE — starting');
    msaLog_('  stages: FETCH→OCR→QR→CROP→CLEAN→IMAGE→PACKAGE');
    msaLog_('  fileId: ' + fileId);
    msaLog_('  opts: qCode=' + (options.questionCode || 'null') + ' sId=' + (options.studentId || 'null') + ' pos=' + (options.position || 'null') + ' markers=' + (options.detectMarkers !== false) + ' crop=' + (options.cropRegion ? 'manual' : 'null'));
    msaLog_('═══════════════════════════════════════════');

    // ─── PHASE 1: FETCH ───
    tPhase = Date.now();
    // Validate file ID format before hitting Drive API
    if (!fileId || typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId.trim())) {
      throw new Error('Invalid file ID format: "' + fileId + '". Expected a Google Drive file ID (alphanumeric, 10+ chars). If you pasted a URL, the client should have extracted the ID automatically.');
    }
    fileId = fileId.trim();
    msaLog_('[1/7 FETCH] DriveApp.getFileById(' + fileId + ') len=' + fileId.length);
    var file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (driveErr) {
      msaErr_('[1/7 FETCH] FAIL Δ' + (Date.now() - tPhase) + 'ms — ' + driveErr.message);
      throw new Error(
        'Cannot access file "' + fileId + '". ' +
        'Verify: (1) the file exists in Google Drive, ' +
        '(2) it is shared with or owned by the script owner, ' +
        '(3) it has not been trashed. ' +
        'Original error: ' + driveErr.message
      );
    }
    const mimeType = file.getMimeType();
    const fileName = file.getName();
    var fileSizeBytes = file.getSize();
    msaLog_('[1/7 FETCH] OK name="' + fileName + '" mime=' + mimeType + ' size=' + fileSizeBytes + 'B (' + Math.round(fileSizeBytes / 1024) + 'KB) Δ' + (Date.now() - tPhase) + 'ms');
    
    // Verify it's an image
    if (!mimeType.startsWith('image/')) {
      throw new Error('File must be an image (got ' + mimeType + '). PDF support coming soon.');
    }
    
    const cfg = msaGetConfig_();
    
    let cropInfo = null;
    let markersDetected = false;
    let ocrResult;
    let detectedQuestionCode = options.questionCode || null;
    let detectedStudentId = options.studentId || null;
    let detectedExamName = options.examName || null;
    let detectedPosition = options.position || null;
    
    // ─── PHASE 2: OCR ───
    tPhase = Date.now();
    msaLog_('───────────────────────────────────────────');
    msaLog_('[2/7 OCR] msaMathpixOcrFromDriveImage_ fileId=' + fileId + ' opts={line_data:true,geometry:true}');

    const fullOcrResult = msaMathpixOcrFromDriveImage_(fileId, cfg, { 
      include_line_data: true,
      include_geometry: true 
    });
    
    ocrResult = fullOcrResult;
    const imageWidth = fullOcrResult.image_width || 1000;
    const imageHeight = fullOcrResult.image_height || 1000;
    var ocrTextLen = (fullOcrResult.text || '').length;
    var ocrLineCount = (fullOcrResult.line_data || []).length;
    var ocrConfRaw = fullOcrResult.confidence || 0;
    var hasMathChars = (fullOcrResult.text || '').includes('\\');
    msaLog_('[2/7 OCR] DONE img=' + imageWidth + '×' + imageHeight + 'px lines=' + ocrLineCount + ' chars=' + ocrTextLen + ' conf=' + (ocrConfRaw * 100).toFixed(1) + '% math=' + hasMathChars + ' err=' + (fullOcrResult.error || 'none') + ' Δ' + (Date.now() - tPhase) + 'ms');
    
    // ─── PHASE 3: QR ───
    tPhase = Date.now();
    msaLog_('───────────────────────────────────────────');
    if (!detectedQuestionCode) {
      msaLog_('[3/7 QR] No qCode supplied — scanning for QR. decodeQrFromImage(' + fileId + ')');
      var qrData = decodeQrFromImage(fileId);
      msaLog_('[3/7 QR] raw return=' + JSON.stringify(qrData).substring(0, 300));
      if (qrData) {
        if (qrData.questionCode) {
          detectedQuestionCode = qrData.questionCode;
        } else if (qrData.q) {
          detectedQuestionCode = qrData.q;
        }
        detectedStudentId = qrData.studentId || qrData.s || detectedStudentId;
        detectedExamName = qrData.examName || qrData.e || detectedExamName;
        msaLog_('[3/7 QR] DECODED qCode=' + (detectedQuestionCode || 'null') + ' sId=' + (detectedStudentId || 'null') + ' exam=' + (detectedExamName || 'null') + ' Δ' + (Date.now() - tPhase) + 'ms');
        if (qrData.raw) msaLog_('[3/7 QR] raw QR payload=' + JSON.stringify(qrData.raw).substring(0, 300));
      } else {
        msaLog_('[3/7 QR] NO QR found — API returned null. Image may not contain a readable QR code. Δ' + (Date.now() - tPhase) + 'ms');
      }
    } else {
      msaLog_('[3/7 QR] SKIP — qCode already set: ' + detectedQuestionCode + ' Δ0ms');
    }
    
    // AUTO-DETECT: question number from OCR text when QR gave us nothing
    if (!detectedQuestionCode) {
      var ocrTextForDetect = (fullOcrResult.text || '');
      // Look for "N. [Maximum mark: M]" pattern typical of IB exam pages
      var qNumMatch = ocrTextForDetect.match(/(\d{1,2})\.\s*\[(?:Mm)aximum\s+mark[:\s]+(\d+)\]/);
      if (qNumMatch) {
        msaLog_('[3/7 QR] OCR-detect: found questionNum=' + qNumMatch[1] + ' maxMark=' + qNumMatch[2] + ' — but no full question code (e.g. 22M.1.SL.TZ1.' + qNumMatch[1] + ')');
        // We know the question number but not the full code (paper, TZ, etc.)
        // Store as partial for logging but can't look up box coords without full code
      }
      msaLog_('[3/7 QR] detectedQuestionCode remains null — crop will fall through to markers or full image');
    }
    
    // AUTO-DETECT: position (Q1 vs Q2+)
    if (!detectedPosition) {
      var isQ1 = detectIfQ1FromOcr(fullOcrResult);
      detectedPosition = isQ1 ? "Q1" : "Q2+";
      msaLog_('[3/7 QR] autoPos=' + detectedPosition + ' (SectionA=' + isQ1 + ')');
    }
    
    // ─── PHASE 4: CROP ───
    tPhase = Date.now();
    msaLog_('───────────────────────────────────────────');
    msaLog_('[4/7 CROP] cascade: storedCoords→markers→manual→full. qCode=' + (detectedQuestionCode || 'null') + ' pos=' + detectedPosition);
    var cropMethod = 'none';

    // OPTION 1: Stored box coordinates
    if (detectedQuestionCode) {
      msaLog_('[4/7 CROP] OPT1 lookupBoxCoordinates(' + detectedQuestionCode + ',' + detectedPosition + ')');
      const storedCoords = lookupBoxCoordinates(detectedQuestionCode, detectedPosition);
      if (storedCoords) {
        cropInfo = {
          x1: Math.round(imageWidth * storedCoords.xPct / 100),
          y1: Math.round(imageHeight * storedCoords.yPct / 100),
          x2: Math.round(imageWidth * (storedCoords.xPct + storedCoords.widthPct) / 100),
          y2: Math.round(imageHeight * (storedCoords.yPct + storedCoords.heightPct) / 100)
        };
        cropInfo.width = cropInfo.x2 - cropInfo.x1;
        cropInfo.height = cropInfo.y2 - cropInfo.y1;
        markersDetected = true;
        cropMethod = 'stored';
        msaLog_('[4/7 CROP] OPT1 HIT rect=(' + cropInfo.x1 + ',' + cropInfo.y1 + ')→(' + cropInfo.x2 + ',' + cropInfo.y2 + ') ' + cropInfo.width + '×' + cropInfo.height + 'px');
        ocrResult = filterOcrResultsByRegion(fullOcrResult, cropInfo);
        msaLog_('[4/7 CROP] filtered: ' + ocrLineCount + '→' + (ocrResult.line_data || []).length + ' lines');
      } else {
        msaLog_('[4/7 CROP] OPT1 MISS no stored coords');
      }
    }
    
    // OPTION 2: Corner markers
    if (!markersDetected && options.detectMarkers !== false) {
      msaLog_('[4/7 CROP] OPT2 findCornerMarkersInOcrResult()');
      const markers = findCornerMarkersInOcrResult(fullOcrResult);
      
      if (markers.length === 4) {
        cropInfo = calculateBoundingRectFromMarkers(markers);
        markersDetected = true;
        cropMethod = 'markers';
        msaLog_('[4/7 CROP] OPT2 HIT 4 markers rect=(' + cropInfo.x1 + ',' + cropInfo.y1 + ')→(' + cropInfo.x2 + ',' + cropInfo.y2 + ')');
        ocrResult = filterOcrResultsByRegion(fullOcrResult, cropInfo);
        msaLog_('[4/7 CROP] filtered: ' + ocrLineCount + '→' + (ocrResult.line_data || []).length + ' lines');
      } else {
        msaLog_('[4/7 CROP] OPT2 MISS found=' + markers.length + ' need=4');
      }
    }
    
    // OPTION 3: Manual crop
    if (!markersDetected && options.cropRegion) {
      cropInfo = options.cropRegion;
      markersDetected = true;
      cropMethod = 'manual';
      msaLog_('[4/7 CROP] OPT3 manual rect=(' + cropInfo.x1 + ',' + cropInfo.y1 + ')→(' + cropInfo.x2 + ',' + cropInfo.y2 + ')');
      ocrResult = filterOcrResultsByRegion(fullOcrResult, cropInfo);
    }
    
    // OPTION 4: Full image
    if (!markersDetected) {
      ocrResult = fullOcrResult;
      markersDetected = false;
      cropMethod = 'full';
      msaLog_('[4/7 CROP] OPT4 no crop — using full image');
    }
    msaLog_('[4/7 CROP] DONE method=' + cropMethod + ' lines=' + (ocrResult.line_data || []).length + ' Δ' + (Date.now() - tPhase) + 'ms');

    // ─── PHASE 5: CLEAN ───
    tPhase = Date.now();
    msaLog_('───────────────────────────────────────────');
    msaLog_('[5/7 CLEAN] crossedOff→notationRepair→scribbleDigit→predictive→lowConfMS→globalRules→studentRules→notationNorm→opDigit');
    var textBefore = (ocrResult.text || '').length;

    // 5A: Crossed-off detection
    var t5a = Date.now();
    var crossedOffResult = flagCrossedOffLines_(ocrResult);
    msaLog_('[5/7 CLEAN] 5A crossedOff: cjkBlocks=' + (crossedOffResult.stats ? crossedOffResult.stats.cjkTextBlocks || 0 : 0) + ' chars=' + textBefore + '→' + crossedOffResult.cleanedText.length + ' Δ' + (Date.now() - t5a) + 'ms');

    // 5A2: Notation structure repair — fix OCR-mangled multi-char names
    var t5a2 = Date.now();
    var questionContextForRepair = (fullOcrResult && fullOcrResult.text) ? fullOcrResult.text : '';
    var markschemeForRepair = '';
    if (detectedQuestionCode) {
      try {
        var msPointsRepair = loadMarkschemePoints_(detectedQuestionCode);
        if (msPointsRepair && msPointsRepair.length > 0) {
          markschemeForRepair = msPointsRepair.map(function(p) { return p.requirement || ''; }).join('\n');
        }
      } catch (msrErr) { /* best effort */ }
    }
    var notationRepairResult = repairMangledNotation_(crossedOffResult.cleanedText, questionContextForRepair, markschemeForRepair);
    if (notationRepairResult.applied.length > 0) {
      notationRepairResult.applied.forEach(function(a) {
        msaLog_('[5/7 CLEAN] 5A2 repair: "' + a.from + '"→"' + a.to + '" (' + a.reason + ')');
      });
    }
    msaLog_('[5/7 CLEAN] 5A2 notationRepair: applied=' + notationRepairResult.applied.length + ' replacements=' + notationRepairResult.totalReplacements + ' Δ' + (Date.now() - t5a2) + 'ms');

    // 5A3: Scribble digit artifact removal
    var t5a3 = Date.now();
    var scribbleResult = fixScribbleDigitArtifacts_(notationRepairResult.text, detectedQuestionCode);
    if (scribbleResult.applied.length > 0) {
      scribbleResult.applied.forEach(function(a) {
        msaLog_('[5/7 CLEAN] 5A3 scribble: "' + a.from + '"→"' + a.to + '" (' + a.reason + ')');
      });
    }
    msaLog_('[5/7 CLEAN] 5A3 scribbleDigit: applied=' + scribbleResult.applied.length + ' replacements=' + scribbleResult.totalReplacements + ' Δ' + (Date.now() - t5a3) + 'ms');

    // 5A4: Context-predictive correction (uses mark scheme + question + progressive student work)
    var t5a4 = Date.now();
    var msPointsPredictive = null;
    var questionContextPredictive = (fullOcrResult && fullOcrResult.text) ? fullOcrResult.text : '';
    var lineDataPredictive = ocrResult.line_data || [];
    if (detectedQuestionCode) {
      try { msPointsPredictive = loadMarkschemePoints_(detectedQuestionCode); } catch (e) { /* best effort */ }
    }
    var predictiveResult = contextPredictiveCorrection_(scribbleResult.text, msPointsPredictive, questionContextPredictive, lineDataPredictive);
    if (predictiveResult.applied.length > 0) {
      predictiveResult.applied.forEach(function(a) {
        msaLog_('[5/7 CLEAN] 5A4 predictive: "' + a.from + '"→"' + a.to + '" (' + a.reason + ')');
      });
    }
    msaLog_('[5/7 CLEAN] 5A4 predictive: applied=' + predictiveResult.applied.length + ' replacements=' + predictiveResult.totalReplacements + ' vocab=' + predictiveResult.vocabularySize + ' Δ' + (Date.now() - t5a4) + 'ms');

    // 5A5: Low-confidence mark scheme benefit-of-the-doubt correction
    var t5a5 = Date.now();
    var msPointsLowConf = msPointsPredictive;  // reuse from 5A4
    var lowConfResult = lowConfidenceMarkSchemeCorrection_(predictiveResult.text, msPointsLowConf, lineDataPredictive);
    if (lowConfResult.applied.length > 0) {
      lowConfResult.applied.forEach(function(a) {
        msaLog_('[5/7 CLEAN] 5A5 lowConf: "' + a.from + '"→"' + a.to + '" (conf=' + a.lineConf.toFixed(3) + ' ' + a.reason + ')');
      });
    }
    msaLog_('[5/7 CLEAN] 5A5 lowConfMS: applied=' + lowConfResult.applied.length + ' replacements=' + lowConfResult.totalReplacements + ' lowConfLines=' + lowConfResult.lowConfLineCount + ' threshold=' + lowConfResult.threshold + ' Δ' + (Date.now() - t5a5) + 'ms');

    // 5B: Global learned corrections
    var t5b = Date.now();
    var correctionsEnabled = (options.enableCorrections !== undefined)
      ? options.enableCorrections
      : ((typeof MSA_OCR_CORRECTIONS_ENABLED !== 'undefined') ? MSA_OCR_CORRECTIONS_ENABLED : true);
    var learnedResult = { text: lowConfResult.text, applied: [], stats: { rulesLoaded: 0, rulesApplied: 0, totalReplacements: 0 } };
    if (!correctionsEnabled) {
      msaLog_('[5/7 CLEAN] 5B globalRules: BYPASSED (MSA_OCR_CORRECTIONS_ENABLED=false)');
    } else try {
      var minFreq = (typeof MSA_OCR_LEARN_MIN_FREQUENCY !== 'undefined') ? MSA_OCR_LEARN_MIN_FREQUENCY : 2;
      learnedResult = applyLearnedCorrections_(
        lowConfResult.text,
        { minFrequency: minFreq }
      );
      if (learnedResult.applied && learnedResult.applied.length > 0) {
        learnedResult.applied.forEach(function(a) {
          msaLog_('[5/7 CLEAN] 5B rule: "' + a.pattern.substring(0, 40) + '"→"' + (a.replacement || '').substring(0, 40) + '" ×' + a.count);
        });
      }
    } catch (learnErr) {
      msaWarn_('[5/7 CLEAN] 5B SKIP: ' + learnErr.message);
    }
    msaLog_('[5/7 CLEAN] 5B globalRules: loaded=' + learnedResult.stats.rulesLoaded + ' applied=' + learnedResult.stats.rulesApplied + ' replacements=' + learnedResult.stats.totalReplacements + ' chars=' + lowConfResult.text.length + '→' + learnedResult.text.length + ' Δ' + (Date.now() - t5b) + 'ms');

    // 5C: Per-student corrections
    var t5c = Date.now();
    var studentProfileResult = { text: learnedResult.text, applied: [], stats: { rulesLoaded: 0, rulesApplied: 0, totalReplacements: 0, studentId: null } };
    var studentProfileSummary = null;
    if (detectedStudentId && correctionsEnabled) {
      try {
        var sMinFreq = (typeof MSA_STUDENT_OCR_MIN_FREQUENCY !== 'undefined') ? MSA_STUDENT_OCR_MIN_FREQUENCY : 1;
        studentProfileResult = applyStudentCorrections_(
          detectedStudentId,
          learnedResult.text,
          { minFrequency: sMinFreq }
        );
        studentProfileSummary = getStudentProfileSummary_(detectedStudentId);
        if (studentProfileResult.applied && studentProfileResult.applied.length > 0) {
          studentProfileResult.applied.forEach(function(a) {
            msaLog_('[5/7 CLEAN] 5C studentRule: "' + a.pattern.substring(0, 40) + '"→"' + (a.replacement || '').substring(0, 40) + '" ×' + a.count);
          });
        }
      } catch (profileErr) {
        msaWarn_('[5/7 CLEAN] 5C SKIP: ' + profileErr.message);
      }
      msaLog_('[5/7 CLEAN] 5C studentRules sId=' + detectedStudentId + ': loaded=' + studentProfileResult.stats.rulesLoaded + ' applied=' + studentProfileResult.stats.rulesApplied + ' replacements=' + studentProfileResult.stats.totalReplacements + ' Δ' + (Date.now() - t5c) + 'ms');
    } else if (!correctionsEnabled) {
      msaLog_('[5/7 CLEAN] 5C studentRules: BYPASSED (MSA_OCR_CORRECTIONS_ENABLED=false)');
    } else {
      msaLog_('[5/7 CLEAN] 5C studentRules SKIP — no studentId Δ0ms');
    }

    // 5D: Context-aware notation normalization
    var t5d = Date.now();
    var notationResult = { text: studentProfileResult.text, applied: [], totalReplacements: 0 };
    try {
      // Build context from the full OCR (includes printed question text) + mark scheme
      var questionContextText = (fullOcrResult && fullOcrResult.text) ? fullOcrResult.text : '';
      var markschemeContextText = '';
      if (detectedQuestionCode) {
        try {
          var msPoints = loadMarkschemePoints_(detectedQuestionCode);
          if (msPoints && msPoints.length > 0) {
            markschemeContextText = msPoints.map(function(p) { return p.requirement || ''; }).join('\n');
          }
        } catch (msErr) {
          msaWarn_('[5/7 CLEAN] 5D mark scheme load: ' + msErr.message);
        }
      }
      var normRules = buildNotationNormalizationRules_(questionContextText, markschemeContextText);
      if (normRules.rules.length > 0) {
        notationResult = applyNotationNormalization_(studentProfileResult.text, normRules.rules);
        if (notationResult.applied.length > 0) {
          notationResult.applied.forEach(function(a) {
            msaLog_('[5/7 CLEAN] 5D notation: "' + a.from + '"→"' + a.to + '" ×' + a.count + ' (' + a.reason + ')');
          });
        }
      }
      msaLog_('[5/7 CLEAN] 5D notationNorm: rules=' + normRules.rules.length + ' applied=' + notationResult.applied.length + ' replacements=' + notationResult.totalReplacements + ' Δ' + (Date.now() - t5d) + 'ms');
    } catch (notErr) {
      msaWarn_('[5/7 CLEAN] 5D SKIP: ' + notErr.message);
      notationResult = { text: studentProfileResult.text, applied: [], totalReplacements: 0 };
    }

    // 5E: Operator–digit confusion (e.g. 7335 → >335)
    var t5e = Date.now();
    var opDigitEnabled = (options.enableOpDigitFix !== undefined) ? options.enableOpDigitFix : true;
    var opDigitResult = { text: notationResult.text, applied: [], totalReplacements: 0 };
    if (!opDigitEnabled) {
      msaLog_('[5/7 CLEAN] 5E opDigitFix: SKIPPED (disabled by user)');
    } else try {
      if (detectedQuestionCode) {
        var msPointsForOp = null;
        try { msPointsForOp = loadMarkschemePoints_(detectedQuestionCode); } catch (e) { /* already loaded in 5D, may cache */ }
        if (msPointsForOp && msPointsForOp.length > 0) {
          var questionContextForOp = (fullOcrResult && fullOcrResult.text) ? fullOcrResult.text : '';
          opDigitResult = fixOperatorDigitConfusion_(notationResult.text, msPointsForOp, questionContextForOp);
          if (opDigitResult.applied.length > 0) {
            opDigitResult.applied.forEach(function(a) {
              msaLog_('[5/7 CLEAN] 5E opDigit: "' + a.from + '"→"' + a.to + '" ×' + a.count + ' (' + a.reason + ')');
            });
          }
        }
      }
      msaLog_('[5/7 CLEAN] 5E opDigitFix: applied=' + opDigitResult.applied.length + ' replacements=' + opDigitResult.totalReplacements + ' Δ' + (Date.now() - t5e) + 'ms');
    } catch (opErr) {
      msaWarn_('[5/7 CLEAN] 5E SKIP: ' + opErr.message);
      opDigitResult = { text: notationResult.text, applied: [], totalReplacements: 0 };
    }

    msaLog_('[5/7 CLEAN] DONE text=' + textBefore + '→' + opDigitResult.text.length + ' chars totalΔ' + (Date.now() - tPhase) + 'ms');

    const processingTime = Date.now() - T;
    
    // ─── PHASE 6: IMAGE ───
    tPhase = Date.now();
    msaLog_('───────────────────────────────────────────');
    msaLog_('[6/7 IMAGE] Building browser preview. mime=' + mimeType + ' size=' + Math.round(fileSizeBytes / 1024) + 'KB');

    let imageDataUrl;
    var isTiff = (mimeType === 'image/tiff' || mimeType === 'image/tif');
    
    if (isTiff) {
      msaLog_('[6/7 IMAGE] TIFF→thumbnail pipeline (browsers cannot render TIFF)');
      try {
        var token = ScriptApp.getOAuthToken();
        var thumbUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=thumbnailLink';
        var t6api = Date.now();
        var thumbResp = UrlFetchApp.fetch(thumbUrl, {
          headers: { Authorization: 'Bearer ' + token }
        });
        msaLog_('[6/7 IMAGE] Drive.files.get Δ' + (Date.now() - t6api) + 'ms');
        var thumbData = JSON.parse(thumbResp.getContentText());
        if (thumbData.thumbnailLink) {
          var fetchUrl = thumbData.thumbnailLink.replace('=s220', '=s800');
          var t6fetch = Date.now();
          var blobResp = UrlFetchApp.fetch(fetchUrl, {
            headers: { Authorization: 'Bearer ' + token },
            muteHttpExceptions: true
          });
          if (blobResp.getResponseCode() === 200) {
            var tBytes = blobResp.getContent();
            var tMime = blobResp.getHeaders()['Content-Type'] || 'image/png';
            imageDataUrl = 'data:' + tMime + ';base64,' + Utilities.base64Encode(tBytes);
            msaLog_('[6/7 IMAGE] TIFF thumb OK ' + Math.round(tBytes.length / 1024) + 'KB fetchΔ' + (Date.now() - t6fetch) + 'ms');
          } else {
            msaWarn_('[6/7 IMAGE] TIFF thumb HTTP ' + blobResp.getResponseCode());
            imageDataUrl = null;
          }
        } else {
          msaWarn_('[6/7 IMAGE] TIFF no thumbnailLink in metadata');
          imageDataUrl = null;
        }
      } catch (e) {
        msaErr_('[6/7 IMAGE] TIFF thumb fail: ' + e.message);
        imageDataUrl = null;
      }
    } else {
      var fileSizeKB = Math.round(fileSizeBytes / 1024);
      if (fileSizeKB > 500) {
        msaLog_('[6/7 IMAGE] large file (' + fileSizeKB + 'KB>500KB) → server-side thumbnail at s800');
        try {
          var token = ScriptApp.getOAuthToken();
          var metaUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=thumbnailLink';
          var t6api = Date.now();
          var metaResp = UrlFetchApp.fetch(metaUrl, { headers: { Authorization: 'Bearer ' + token } });
          msaLog_('[6/7 IMAGE] Drive.files.get Δ' + (Date.now() - t6api) + 'ms');
          var metaData = JSON.parse(metaResp.getContentText());
          if (metaData.thumbnailLink) {
            var thumbFetchUrl = metaData.thumbnailLink.replace('=s220', '=s800');
            var t6fetch = Date.now();
            var thumbBlobResp = UrlFetchApp.fetch(thumbFetchUrl, {
              headers: { Authorization: 'Bearer ' + token },
              muteHttpExceptions: true
            });
            if (thumbBlobResp.getResponseCode() === 200) {
              var thumbBytes = thumbBlobResp.getContent();
              var thumbB64 = Utilities.base64Encode(thumbBytes);
              var thumbMime = thumbBlobResp.getHeaders()['Content-Type'] || 'image/png';
              imageDataUrl = 'data:' + thumbMime + ';base64,' + thumbB64;
              msaLog_('[6/7 IMAGE] thumb OK raw=' + Math.round(thumbBytes.length / 1024) + 'KB b64=' + Math.round(thumbB64.length / 1024) + 'KB fetchΔ' + (Date.now() - t6fetch) + 'ms');
            } else {
              msaWarn_('[6/7 IMAGE] thumb HTTP ' + thumbBlobResp.getResponseCode());
              imageDataUrl = null;
            }
          } else {
            msaWarn_('[6/7 IMAGE] no thumbnailLink in Drive metadata');
            imageDataUrl = null;
          }
        } catch (thumbErr) {
          msaErr_('[6/7 IMAGE] thumb fail: ' + thumbErr.message);
          imageDataUrl = null;
        }
      } else {
        msaLog_('[6/7 IMAGE] small file (' + fileSizeKB + 'KB≤500KB) → direct base64');
        var t6blob = Date.now();
        const base64Image = Utilities.base64Encode(file.getBlob().getBytes());
        imageDataUrl = 'data:' + mimeType + ';base64,' + base64Image;
        msaLog_('[6/7 IMAGE] blob→b64 OK ' + Math.round(base64Image.length / 1024) + 'KB Δ' + (Date.now() - t6blob) + 'ms');
      }
    }
    
    var imgSizeKB = imageDataUrl ? Math.round(imageDataUrl.length / 1024) : 0;
    msaLog_('[6/7 IMAGE] DONE preview=' + (imageDataUrl ? imgSizeKB + 'KB' : 'null') + ' isTiff=' + isTiff + ' Δ' + (Date.now() - tPhase) + 'ms');

    // ─── PHASE 7: PACKAGE ───
    tPhase = Date.now();
    msaLog_('───────────────────────────────────────────');
    msaLog_('[7/7 PKG] Building return payload');

    let rawConfidence = ocrResult.confidence || 0;
    let confidence = calculateCompositeConfidence_(ocrResult, rawConfidence);
    msaLog_('[7/7 PKG] confidence: raw=' + (rawConfidence * 100).toFixed(1) + '%→composite=' + (confidence * 100).toFixed(1) + '%');
    
    // Check for Mathpix errors
    if (ocrResult.error) {
      msaErr_('[7/7 PKG] Mathpix error: ' + ocrResult.error + ' info=' + JSON.stringify(ocrResult.error_info || {}));
      return {
        status: 'error',
        message: 'Mathpix OCR failed: ' + ocrResult.error + ' - ' + JSON.stringify(ocrResult.error_info || {})
      };
    }
    
    const mathDetected = (ocrResult.text || '').includes('\\') || (ocrResult.latex_styled || '').includes('\\');

    // Generate mark-scheme-aware suggestions for teacher review
    var markSchemeSuggestions = [];
    if (detectedQuestionCode) {
      try {
        var sugPoints = loadMarkschemePoints_(detectedQuestionCode);
        var questionContextForSugg = (fullOcrResult && fullOcrResult.text) ? fullOcrResult.text : '';
        if (sugPoints && sugPoints.length > 0) {
          markSchemeSuggestions = generateMarkSchemeSuggestions_(opDigitResult.text, sugPoints, questionContextForSugg);
          msaLog_('[7/7 PKG] Generated ' + markSchemeSuggestions.length + ' mark-scheme suggestion(s) for teacher review');
        }
      } catch (sugErr) {
        msaWarn_('[7/7 PKG] Suggestion generation failed (non-fatal): ' + sugErr.message);
      }
    }

    var returnPayload = {
      status: 'success',
      fileId: fileId,
      fileName: file.getName(),
      imageUrl: imageDataUrl,
      isTiff: isTiff,
      ocrText: ocrResult.text || '',
      latexStyled: ocrResult.latex_styled || '',
      confidence: confidence,
      mathDetected: mathDetected,
      processingTime: processingTime,
      cropInfo: cropInfo,
      markersDetected: markersDetected,
      detectedQuestionCode: detectedQuestionCode,
      detectedStudentId: detectedStudentId,
      detectedExamName: detectedExamName,
      detectedPosition: detectedPosition,
      correctionsEnabled: correctionsEnabled,
      crossedOff: {
        flaggedLines: crossedOffResult.flaggedLines,
        stats: crossedOffResult.stats,
        lineAnnotations: crossedOffResult.lineAnnotations
      },
      notationRepair: {
        applied: notationRepairResult.applied,
        totalReplacements: notationRepairResult.totalReplacements
      },
      cleanedOcrText: opDigitResult.text,
      learnedCorrections: {
        applied: learnedResult.applied,
        stats: learnedResult.stats
      },
      studentProfile: {
        applied: studentProfileResult.applied,
        stats: studentProfileResult.stats,
        summary: studentProfileSummary
      },
      notationNormalization: {
        applied: notationResult.applied,
        totalReplacements: notationResult.totalReplacements
      },
      scribbleDigitCleanup: {
        applied: scribbleResult.applied,
        totalReplacements: scribbleResult.totalReplacements
      },
      predictiveCorrection: {
        applied: predictiveResult.applied,
        totalReplacements: predictiveResult.totalReplacements,
        vocabularySize: predictiveResult.vocabularySize
      },
      lowConfidenceCorrection: {
        applied: lowConfResult.applied,
        totalReplacements: lowConfResult.totalReplacements,
        lowConfLineCount: lowConfResult.lowConfLineCount,
        threshold: lowConfResult.threshold
      },
      operatorDigitFixes: {
        applied: opDigitResult.applied,
        totalReplacements: opDigitResult.totalReplacements
      },
      metadata: {
        width: ocrResult.image_width || null,
        height: ocrResult.image_height || null,
        lineCount: (ocrResult.line_data || []).length
      },
      suggestions: markSchemeSuggestions
    };

    var payloadJson = JSON.stringify(returnPayload);
    var totalMs = Date.now() - T;
    msaLog_('[7/7 PKG] DONE Δ' + (Date.now() - tPhase) + 'ms');
    msaLog_('═══════════════════════════════════════════');
    msaLog_('✅ PIPELINE COMPLETE totalΔ' + totalMs + 'ms');
    msaLog_('  payload=' + Math.round(payloadJson.length / 1024) + 'KB imgB64=' + imgSizeKB + 'KB ocrChars=' + ocrTextLen + ' cleanChars=' + opDigitResult.text.length);
    msaLog_('  qCode=' + (detectedQuestionCode || 'null') + ' sId=' + (detectedStudentId || 'null') + ' pos=' + (detectedPosition || 'null') + ' crop=' + cropMethod + ' math=' + mathDetected + ' conf=' + (confidence * 100).toFixed(1) + '%');
    msaLog_('  phases: FETCH=' + 'ok' + ' OCR=' + (fullOcrResult.error ? 'ERR' : 'ok') + ' QR=' + (detectedQuestionCode ? 'ok' : 'miss') + ' CROP=' + cropMethod + ' CLEAN=' + learnedResult.stats.rulesApplied + 'rules/' + studentProfileResult.stats.rulesApplied + 'student IMAGE=' + (imageDataUrl ? 'ok' : 'null') + ' PKG=ok');
    msaLog_('═══════════════════════════════════════════');

    // Persist full execution log to Drive for later retrieval from VS Code
    msaDumpLogsToFile_('studentOCR_' + (detectedQuestionCode || fileId.substring(0, 8)));

    return payloadJson;
  } catch (e) {
    var errMs = Date.now() - T;
    msaErr_('PIPELINE FAIL @' + errMs + 'ms: ' + e.message);
    msaErr_('  stack: ' + (e.stack || 'no stack').substring(0, 300));
    msaErr_('  fileId=' + fileId + ' opts=' + JSON.stringify({qCode: options.questionCode || null, sId: options.studentId || null, pos: options.position || null}));
    msaDumpLogsToFile_('studentOCR_ERROR');
    return JSON.stringify({
      status: 'error',
      message: e.message
    });
  }
}

/**
 * Unwrap \begin{array} blocks into separate \n-delimited lines.
 * Mathpix merges spatially distinct handwritten lines into LaTeX arrays;
 * this restores one line of text per visual line.
 *
 * Handles both \[\begin{array}...\end{array}\] and bare \begin{array}...\end{array}.
 * Splits array content on \\ (LaTeX row separator) and joins with real newlines.
 */
/**
 * Detect and flag lines that are likely crossed-off student work.
 * Looks for CJK characters (Chinese/Japanese/Korean), symbol gibberish,
 * and very low-confidence lines that OCR produces when reading scribbles/cross-outs.
 *
 * @param {object} ocrResult The OCR result with line_data array from Mathpix
 * @returns {object} { cleanedText, flaggedLines[], stats, lineAnnotations[] }
 */
function flagCrossedOffLines_(ocrResult) {
  var t0 = Date.now();
  // CONSERVATIVE approach: Only strip CJK characters that are clearly isolated
  // garbage inside \text{} wrappers (e.g. \text { 演 } from misread scribbles).
  // Mathpix intentionally uses full-width characters （）＋＝ etc. — never touch those.

  // Pattern: \text { <CJK char(s)> } — isolated CJK inside \text wrappers
  var TEXT_CJK_RE = /\\text\s*\{\s*[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\u3100-\u312F\uAC00-\uD7AF]+\s*\}/g;

  var lineData = ocrResult.line_data || [];
  var lineAnnotations = [];
  var flaggedLines = [];
  var stats = { total: lineData.length, flagged: 0, kept: 0, cjkTextBlocks: 0 };

  msaLog_('  [CLEAN.crossOff] scanning ' + lineData.length + ' lines for CJK \\text{} blocks');

  // Scan line_data for logging purposes only
  for (var i = 0; i < lineData.length; i++) {
    var line = lineData[i];
    var text = (line.text || '').trim();

    if (TEXT_CJK_RE.test(text)) {
      TEXT_CJK_RE.lastIndex = 0; // reset regex
      var matches = text.match(TEXT_CJK_RE) || [];
      stats.cjkTextBlocks += matches.length;
      msaLog_('  [CLEAN.crossOff] L' + i + ' CJK: "' + matches.join(',') + '" in: "' + text.substring(0, 60) + '"');
      lineAnnotations.push({ status: 'cleaned', flags: ['cjk_text_stripped'], original: text });
    } else {
      lineAnnotations.push({ status: 'ok' });
      stats.kept++;
    }
  }

  // Build cleanedText: only strip \text{<CJK>} blocks from the ORIGINAL full text
  // This preserves ALL LaTeX formatting, full-width chars, math expressions, etc.
  var fullText = ocrResult.text || '';
  var cleanedFullText = fullText.replace(TEXT_CJK_RE, '');

  // Clean up any double-spaces or trailing whitespace left behind
  cleanedFullText = cleanedFullText.replace(/  +/g, ' ');

  if (fullText !== cleanedFullText) {
    stats.cjkTextBlocks = stats.cjkTextBlocks || 1;
    msaLog_('  [CLEAN.crossOff] stripped ' + (fullText.length - cleanedFullText.length) + ' chars (' + fullText.length + '→' + cleanedFullText.length + ')');
  } else {
    msaLog_('  [CLEAN.crossOff] no CJK \\text{} found — unchanged');
  }

  msaLog_('  [CLEAN.crossOff] DONE cjk=' + stats.cjkTextBlocks + ' kept=' + stats.kept + '/' + stats.total + ' Δ' + (Date.now() - t0) + 'ms');

  return {
    cleanedText: cleanedFullText,
    flaggedLines: flaggedLines,
    lineAnnotations: lineAnnotations,
    stats: stats
  };
}

// ─────────────────────────────────────────────────────────────
// Notation Structure Repair — unmangle OCR-fragmented names
// ─────────────────────────────────────────────────────────────

/**
 * Known multi-character math names that OCR frequently fragments into
 * subscript notation.  Each entry: { name: 'Max', re: <regex> }
 *
 * OCR commonly misreads e.g. "Max_{n}" as "M_{a_{x_{n}}}" or "M_{a_x}" _{n}
 * by treating continuation letters as subscript delimiters.
 *
 * The pattern captures mangled forms: M_{a_{x...}}, M_{ax...}, Ma_{x...}
 * and reassembles them into the correct multi-letter name.
 */
var KNOWN_MATH_NAMES_ = [
  // Sequence / stats names common in IB
  'Max', 'Min', 'Var', 'Cov', 'Cor',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'exp', 'lim', 'sum', 'med',
  'arg', 'det', 'dim', 'gcd', 'inf', 'sup',
  'mod', 'Arg', 'Int', 'Ans'
];

/**
 * Attempt to "un-subscript" a mangled token by trying to reconstruct a known
 * multi-character name from the first letter + subscript content.
 *
 * Example: M_{a_{n}}=1  →  tries to parse M + a from subscript → "Ma"
 *          Then checks: does "Max" start with "Ma"?  Yes!
 *          Looks for remaining chars in nested subscripts → finds n? No, that's a real subscript.
 *          So returns "Max" if we can find the "x" somewhere.
 *
 * More concretely, the regex approach:
 *   M_{a_{x_{n}}}  →  flatten to  "Maxn"  →  starts with "Max" → repair to Max_{n}
 *   M_{a_{n}}       →  flatten to  "Man"   →  no match for "Man" but "Max"? No x present → skip
 *                    →  BUT check context: does problem use Max_n? If so, M_{a_{n}} ≈ Max_{n} with x→n confusion
 *
 * @param {string} text  OCR LaTeX text
 * @param {string} questionContext  printed question text
 * @param {string} markschemeContext  mark scheme text
 * @returns {object} { text, applied: [{from, to, reason}], totalReplacements }
 */
function repairMangledNotation_(text, questionContext, markschemeContext) {
  if (!text) return { text: text, applied: [], totalReplacements: 0 };

  var applied = [];
  var result = text;
  var contextAll = (questionContext || '') + '\n' + (markschemeContext || '');

  // Build a set of names found in context (case-sensitive)
  var contextNames = {};
  KNOWN_MATH_NAMES_.forEach(function(name) {
    // Check if this name appears in context as plain text, \text{name}, or name_{...}
    var nameRe = new RegExp('(?:\\\\text\\{' + name + '\\}|\\\\' + name + '(?![a-zA-Z])|(?:^|[^a-zA-Z])' + name + '(?:_|[^a-zA-Z]))', 'm');
    if (nameRe.test(contextAll)) {
      contextNames[name] = true;
    }
  });

  // ── Strategy 1: Fix false-nested subscripts that form known names ──
  // Match: X_{Y_{...}} where X is a single letter and Y starts a known name
  // Regex: ([A-Za-z])_\{([a-zA-Z])_\{([^}]*)\}\}
  // This catches e.g. M_{a_{n}} where M+a = "Ma" → start of "Max"?
  //
  // More general: flatten all subscript nesting to extract the character sequence,
  // then check if any prefix matches a known name.

  // We'll find all instances of single-letter followed by subscript that contains
  // further subscripts, and try to reconstruct known names.

  // Pattern matches: letter_{content} where content itself contains _{
  var mangledRe = /([A-Za-z])_\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  var match;

  while ((match = mangledRe.exec(result)) !== null) {
    var fullMatch = match[0];           // e.g. "M_{a_{n}}"
    var firstChar = match[1];           // e.g. "M"
    var subscriptContent = match[2];    // e.g. "a_{n}"

    // Only process if the subscript contains nested structure (another _{)
    if (subscriptContent.indexOf('_{') === -1) continue;

    // Flatten: extract all plain characters from the subscript structure
    // "a_{n}" → "an",  "a_{x_{n}}" → "axn"
    var flat = subscriptContent.replace(/[_{}]/g, '');  // "an", "axn", etc.
    var fullFlat = firstChar + flat;  // "Man", "Maxn", etc.

    // Try each known name: does fullFlat start with it?
    var bestName = null;
    var bestLen = 0;
    KNOWN_MATH_NAMES_.forEach(function(name) {
      if (name.length > bestLen && fullFlat.length >= name.length) {
        if (fullFlat.substring(0, name.length) === name) {
          bestName = name;
          bestLen = name.length;
        }
      }
    });

    if (!bestName) continue;

    // The remaining characters after the name form the real subscript
    var remainder = fullFlat.substring(bestLen);  // e.g. "n" from "Maxn"

    // Build the repaired notation
    var repaired;
    if (remainder.length === 0) {
      repaired = bestName;  // just the name, no subscript
    } else if (remainder.length === 1) {
      repaired = bestName + '_{' + remainder + '}';  // e.g. "Max_{n}"
    } else {
      repaired = bestName + '_{' + remainder + '}';  // e.g. "Max_{12}"
    }

    // Skip if it's the same (no repair needed)
    if (repaired === fullMatch) continue;

    // Boost confidence if the name appears in problem context
    var inContext = !!contextNames[bestName];
    var reason = 'OCR fragmented "' + bestName + '" into nested subscripts';
    if (inContext) reason += ' (confirmed in problem context)';

    // Apply the repair (only if confident: name is ≥3 chars or confirmed in context)
    if (bestName.length >= 3 || inContext) {
      // Check what comes after this match – capture trailing =value if digits got eaten
      result = result.replace(fullMatch, repaired);
      applied.push({ from: fullMatch, to: repaired, reason: reason });

      // Reset regex since we modified the string
      mangledRe.lastIndex = 0;
    }
  }

  // ── Strategy 2: Fix truncated values near repaired names ──
  // OCR sometimes reads "Max_{n}=13" as "M_{a_{n}}=1" + "3" on next token
  // After Strategy 1 repairs "M_{a_{n}}" → "Max_{n}", check if "=<digit>" is
  // followed by a bare digit that should be appended.
  // Pattern: =(\d)\s+(\d+)  where digit count suggests truncation
  // This is speculative so only apply with high confidence signals.

  // (Kept conservative for now — the learned corrections system can handle
  //  value-level fixes once the notation is correct)

  return {
    text: result,
    applied: applied,
    totalReplacements: applied.length
  };
}

// ─────────────────────────────────────────────────────────────
// Context-aware notation normalizer
// ─────────────────────────────────────────────────────────────

/**
 * Common OCR confusion pairs for math sequence/function variables.
 * Each entry: [setA, setB] — letters that look similar in handwriting.
 * When the problem defines one, OCR misreads of the other get corrected.
 */
var NOTATION_CONFUSION_PAIRS_ = [
  // Sequence terms: u vs a (very common in IB)
  ['u', 'a'],
  // Sequence terms: v vs u vs n
  ['v', 'u'],
  // Sum notation: S vs s
  ['S', 's'],
  // Functions: f vs F
  ['f', 'F'],
  // Geometry: l vs I (lowercase L vs uppercase I)
  ['l', 'I'],
  // Common variables: r vs n in subscripts
  ['r', 'n']
];

/**
 * Extract mathematical variable notation from text.
 * Detects subscripted variables like u_n, a_n, S_n, u_{n+1}, etc.
 * Returns a map from base-letter to the full notations found.
 *
 * @param {string} text  LaTeX-ish OCR text
 * @returns {object} e.g. { u: ['u_n', 'u_1', 'u_{n+1}'], S: ['S_n', 'S_{13}'] }
 */
function extractNotationVariables_(text) {
  if (!text) return {};
  var found = {};

  // Pattern: letter_subscript  or  letter_{subscript}
  // Captures: letter, subscript content
  var RE = /([a-zA-Z])_(?:\{([^}]+)\}|([a-zA-Z0-9]))/g;
  var m;
  while ((m = RE.exec(text)) !== null) {
    var baseLetter = m[1];
    var subscript = m[2] || m[3];
    var fullNotation = m[0];
    if (!found[baseLetter]) found[baseLetter] = [];
    if (found[baseLetter].indexOf(fullNotation) === -1) {
      found[baseLetter].push(fullNotation);
    }
  }
  return found;
}

/**
 * Given the printed question text (or mark scheme text), determine which
 * notation is "canonical" — i.e. what the problem actually uses.
 * Then return a list of replacement rules: wrong → right.
 *
 * Example: if the question defines u_n, returns rules to replace a_n → u_n,
 * a_1 → u_1, a_{n+1} → u_{n+1}, etc.
 *
 * @param {string} questionText  The printed question text (from OCR top lines)
 * @param {string} [markschemeText]  Optional mark scheme text for extra context
 * @returns {object} { rules: [{from, to, reason}], canonicalVars: {letter: [...]} }
 */
function buildNotationNormalizationRules_(questionText, markschemeText) {
  var qVars = extractNotationVariables_(questionText || '');
  var msVars = extractNotationVariables_(markschemeText || '');

  // Merge: question text takes priority, mark scheme adds confidence
  var canonicalVars = {};
  var allLetters = {};
  [qVars, msVars].forEach(function(src) {
    Object.keys(src).forEach(function(letter) {
      allLetters[letter] = true;
      if (!canonicalVars[letter]) canonicalVars[letter] = [];
      src[letter].forEach(function(notation) {
        if (canonicalVars[letter].indexOf(notation) === -1) {
          canonicalVars[letter].push(notation);
        }
      });
    });
  });

  var rules = [];

  // For each confusion pair, check if one letter is canonical and the other is not
  NOTATION_CONFUSION_PAIRS_.forEach(function(pair) {
    var a = pair[0], b = pair[1];
    var aIsCanonical = !!canonicalVars[a] && canonicalVars[a].length > 0;
    var bIsCanonical = !!canonicalVars[b] && canonicalVars[b].length > 0;

    // Only act if exactly ONE of the pair is present in the problem
    if (aIsCanonical && !bIsCanonical) {
      // 'a' is canonical — any 'b' subscripts in student text should become 'a'
      canonicalVars[a].forEach(function(notation) {
        var wrongNotation = notation.replace(new RegExp('^' + escapeRegExp_(a)), b);
        rules.push({
          from: wrongNotation,
          to: notation,
          reason: 'Problem uses ' + a + '_n notation; ' + b + '_n likely OCR misread'
        });
      });
    } else if (bIsCanonical && !aIsCanonical) {
      canonicalVars[b].forEach(function(notation) {
        var wrongNotation = notation.replace(new RegExp('^' + escapeRegExp_(b)), a);
        rules.push({
          from: wrongNotation,
          to: notation,
          reason: 'Problem uses ' + b + '_n notation; ' + a + '_n likely OCR misread'
        });
      });
    }
    // If both are present, don't normalize — the problem legitimately uses both
  });

  return { rules: rules, canonicalVars: canonicalVars };
}

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegExp_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply notation normalization rules to student OCR text.
 * Returns the corrected text and a list of what was changed.
 *
 * @param {string} studentText  The student's OCR text
 * @param {Array} rules  Array of {from, to, reason} from buildNotationNormalizationRules_
 * @returns {object} { text, applied: [{from, to, reason, count}], totalReplacements }
 */
function applyNotationNormalization_(studentText, rules) {
  if (!studentText || !rules || rules.length === 0) {
    return { text: studentText, applied: [], totalReplacements: 0 };
  }

  var result = studentText;
  var applied = [];
  var totalReplacements = 0;

  rules.forEach(function(rule) {
    // Use word-boundary-aware replacement to avoid replacing inside longer tokens
    // e.g. don't replace 'a_n' inside 'a_name'
    var re = new RegExp(escapeRegExp_(rule.from) + '(?![a-zA-Z])', 'g');
    var beforeLen = result.length;
    var matches = result.match(re);
    if (matches && matches.length > 0) {
      result = result.replace(re, rule.to);
      applied.push({
        from: rule.from,
        to: rule.to,
        reason: rule.reason,
        count: matches.length
      });
      totalReplacements += matches.length;
    }
  });

  return { text: result, applied: applied, totalReplacements: totalReplacements };
}

// ─────────────────────────────────────────────────────────────
// Operator–digit confusion fixer  (e.g. 7335 → >335)
// ─────────────────────────────────────────────────────────────

/**
 * Operator-glyph pairs: handwritten operators that OCR commonly misreads
 * as a digit, which then gets "absorbed" into the adjacent number.
 *   [digit, operator]  — the digit precedes a mark-scheme number
 */
var OPERATOR_DIGIT_PAIRS_ = [
  ['7', '>'],   // handwritten > looks like 7
  ['2', '<'],   // handwritten < can look like 2 in some scripts
  ['1', '|'],   // vertical bar misread as 1
  ['2', '\\geq '],  // ≥ misread as 2
  ['2', '\\leq ']   // ≤ misread as 2
];

/**
 * Extract significant numbers from mark scheme points.
 * Returns unique number strings that appear in requirement text.
 *
 * @param {Array} markschemePoints  Array of { requirement: "..." } objects
 * @returns {string[]}  e.g. ["335", "1003", "6"]
 */
function extractMarkschemeNumbers_(markschemePoints) {
  var nums = {};
  (markschemePoints || []).forEach(function(p) {
    var req = String(p.requirement || '');
    var matches = req.match(/\d+(?:\.\d+)?/g) || [];
    matches.forEach(function(n) {
      // Skip single digits 0-9 — too many false positives
      if (n.length >= 2) nums[n] = true;
    });
  });
  return Object.keys(nums);
}

/**
 * Fix cases where a handwritten operator (>, <, etc.) is misread by OCR
 * as a digit and absorbed into an adjacent mark-scheme number.
 *
 * Example: mark scheme expects "335", student writes "> 335", OCR produces
 * "7335" because ">" looks like "7".  This function detects that "335" is
 * a mark-scheme number, "7335" is NOT, and replaces "7335" → "> 335".
 *
 * Also handles the case with a space: "7 335" → "> 335".
 *
 * @param {string} studentText  The student's OCR text
 * @param {Array}  markschemePoints  Mark scheme points array
 * @param {string} [questionText]  Optional printed question text for extra context
 * @returns {object} { text, applied: [{from, to, reason, count}], totalReplacements }
 */
function fixOperatorDigitConfusion_(studentText, markschemePoints, questionText) {
  if (!studentText || !markschemePoints || markschemePoints.length === 0) {
    return { text: studentText, applied: [], totalReplacements: 0 };
  }

  var msNumbers = extractMarkschemeNumbers_(markschemePoints);
  if (msNumbers.length === 0) {
    return { text: studentText, applied: [], totalReplacements: 0 };
  }

  // Also gather numbers from question text for extra context
  var contextNumbers = {};
  msNumbers.forEach(function(n) { contextNumbers[n] = true; });
  if (questionText) {
    var qMatches = questionText.match(/\d+(?:\.\d+)?/g) || [];
    qMatches.forEach(function(n) { if (n.length >= 2) contextNumbers[n] = true; });
  }

  var result = studentText;
  var applied = [];
  var totalReplacements = 0;

  OPERATOR_DIGIT_PAIRS_.forEach(function(pair) {
    var digit = pair[0];
    var operator = pair[1];

    msNumbers.forEach(function(msNum) {
      var fused = digit + msNum;   // e.g. "7335"

      // Skip if the fused form itself is a mark-scheme number  (don't break real values)
      if (contextNumbers[fused]) return;

      // Pattern: the fused number not surrounded by other digits
      var re = new RegExp('(?<![\\d])' + escapeRegExp_(fused) + '(?![\\d])', 'g');
      var matches = result.match(re);
      if (matches && matches.length > 0) {
        var replacement = operator + ' ' + msNum;   // "> 335"
        result = result.replace(re, replacement);
        applied.push({
          from: fused,
          to: replacement,
          reason: 'Operator "' + operator + '" misread as digit "' + digit + '" before mark-scheme value ' + msNum,
          count: matches.length
        });
        totalReplacements += matches.length;
      }

      // Also check for the spaced form: "7 335" → "> 335"
      var spacedForm = digit + '\\s+' + escapeRegExp_(msNum);
      var spacedRe = new RegExp('(?<![\\d])' + spacedForm + '(?![\\d])', 'g');
      var spacedMatches = result.match(spacedRe);
      if (spacedMatches && spacedMatches.length > 0) {
        var spacedReplacement = operator + ' ' + msNum;
        result = result.replace(spacedRe, spacedReplacement);
        applied.push({
          from: digit + ' ' + msNum,
          to: spacedReplacement,
          reason: 'Operator "' + operator + '" misread as digit "' + digit + '" (spaced) before mark-scheme value ' + msNum,
          count: spacedMatches.length
        });
        totalReplacements += spacedMatches.length;
      }
    });
  });

  return { text: result, applied: applied, totalReplacements: totalReplacements };
}

// ─────────────────────────────────────────────────────────────
// 5A3: Scribble digit artifact removal
// ─────────────────────────────────────────────────────────────

/**
 * Detects and removes scribble digit artifacts — trailing zeros or repeated
 * digits that appear when a student scratches off work and Mathpix misreads
 * the scribble marks as extra digits. Example: student wrote "6" then
 * scratched it off → OCR yields "6000" or "6666".
 *
 * Uses mark-scheme context to validate: only collapses when the core digit
 * (without trailing artifacts) matches a mark-scheme value.
 *
 * @param {string} text  The OCR text to clean
 * @param {string} [questionCode]  Optional question code for mark scheme lookup
 * @returns {object} { text, applied: [{from, to, reason, count}], totalReplacements }
 */
function fixScribbleDigitArtifacts_(text, questionCode) {
  if (!text) return { text: text || '', applied: [], totalReplacements: 0 };

  var msNumbers = {};
  if (questionCode) {
    try {
      var msPoints = loadMarkschemePoints_(questionCode);
      if (msPoints && msPoints.length > 0) {
        msPoints.forEach(function(p) {
          var nums = (p.requirement || '').match(/\d+(?:\.\d+)?/g) || [];
          nums.forEach(function(n) { msNumbers[n] = true; });
        });
      }
    } catch (e) { /* best effort */ }
  }

  var result = text;
  var applied = [];
  var totalReplacements = 0;

  // Pattern A: Trailing zeros — e.g. "6000" → "6" (when "6" is in mark scheme)
  // Matches a non-zero digit followed by 2+ zeros, not part of a larger number
  var trailingZerosRe = /(?<!\d)([1-9])(0{2,})(?!\d)/g;
  var match;
  var replacements = [];
  while ((match = trailingZerosRe.exec(result)) !== null) {
    var fullMatch = match[0];
    var coreDigit = match[1];
    // Only collapse if the core digit is in the mark scheme and the full number is NOT
    if (msNumbers[coreDigit] && !msNumbers[fullMatch]) {
      replacements.push({ full: fullMatch, core: coreDigit, index: match.index });
    }
  }
  // Apply in reverse order to preserve indices
  for (var i = replacements.length - 1; i >= 0; i--) {
    var r = replacements[i];
    result = result.substring(0, r.index) + r.core + result.substring(r.index + r.full.length);
    applied.push({
      from: r.full,
      to: r.core,
      reason: 'Trailing zeros (scribble artifact): "' + r.full + '" collapsed to mark-scheme value "' + r.core + '"',
      count: 1
    });
    totalReplacements++;
  }

  // Pattern B: Same-digit repetition — e.g. "6666" → "6" (when "6" is in mark scheme)
  // Matches a digit repeated 3+ times, not part of a larger number
  var repeatDigitRe = /(?<!\d)(\d)\1{2,}(?!\d)/g;
  replacements = [];
  while ((match = repeatDigitRe.exec(result)) !== null) {
    var fullMatch2 = match[0];
    var singleDigit = match[1];
    if (msNumbers[singleDigit] && !msNumbers[fullMatch2]) {
      replacements.push({ full: fullMatch2, core: singleDigit, index: match.index });
    }
  }
  for (var j = replacements.length - 1; j >= 0; j--) {
    var r2 = replacements[j];
    result = result.substring(0, r2.index) + r2.core + result.substring(r2.index + r2.full.length);
    applied.push({
      from: r2.full,
      to: r2.core,
      reason: 'Repeated digit (scribble artifact): "' + r2.full + '" collapsed to mark-scheme value "' + r2.core + '"',
      count: 1
    });
    totalReplacements++;
  }

  return { text: result, applied: applied, totalReplacements: totalReplacements };
}

// ─────────────────────────────────────────────────────────────
// 5A4: Context-predictive OCR correction
// ─────────────────────────────────────────────────────────────

/**
 * Common OCR digit confusion pairs — when Mathpix misreads one digit as
 * another. Used for single-digit substitution in predictive correction.
 */
var OCR_DIGIT_CONFUSION_PAIRS_ = [
  ['1','7'], ['5','6'], ['3','8'], ['0','6'], ['0','9'], ['6','9'],
  ['1','4'], ['2','7'], ['3','5'], ['4','9'], ['2','3'], ['8','0']
];

/**
 * Uses question text, mark scheme, and progressive student work context to
 * predict and fix OCR misinterpretations. Builds a "vocabulary" of expected
 * numbers/values, then checks if any OCR'd number is a single-digit-swap
 * away from a vocabulary entry.
 *
 * Strategies:
 *   1. Vocabulary building: extract multi-digit numbers from mark scheme (priority)
 *      and question text, plus progressive student work context
 *   2. Single-digit substitution: for each multi-digit number NOT in vocab,
 *      try swapping each digit using confusion pairs; correct only when
 *      exactly 1 candidate matches a vocab entry
 *   3. Expression-fragment matching: look for "variable = number" patterns
 *      in mark scheme, check if student text has same variable with a
 *      different (1-digit-swap-away) number
 *
 * @param {string} text  Student OCR text
 * @param {Array|null} markschemePoints  Mark scheme points array (or null)
 * @param {string} questionText  Printed question text from OCR
 * @param {Array} lineData  Line-level OCR data for progressive context
 * @returns {object} { text, applied, totalReplacements, vocabularySize }
 */
function contextPredictiveCorrection_(text, markschemePoints, questionText, lineData) {
  if (!text) return { text: text || '', applied: [], totalReplacements: 0, vocabularySize: 0 };

  // ── Strategy 1: Build vocabulary ──
  var vocab = {};  // value → { source: 'ms'|'q'|'student', priority: number }

  // 1a: Mark scheme numbers (highest priority)
  if (markschemePoints && markschemePoints.length > 0) {
    markschemePoints.forEach(function(p) {
      var nums = (p.requirement || '').match(/\d+(?:\.\d+)?/g) || [];
      nums.forEach(function(n) {
        if (n.length >= 2) {
          vocab[n] = { source: 'ms', priority: 3 };
        }
      });
    });
  }

  // 1b: Question text numbers (medium priority)
  if (questionText) {
    var qNums = questionText.match(/\d+(?:\.\d+)?/g) || [];
    qNums.forEach(function(n) {
      if (n.length >= 2 && !vocab[n]) {
        vocab[n] = { source: 'q', priority: 2 };
      }
    });
  }

  // 1c: Progressive student context — numbers already seen in earlier lines (low priority)
  if (lineData && lineData.length > 1) {
    for (var li = 0; li < lineData.length - 1; li++) {
      var lineText = lineData[li].text || '';
      var lineNums = lineText.match(/\d+(?:\.\d+)?/g) || [];
      lineNums.forEach(function(n) {
        if (n.length >= 2 && !vocab[n]) {
          vocab[n] = { source: 'student', priority: 1 };
        }
      });
    }
  }

  var vocabSize = Object.keys(vocab).length;
  if (vocabSize === 0) {
    return { text: text, applied: [], totalReplacements: 0, vocabularySize: 0 };
  }

  var result = text;
  var applied = [];
  var totalReplacements = 0;

  // ── Strategy 2: Single-digit substitution ──
  // Find all multi-digit numbers in student text
  var studentNums = result.match(/\d+(?:\.\d+)?/g) || [];
  var seen = {};
  studentNums.forEach(function(num) {
    if (num.length < 2 || seen[num] || vocab[num]) return;  // skip single digits and already-in-vocab
    seen[num] = true;

    // Try swapping each digit position using confusion pairs
    var candidates = [];
    var digits = num.split('');
    for (var pos = 0; pos < digits.length; pos++) {
      var origDigit = digits[pos];
      OCR_DIGIT_CONFUSION_PAIRS_.forEach(function(pair) {
        var swapDigit = null;
        if (pair[0] === origDigit) swapDigit = pair[1];
        else if (pair[1] === origDigit) swapDigit = pair[0];
        if (!swapDigit) return;

        var candidate = digits.slice();
        candidate[pos] = swapDigit;
        var candidateStr = candidate.join('');
        if (vocab[candidateStr] && (vocab[candidateStr].source === 'ms' || vocab[candidateStr].source === 'q')) {
          candidates.push({ value: candidateStr, source: vocab[candidateStr].source, pos: pos, from: origDigit, to: swapDigit });
        }
      });
    }

    // Only correct if exactly 1 unambiguous candidate match
    if (candidates.length === 1) {
      var c = candidates[0];
      var re = new RegExp('(?<!\\d)' + escapeRegExp_(num) + '(?!\\d)', 'g');
      var matches = result.match(re);
      if (matches && matches.length > 0) {
        result = result.replace(re, c.value);
        applied.push({
          from: num,
          to: c.value,
          reason: 'Digit swap [' + c.from + '\u2192' + c.to + '] pos ' + c.pos + ' (' + c.source + ' vocab match)',
          count: matches.length
        });
        totalReplacements += matches.length;
      }
    }
  });

  // ── Strategy 3: Expression-fragment matching ──
  // Look for "var = number" patterns in mark scheme
  if (markschemePoints && markschemePoints.length > 0) {
    var msExpressions = [];
    markschemePoints.forEach(function(p) {
      var req = p.requirement || '';
      // Match patterns like "x = 5", "n = 12", "k=3.5"
      var exprRe = /([a-zA-Z])\s*=\s*(-?\d+(?:\.\d+)?)/g;
      var m;
      while ((m = exprRe.exec(req)) !== null) {
        msExpressions.push({ variable: m[1], value: m[2] });
      }
    });

    msExpressions.forEach(function(expr) {
      // Look for same variable with a different number in student text
      var studentExprRe = new RegExp(escapeRegExp_(expr.variable) + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?)', 'g');
      var sm;
      while ((sm = studentExprRe.exec(result)) !== null) {
        var studentVal = sm[1];
        if (studentVal === expr.value) continue;  // already correct
        if (studentVal.length !== expr.value.length) continue;  // different magnitude — likely not a swap

        // Check if single-digit swap away
        var diffCount = 0;
        for (var d = 0; d < studentVal.length; d++) {
          if (studentVal[d] !== expr.value[d]) diffCount++;
        }
        if (diffCount === 1) {
          // Verify the differing digits are in our confusion pairs
          var diffPos = -1;
          for (var dd = 0; dd < studentVal.length; dd++) {
            if (studentVal[dd] !== expr.value[dd]) { diffPos = dd; break; }
          }
          var isPair = OCR_DIGIT_CONFUSION_PAIRS_.some(function(pair) {
            return (pair[0] === studentVal[diffPos] && pair[1] === expr.value[diffPos]) ||
                   (pair[1] === studentVal[diffPos] && pair[0] === expr.value[diffPos]);
          });
          if (isPair) {
            var fullFrom = expr.variable + sm[0].substring(expr.variable.length, sm[0].length - studentVal.length) + studentVal;
            var fullTo = expr.variable + sm[0].substring(expr.variable.length, sm[0].length - studentVal.length) + expr.value;
            result = result.substring(0, sm.index) + fullTo + result.substring(sm.index + sm[0].length);
            applied.push({
              from: fullFrom,
              to: fullTo,
              reason: 'Expression match: ' + expr.variable + '=' + studentVal + ' \u2192 ' + expr.variable + '=' + expr.value + ' (ms)',
              count: 1
            });
            totalReplacements++;
          }
        }
      }
    });
  }

  return { text: result, applied: applied, totalReplacements: totalReplacements, vocabularySize: vocabSize };
}

// ─────────────────────────────────────────────────────────────
// Phase 5A5: Low-confidence + mark scheme benefit-of-the-doubt
// ─────────────────────────────────────────────────────────────

/**
 * When a Mathpix line has LOW confidence, check whether numbers in that
 * line are a single-digit-swap away from a mark scheme value.  If so,
 * substitute — giving the student the benefit of the doubt over the OCR.
 *
 * Unlike 5A4 (which requires exactly 1 unambiguous candidate), this phase
 * is MORE permissive: it fires even when multiple swap candidates exist,
 * as long as *all* candidates point to the SAME mark scheme value.
 * Justification: the line-level confidence is already below threshold,
 * so the OCR is admitting it isn't sure.
 *
 * Key safeguard: only fires when per-line confidence exists AND is below
 * MSA_LOW_CONF_THRESHOLD.  Lines without confidence data are skipped.
 *
 * @param {string} text           Student OCR text (post-5A4)
 * @param {Array|null} msPoints   Mark scheme points from Drive JSON
 * @param {Array}  lineData       Mathpix line_data with per-line confidence
 * @returns {object} { text, applied[], totalReplacements, lowConfLineCount, threshold }
 */
function lowConfidenceMarkSchemeCorrection_(text, msPoints, lineData) {
  var threshold = (typeof MSA_LOW_CONF_THRESHOLD !== 'undefined') ? MSA_LOW_CONF_THRESHOLD : 0.90;
  var empty = { text: text || '', applied: [], totalReplacements: 0, lowConfLineCount: 0, threshold: threshold };
  if (!text || !msPoints || msPoints.length === 0 || !lineData || lineData.length === 0) return empty;

  // Build mark scheme number set
  var msNums = {};
  msPoints.forEach(function(p) {
    var matches = (p.requirement || '').match(/\d+(?:\.\d+)?/g) || [];
    matches.forEach(function(n) { if (n.length >= 2) msNums[n] = true; });
  });
  if (Object.keys(msNums).length === 0) return empty;

  // Identify low-confidence lines
  var lowConfLines = [];
  lineData.forEach(function(line, idx) {
    // Mathpix may use 'confidence', 'confidence_rate', or 'conf'
    var conf = line.confidence !== undefined ? line.confidence
             : line.confidence_rate !== undefined ? line.confidence_rate
             : line.conf !== undefined ? line.conf
             : null;
    if (conf !== null && conf < threshold) {
      lowConfLines.push({ text: line.text || '', confidence: conf, index: idx });
    }
  });

  if (lowConfLines.length === 0) return empty;

  var result = text;
  var applied = [];
  var totalReplacements = 0;
  var alreadyCorrected = {};  // prevent double-corrections

  lowConfLines.forEach(function(lowLine) {
    // Find all multi-digit numbers in this low-confidence line
    var lineNums = (lowLine.text).match(/\d+(?:\.\d+)?/g) || [];
    lineNums.forEach(function(num) {
      if (num.length < 2 || msNums[num] || alreadyCorrected[num]) return;

      // Try every single-digit swap via confusion pairs
      var candidates = {};  // candidateStr → count of ways to reach it
      var digits = num.split('');
      for (var pos = 0; pos < digits.length; pos++) {
        var origDigit = digits[pos];
        OCR_DIGIT_CONFUSION_PAIRS_.forEach(function(pair) {
          var swapDigit = null;
          if (pair[0] === origDigit) swapDigit = pair[1];
          else if (pair[1] === origDigit) swapDigit = pair[0];
          if (!swapDigit) return;

          var trial = digits.slice();
          trial[pos] = swapDigit;
          var trialStr = trial.join('');
          if (msNums[trialStr]) {
            candidates[trialStr] = (candidates[trialStr] || 0) + 1;
          }
        });
      }

      var uniqueCandidates = Object.keys(candidates);
      // Fire if ALL swap paths converge on a single MS value
      if (uniqueCandidates.length === 1) {
        var msVal = uniqueCandidates[0];
        var re = new RegExp('(?<!\\d)' + escapeRegExp_(num) + '(?!\\d)', 'g');
        var matches = result.match(re);
        if (matches && matches.length > 0) {
          result = result.replace(re, msVal);
          applied.push({
            from: num,
            to: msVal,
            reason: 'Low-conf line L' + lowLine.index + ' \u2192 MS match (benefit of doubt)',
            lineConf: lowLine.confidence,
            count: matches.length
          });
          totalReplacements += matches.length;
          alreadyCorrected[num] = true;
        }
      }
    });
  });

  return { text: result, applied: applied, totalReplacements: totalReplacements, lowConfLineCount: lowConfLines.length, threshold: threshold };
}

// ─────────────────────────────────────────────────────────────
// Mark-scheme-aware suggestion generator
// ─────────────────────────────────────────────────────────────

/**
 * Glyph confusion pairs for suggestion generation.
 * Each entry: { ocrChar, suggestedChar, description } — when OCR produces
 * ocrChar adjacent to a mark-scheme number, suggest it might be suggestedChar.
 */
var SUGGESTION_GLYPH_PAIRS_ = [
  { ocrChar: '7', suggested: '>', desc: '">" misread as "7"' },
  { ocrChar: '2', suggested: '<', desc: '"<" misread as "2"' },
  { ocrChar: '1', suggested: '|', desc: '"|" misread as "1"' },
  { ocrChar: '7', suggested: '/', desc: '"/" misread as "7"' },
  { ocrChar: '1', suggested: '/', desc: '"/" misread as "1"' }
];

/**
 * Generate proactive correction suggestions by comparing OCR text against
 * mark-scheme context. These are NOT auto-applied — they're surfaced in the
 * UI for the teacher to approve or dismiss.
 *
 * Strategies:
 *   1. Operator-digit fusion: "7335" might be ">335" (335 in mark scheme)
 *   2. Near-miss numbers: OCR shows "15" but mark scheme has "13"
 *   3. Notation confusion: OCR shows "a_n" but problem uses "u_n"
 *
 * @param {string} studentText  The student's OCR text (after automatic cleanup)
 * @param {Array}  markschemePoints  Mark scheme points from Drive JSON
 * @param {string} [questionText]  The printed question text
 * @returns {Array} Array of { type, ocrValue, suggestedValue, reason, position, confidence }
 */
function generateMarkSchemeSuggestions_(studentText, markschemePoints, questionText) {
  if (!studentText || !markschemePoints || markschemePoints.length === 0) return [];

  var suggestions = [];
  var msNumbers = extractMarkschemeNumbers_(markschemePoints);
  var allMsText = markschemePoints.map(function(p) { return p.requirement || ''; }).join('\n');

  // Build set of all known numbers (mark scheme + question) to avoid false positives
  var knownNumbers = {};
  msNumbers.forEach(function(n) { knownNumbers[n] = true; });
  if (questionText) {
    var qNums = questionText.match(/\d+(?:\.\d+)?/g) || [];
    qNums.forEach(function(n) { if (n.length >= 2) knownNumbers[n] = true; });
  }

  // ── Strategy 1: Operator-digit fusion ──
  // Look for digit+msNumber patterns where the digit could be a misread operator
  SUGGESTION_GLYPH_PAIRS_.forEach(function(pair) {
    msNumbers.forEach(function(msNum) {
      // Check: digit BEFORE the number (e.g. "7335" = ">" + "335")
      var fusedBefore = pair.ocrChar + msNum;
      if (knownNumbers[fusedBefore]) return; // legitimate number

      var reBefore = new RegExp('(?<!\\d)' + escapeRegExp_(fusedBefore) + '(?!\\d)', 'g');
      var match;
      while ((match = reBefore.exec(studentText)) !== null) {
        suggestions.push({
          type: 'operator_digit',
          ocrValue: fusedBefore,
          suggestedValue: pair.suggested + ' ' + msNum,
          reason: pair.desc + ' — ' + msNum + ' appears in mark scheme',
          position: match.index,
          confidence: 0.75
        });
      }

      // Check: digit AFTER the number (e.g. "3357" = "335" + ">")
      var fusedAfter = msNum + pair.ocrChar;
      if (knownNumbers[fusedAfter]) return;

      var reAfter = new RegExp('(?<!\\d)' + escapeRegExp_(fusedAfter) + '(?!\\d)', 'g');
      while ((match = reAfter.exec(studentText)) !== null) {
        suggestions.push({
          type: 'operator_digit',
          ocrValue: fusedAfter,
          suggestedValue: msNum + ' ' + pair.suggested,
          reason: pair.desc + ' (trailing) — ' + msNum + ' appears in mark scheme',
          position: match.index,
          confidence: 0.65
        });
      }
    });
  });

  // ── Strategy 2: Near-miss numbers (digit swaps visible in the text) ──
  // Find numbers in student text that don't appear in mark scheme but are
  // close to a mark-scheme number (same length, 1 digit different)
  var studentNums = studentText.match(/\d{2,}/g) || [];
  var uniqueStudentNums = {};
  studentNums.forEach(function(n) { uniqueStudentNums[n] = true; });

  Object.keys(uniqueStudentNums).forEach(function(sNum) {
    if (knownNumbers[sNum]) return; // already a known value, skip

    msNumbers.forEach(function(msNum) {
      if (sNum.length !== msNum.length) return; // only same-length comparisons

      // Count differing digits
      var diffs = 0;
      var diffPositions = [];
      for (var i = 0; i < sNum.length; i++) {
        if (sNum[i] !== msNum[i]) {
          diffs++;
          diffPositions.push({ pos: i, ocr: sNum[i], ms: msNum[i] });
        }
      }
      if (diffs !== 1) return; // only suggest for single-digit differences

      var dp = diffPositions[0];
      var reason = 'OCR reads "' + sNum + '" but mark scheme expects "' + msNum +
        '" (digit ' + (dp.pos + 1) + ': "' + dp.ocr + '" → "' + dp.ms + '")';

      // Find all occurrences in student text
      var re = new RegExp('(?<!\\d)' + escapeRegExp_(sNum) + '(?!\\d)', 'g');
      var match;
      while ((match = re.exec(studentText)) !== null) {
        suggestions.push({
          type: 'near_miss_number',
          ocrValue: sNum,
          suggestedValue: msNum,
          reason: reason,
          position: match.index,
          confidence: 0.60
        });
      }
    });
  });

  // ── Strategy 3: Notation confusion (already handled by 5D, just log mismatches) ──
  var qVars = extractNotationVariables_(questionText || '');
  var msVars = extractNotationVariables_(allMsText);
  var studentVars = extractNotationVariables_(studentText);

  NOTATION_CONFUSION_PAIRS_.forEach(function(pair) {
    var a = pair[0], b = pair[1];
    var canonicalLetter = null;
    if ((qVars[a] || msVars[a]) && !(qVars[b] || msVars[b])) canonicalLetter = a;
    if ((qVars[b] || msVars[b]) && !(qVars[a] || msVars[a])) canonicalLetter = b;

    if (!canonicalLetter) return;

    var wrongLetter = (canonicalLetter === a) ? b : a;
    if (!studentVars[wrongLetter]) return; // student doesn't use the wrong letter

    studentVars[wrongLetter].forEach(function(notation) {
      var corrected = notation.replace(new RegExp('^' + escapeRegExp_(wrongLetter)), canonicalLetter);
      var re = new RegExp(escapeRegExp_(notation) + '(?![a-zA-Z])', 'g');
      var match;
      while ((match = re.exec(studentText)) !== null) {
        suggestions.push({
          type: 'notation_confusion',
          ocrValue: notation,
          suggestedValue: corrected,
          reason: 'Problem uses "' + canonicalLetter + '" notation, not "' + wrongLetter + '"',
          position: match.index,
          confidence: 0.80
        });
      }
    });
  });

  // Deduplicate by position + ocrValue
  var seen = {};
  suggestions = suggestions.filter(function(s) {
    var key = s.position + ':' + s.ocrValue + ':' + s.suggestedValue;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });

  // Sort by position in text
  suggestions.sort(function(a, b) { return a.position - b.position; });

  return suggestions;
}

/**
 * Calculate a composite confidence score for OCR results.
 * Mathpix raw confidence is often very low (1-5%) for handwritten content
 * because it's trained on printed math. This function provides a more
 * meaningful confidence based on multiple quality indicators.
 * 
 * @param {object} ocrResult The OCR result object from Mathpix
 * @param {number} rawConfidence The raw confidence from Mathpix (0-1)
 * @returns {number} Composite confidence score (0-1)
 */
function calculateCompositeConfidence_(ocrResult, rawConfidence) {
  var score = 0;
  var factors = 0;
  
  // Factor 1: Did we get any text at all?
  var text = ocrResult.text || '';
  if (text.length > 10) {
    score += 0.3;  // 30% for having substantial text
  } else if (text.length > 0) {
    score += 0.1;  // 10% for having some text
  }
  factors++;
  
  // Factor 2: Does the text contain math notation?
  var hasMath = text.includes('\\') || text.includes('=') || /\d+/.test(text);
  if (hasMath) {
    score += 0.25;  // 25% for containing math-like content
  }
  factors++;
  
  // Factor 3: Line data quality - do we have structured line data?
  var lineData = ocrResult.line_data || [];
  if (lineData.length > 3) {
    score += 0.2;  // 20% for multiple lines detected
  } else if (lineData.length > 0) {
    score += 0.1;  // 10% for some lines
  }
  factors++;
  
  // Factor 4: Mathpix raw confidence (weighted lower since it's often inaccurate for handwriting)
  // Scale it to contribute up to 25%
  score += rawConfidence * 0.25;
  factors++;
  
  // Ensure we return a value between 0 and 1
  var composite = Math.min(1.0, Math.max(0, score));
  
  return composite;
}

/**
 * Save corrected OCR text for a student work file.
 * @param {string} fileId The Google Drive File ID.
 * @param {string} correctedText The corrected OCR text.
 * @returns {object} Success status.
 */
function saveStudentOcrCorrection(fileId, correctedText, originalText, questionCode, studentId, examName) {
  try {
    const cfg = msaGetConfig_();
    const file = DriveApp.getFileById(fileId);
    
    // Save to a designated folder for OCR corrections
    const parentFolderId = cfg.MSA_PARENT_FOLDER_ID || DriveApp.getRootFolder().getId();
    const parentFolder = DriveApp.getFolderById(parentFolderId);
    
    // Create or get OCR corrections root folder
    var correctionsFolderIterator = parentFolder.getFoldersByName('_OCR_Corrections');
    var correctionsFolder;
    if (correctionsFolderIterator.hasNext()) {
      correctionsFolder = correctionsFolderIterator.next();
    } else {
      correctionsFolder = parentFolder.createFolder('_OCR_Corrections');
    }
    
    // ── Organize by student + question ──
    // Structure: _OCR_Corrections / {studentId} / {questionCode} / corrected_ocr.txt
    // If no studentId from QR, fall back to file-name-based storage
    var targetFolder = correctionsFolder;
    var correctionFileName;
    
    if (studentId && questionCode) {
      // Create student subfolder
      var studentFolderIter = correctionsFolder.getFoldersByName(studentId);
      var studentFolder;
      if (studentFolderIter.hasNext()) {
        studentFolder = studentFolderIter.next();
      } else {
        studentFolder = correctionsFolder.createFolder(studentId);
      }
      // Create question subfolder
      var questionFolderIter = studentFolder.getFoldersByName(questionCode);
      var questionFolder;
      if (questionFolderIter.hasNext()) {
        questionFolder = questionFolderIter.next();
      } else {
        questionFolder = studentFolder.createFolder(questionCode);
      }
      targetFolder = questionFolder;
      correctionFileName = 'corrected_ocr.txt';
      
      // Also save metadata JSON
      var metaJson = JSON.stringify({
        studentId: studentId,
        questionCode: questionCode,
        examName: examName || '',
        sourceFileId: fileId,
        sourceFileName: file.getName(),
        savedAt: new Date().toISOString(),
        textLength: correctedText.length
      }, null, 2);
      msaUpsertTextFile_(targetFolder, 'metadata.json', metaJson);
      msaLog_('Saved corrected OCR for student ' + studentId + ' / question ' + questionCode);
    } else {
      // No QR data — fall back to flat file with filename
      correctionFileName = file.getName() + '_corrected.txt';
      msaLog_('No QR data — saving as ' + correctionFileName);
    }
    
    // Save/update the corrected text
    var existingFiles = targetFolder.getFilesByName(correctionFileName);
    if (existingFiles.hasNext()) {
      existingFiles.next().setContent(correctedText);
    } else {
      targetFolder.createFile(correctionFileName, correctedText);
    }
    
    // ── LEARNING: Extract and save correction patterns ──
    var learnResult = { saved: 0, updated: 0, total: 0 };
    var studentLearnResult = { saved: 0, updated: 0, total: 0 };
    var diagnostics = { correctionsExtracted: 0, correctionsFiltered: 0 };
    if (originalText && originalText.trim() !== correctedText.trim()) {
      try {
        var corrections = extractCorrections_(originalText, correctedText);
        diagnostics.correctionsExtracted = corrections.length;
        msaLog_('📊 Diff engine found ' + corrections.length + ' correction(s) from user edits');
        if (corrections.length > 0) {
          // Log each extracted correction for debugging
          corrections.forEach(function(c, idx) {
            msaLog_('  [' + idx + '] ' + c.type + ': "' + (c.original || '').substring(0, 60) + '" → "' + (c.corrected || '').substring(0, 60) + '"');
          });
          // 1. Global learning (class-wide patterns)
          learnResult = saveLearnedCorrections_(corrections, {
            fileId: fileId,
            questionCode: questionCode || '',
            studentId: studentId || ''
          });
          diagnostics.correctionsFiltered = corrections.length - learnResult.saved - learnResult.updated;
          msaLog_('🧠 Global: ' + corrections.length + ' patterns (' +
                  learnResult.saved + ' new, ' + learnResult.updated + ' reinforced, ' +
                  diagnostics.correctionsFiltered + ' filtered)');

          // 2. Per-student profile (writer-adaptive)
          if (studentId) {
            try {
              studentLearnResult = saveStudentCorrections_(studentId, corrections, {
                fileId: fileId,
                questionCode: questionCode || ''
              });
              msaLog_('👤 [' + studentId + '] Profile: ' + corrections.length + ' patterns (' +
                      studentLearnResult.saved + ' new, ' + studentLearnResult.updated + ' reinforced)');
            } catch (profileErr) {
              msaWarn_('Student profile save failed (non-fatal): ' + profileErr.message);
            }
          }
        }
      } catch (learnErr) {
        msaWarn_('Learning pass failed (non-fatal): ' + learnErr.message);
      }
    }
    
    return {
      status: 'success',
      studentId: studentId || null,
      questionCode: questionCode || null,
      learned: learnResult,
      studentLearned: studentLearnResult,
      diagnostics: diagnostics
    };
  } catch (e) {
    msaErr_('Error saving OCR correction: ' + e.message);
    throw new Error('Failed to save correction: ' + e.message);
  }
}

/**
 * Find corner markers in OCR detection result
 * Looks for text markers: «TL», «TR», «BL», «BR» (or variations like TL, TR, BL, BR)
 * @param {object} ocrResult The OCR detection result
 * @returns {Array} Array of marker positions {x, y, corner}
 */
function findCornerMarkersInOcrResult(ocrResult) {
  var markers = [];
  
  // Look for text markers in OCR line data
  if (ocrResult.line_data && Array.isArray(ocrResult.line_data)) {
    msaLog_('=== SCANNING ' + ocrResult.line_data.length + ' LINES FOR MARKERS ===');
    
    // Log ALL detected text for debugging
    ocrResult.line_data.forEach(function(line, idx) {
      var text = (line.text || '').trim();
      var bbox = line.bbox || line.bounding_box;
      var pos = bbox ? ' @ (' + bbox[0].toFixed(0) + ',' + bbox[1].toFixed(0) + ')' : '';
      msaLog_('Line ' + idx + ': "' + text.substring(0, 50).replace(/\n/g, '\\n') + '"' + pos);
    });
    
    msaLog_('=== END LINE DUMP ===');
    
    ocrResult.line_data.forEach(function(line, idx) {
      var bbox = line.bbox || line.bounding_box;
      if (!bbox || bbox.length < 4) return;
      
      var width = bbox[2] - bbox[0];
      var height = bbox[3] - bbox[1];
      var rawText = (line.text || '');
      
      // Remove ALL whitespace and newlines, convert to uppercase
      var cleanText = rawText.replace(/[\n\r\s]+/g, '').toUpperCase();
      
      // Simple check: text containing TL, TR, BL, or BR (allow up to 20 chars for brackets/special chars)
      var foundLabel = null;
      if (cleanText.length <= 20) {
        if (cleanText.indexOf('TL') !== -1) foundLabel = 'TL';
        else if (cleanText.indexOf('TR') !== -1) foundLabel = 'TR';
        else if (cleanText.indexOf('BL') !== -1) foundLabel = 'BL';
        else if (cleanText.indexOf('BR') !== -1) foundLabel = 'BR';
        
        if (foundLabel) {
          msaLog_('Marker candidate line ' + idx + ': clean="' + cleanText + '" len=' + cleanText.length + ' -> ' + foundLabel);
        }
      }
      
      if (foundLabel) {
        var centerX = (bbox[0] + bbox[2]) / 2;
        var centerY = (bbox[1] + bbox[3]) / 2;
        
        markers.push({
          x: centerX,
          y: centerY,
          bbox: bbox,
          width: width,
          height: height,
          text: foundLabel,
          rawText: cleanText,
          detectedAs: 'text-marker'
        });
        
        msaLog_('✅ MARKER FOUND: ' + foundLabel + ' at (' + centerX.toFixed(0) + ',' + centerY.toFixed(0) + ')');
      }
    });
  } else {
    msaLog_('⚠️ No line_data in OCR result! Keys: ' + Object.keys(ocrResult).join(', '));
  }
  
  msaLog_('Found ' + markers.length + ' potential markers');
  
  // If we didn't find all 4 in line_data, search the raw text
  if (markers.length < 4 && ocrResult.text) {
    msaLog_('Searching raw OCR text for markers (found ' + markers.length + ' so far)...');
    var rawTextClean = ocrResult.text.replace(/[\n\r\s]+/g, '').toUpperCase();
    msaLog_('Raw text (cleaned) preview: ' + rawTextClean.substring(0, 300));
    
    var markerLabels = ['TL', 'TR', 'BL', 'BR'];
    markerLabels.forEach(function(label) {
      // Skip if we already found this marker
      var alreadyFound = markers.some(function(m) { return m.text === label; });
      if (alreadyFound) return;
      
      if (rawTextClean.indexOf(label) !== -1) {
        msaLog_('Found ' + label + ' in raw text (no position data available)');
      }
    });
  }
  
  // FALLBACK: If we found only BL and BR (bottom markers), estimate TL and TR
  // This works because answer boxes have consistent height ratios
  if (markers.length === 2) {
    var hasbl = markers.some(function(m) { return m.text === 'BL'; });
    var hasbr = markers.some(function(m) { return m.text === 'BR'; });
    
    if (hasbl && hasbr) {
      msaLog_('Only BL and BR found - estimating TL and TR from image dimensions');
      var bl = markers.find(function(m) { return m.text === 'BL'; });
      var br = markers.find(function(m) { return m.text === 'BR'; });
      
      // Estimate top Y as roughly 40% from top of image (answer box typically starts there)
      var imageHeight = ocrResult.image_height || 1000;
      var estimatedTopY = imageHeight * 0.35;
      
      markers.push({
        x: bl.x,
        y: estimatedTopY,
        text: 'TL',
        estimated: true
      });
      markers.push({
        x: br.x,
        y: estimatedTopY,
        text: 'TR',
        estimated: true
      });
      msaLog_('Estimated TL at (' + bl.x.toFixed(0) + ',' + estimatedTopY.toFixed(0) + ')');
      msaLog_('Estimated TR at (' + br.x.toFixed(0) + ',' + estimatedTopY.toFixed(0) + ')');
    }
  }
  
  msaLog_('Found ' + markers.length + ' potential markers');
  
  // If we found exactly 4 markers with labels, use them directly
  if (markers.length === 4) {
    // Try to match markers to corners by their labels
    var labeledMarkers = {};
    markers.forEach(function(m) {
      if (m.text) labeledMarkers[m.text] = m;
    });
    
    // If all 4 have correct labels, assign corners based on labels
    if (labeledMarkers.TL && labeledMarkers.TR && labeledMarkers.BL && labeledMarkers.BR) {
      labeledMarkers.TL.corner = 'top-left';
      labeledMarkers.TR.corner = 'top-right';
      labeledMarkers.BL.corner = 'bottom-left';
      labeledMarkers.BR.corner = 'bottom-right';
      
      markers = [labeledMarkers.TL, labeledMarkers.TR, labeledMarkers.BL, labeledMarkers.BR];
      
      msaLog_('QR markers identified by labels: TL(' + labeledMarkers.TL.x.toFixed(0) + ',' + labeledMarkers.TL.y.toFixed(0) + 
             '), TR(' + labeledMarkers.TR.x.toFixed(0) + ',' + labeledMarkers.TR.y.toFixed(0) + 
             '), BL(' + labeledMarkers.BL.x.toFixed(0) + ',' + labeledMarkers.BL.y.toFixed(0) + 
             '), BR(' + labeledMarkers.BR.x.toFixed(0) + ',' + labeledMarkers.BR.y.toFixed(0) + ')');
    } else {
      // Fall back to position-based detection
      markers.sort(function(a, b) {
        if (Math.abs(a.y - b.y) < 50) return a.x - b.x;
        return a.y - b.y;
      });
      
      var topTwo = markers.slice(0, 2).sort(function(a, b) { return a.x - b.x; });
      var bottomTwo = markers.slice(2, 4).sort(function(a, b) { return a.x - b.x; });
      
      topTwo[0].corner = 'top-left';
      topTwo[1].corner = 'top-right';
      bottomTwo[0].corner = 'bottom-left';
      bottomTwo[1].corner = 'bottom-right';
      
      msaLog_('Markers classified by position');
    }
  }
  
  return markers;
}

/**
 * Calculate bounding rectangle from corner markers
 * @param {Array} markers Array of 4 marker objects
 * @returns {object} Bounds {x1, y1, x2, y2, width, height}
 */
function calculateBoundingRectFromMarkers(markers) {
  var xs = markers.map(function(m) { return m.x; });
  var ys = markers.map(function(m) { return m.y; });
  
  var minX = Math.min.apply(Math, xs);
  var minY = Math.min.apply(Math, ys);
  var maxX = Math.max.apply(Math, xs);
  var maxY = Math.max.apply(Math, ys);
  
  // Markers are now INSIDE the corners, so the bounding box is the marker area
  // Add small padding to include the marker text itself
  var padding = 5;
  
  var x1 = Math.round(minX - padding);
  var y1 = Math.round(minY - padding);
  var x2 = Math.round(maxX + padding);
  var y2 = Math.round(maxY + padding);
  
  return {
    x1: Math.max(0, x1),
    y1: Math.max(0, y1),
    x2: x2,
    y2: y2,
    width: x2 - x1,
    height: y2 - y1
  };
}

/**
 * Filter OCR results to only include content inside a region
 * @param {object} ocrResult Full OCR result from Mathpix
 * @param {object} region {x1, y1, x2, y2} bounding box
 * @returns {object} Filtered OCR result
 */
function filterOcrResultsByRegion(ocrResult, region) {
  var filtered = {
    text: '',
    latex_styled: ocrResult.latex_styled || '',
    confidence: ocrResult.confidence,
    image_width: ocrResult.image_width,
    image_height: ocrResult.image_height,
    line_data: []
  };
  
  if (!ocrResult.line_data || !Array.isArray(ocrResult.line_data)) {
    msaLog_('No line_data to filter');
    return ocrResult;
  }
  
  // Debug: Log the region and some sample lines
  msaLog_('Filter region: X=' + region.x1 + '-' + region.x2 + ', Y=' + region.y1 + '-' + region.y2);
  msaLog_('Image size: ' + ocrResult.image_width + 'x' + ocrResult.image_height);
  msaLog_('line_data length: ' + ocrResult.line_data.length);
  
  // Debug: Log first line's keys to see bbox structure
  if (ocrResult.line_data.length > 0) {
    var firstLine = ocrResult.line_data[0];
    msaLog_('First line keys: ' + Object.keys(firstLine).join(', '));
    msaLog_('First line bbox: ' + JSON.stringify(firstLine.bbox));
    msaLog_('First line cnt: ' + JSON.stringify(firstLine.cnt));
  }
  
  var textParts = [];
  var insideCount = 0;
  var outsideCount = 0;
  
  ocrResult.line_data.forEach(function(line, idx) {
    // Mathpix returns coordinates in 'cnt' as a polygon array: [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
    // Convert to bounding box
    var x1, y1, x2, y2;
    
    if (line.cnt && Array.isArray(line.cnt) && line.cnt.length >= 4) {
      // Extract min/max from polygon points
      var xs = line.cnt.map(function(p) { return p[0]; });
      var ys = line.cnt.map(function(p) { return p[1]; });
      x1 = Math.min.apply(null, xs);
      x2 = Math.max.apply(null, xs);
      y1 = Math.min.apply(null, ys);
      y2 = Math.max.apply(null, ys);
    } else if (line.bbox && line.bbox.length >= 4) {
      // Fallback to bbox if present
      x1 = line.bbox[0];
      y1 = line.bbox[1];
      x2 = line.bbox[2];
      y2 = line.bbox[3];
    } else {
      // No coordinates available, skip this line
      return;
    }
    
    // Get center of the line
    var centerX = (x1 + x2) / 2;
    var centerY = (y1 + y2) / 2;
    
    // Debug first few lines
    if (idx < 5) {
      msaLog_('Line ' + idx + ': center=(' + centerX.toFixed(0) + ',' + centerY.toFixed(0) + ') region=(' + region.x1 + '-' + region.x2 + ',' + region.y1 + '-' + region.y2 + ') text="' + (line.text || '').substring(0, 30) + '"');
    }
    
    // Check if center is inside the region
    if (centerX >= region.x1 && centerX <= region.x2 &&
        centerY >= region.y1 && centerY <= region.y2) {
      insideCount++;
      
      // Skip marker labels themselves
      var text = (line.text || '').trim();
      if (/^\[?(TL|TR|BL|BR)\]?$/i.test(text)) {
        return; // Skip marker text
      }
      
      filtered.line_data.push(line);
      if (line.text) {
        textParts.push(line.text);
      }
    } else {
      outsideCount++;
    }
  });
  
  msaLog_('Filter result: ' + insideCount + ' inside, ' + outsideCount + ' outside');
  filtered.text = textParts.join('\n');
  msaLog_('Filtered from ' + ocrResult.line_data.length + ' to ' + filtered.line_data.length + ' lines');
  
  return filtered;
}

/**
 * Look up stored box coordinates from the database
 * @param {string} questionCode The question code (e.g., "14M.2.AHL.TZ2.H_1")
 * @param {string} position "Q1" or "Q2+" (defaults to "Q2+" if not specified)
 * @returns {object|null} Coordinates {xPct, yPct, widthPct, heightPct} or null if not found
 */
function lookupBoxCoordinates(questionCode, position) {
  if (!questionCode) return null;
  position = position || "Q2+";
  var t0 = Date.now();
  
  try {
    var dbSS = SpreadsheetApp.openById(MSA_QUESTION_META_SPREADSHEET_ID);
    var sheet = dbSS.getSheetByName("BoxCoordinates");
    
    if (!sheet) {
      msaLog_('  [CROP.db] BoxCoordinates sheet not found Δ' + (Date.now() - t0) + 'ms');
      return null;
    }
    
    var data = sheet.getDataRange().getValues();
    msaLog_('  [CROP.db] sheet loaded rows=' + data.length + ' Δ' + (Date.now() - t0) + 'ms');
    
    // First try exact match (questionCode + position)
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == questionCode && data[i][1] == position) {
        var coords = {
          questionCode: data[i][0],
          position: data[i][1],
          xPct: parseFloat(data[i][2]),
          yPct: parseFloat(data[i][3]),
          widthPct: parseFloat(data[i][4]),
          heightPct: parseFloat(data[i][5])
        };
        msaLog_('  [CROP.db] EXACT match row=' + i + ' x=' + coords.xPct + '% y=' + coords.yPct + '% w=' + coords.widthPct + '% h=' + coords.heightPct + '% Δ' + (Date.now() - t0) + 'ms');
        return coords;
      }
    }
    
    // Fallback: try other position
    var fallbackPosition = (position === "Q1") ? "Q2+" : "Q1";
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == questionCode && data[i][1] == fallbackPosition) {
        var coords = {
          questionCode: data[i][0],
          position: data[i][1],
          xPct: parseFloat(data[i][2]),
          yPct: parseFloat(data[i][3]),
          widthPct: parseFloat(data[i][4]),
          heightPct: parseFloat(data[i][5])
        };
        msaLog_('  [CROP.db] FALLBACK match row=' + i + ' pos=' + fallbackPosition + ' Δ' + (Date.now() - t0) + 'ms');
        return coords;
      }
    }
    
    msaLog_('  [CROP.db] MISS qCode=' + questionCode + ' pos=' + position + ' scanned=' + (data.length - 1) + 'rows Δ' + (Date.now() - t0) + 'ms');
    return null;
  } catch (e) {
    msaErr_('  [CROP.db] ERR: ' + e.message + ' Δ' + (Date.now() - t0) + 'ms');
    return null;
  }
}

/**
 * Decode QR code from an image using free QR API (api.qrserver.com)
 * Resizes large images first to improve QR detection reliability.
 * @param {string} fileId The Google Drive File ID of the image
 * @returns {object|null} Decoded QR data {studentId, questionCode, examName} or null
 */
function decodeQrFromImage(fileId) {
  var t0 = Date.now();
  // ── Cache check: same file always has the same QR code ──
  var cacheKey = 'qr_decode_' + fileId;
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      var parsed = JSON.parse(cached);
      msaLog_('  [QR.cache] HIT key=' + cacheKey.substring(0, 25) + ' data=' + JSON.stringify(parsed).substring(0, 80) + ' Δ' + (Date.now() - t0) + 'ms');
      return parsed;
    }
  } catch (cacheErr) {
    msaLog_('  [QR.cache] ERR: ' + cacheErr.message);
  }
  msaLog_('  [QR.cache] MISS → calling qrserver.com API');

  try {
    var tDrive = Date.now();
    var file = DriveApp.getFileById(fileId);
    var fileSize = file.getSize();
    var fileMime = file.getMimeType();
    msaLog_('  [QR.drive] size=' + fileSize + 'B (' + Math.round(fileSize / 1024) + 'KB) mime=' + fileMime + ' Δ' + (Date.now() - tDrive) + 'ms');
    
    var sendBlob = null;
    if (fileSize > 500000) {
      msaLog_('  [QR.resize] file>500KB → fetching thumbnail');
      try {
        var token = ScriptApp.getOAuthToken();
        var metaUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=thumbnailLink';
        var tMeta = Date.now();
        var metaResp = UrlFetchApp.fetch(metaUrl, {
          headers: { 'Authorization': 'Bearer ' + token },
          muteHttpExceptions: true
        });
        msaLog_('  [QR.resize] Drive.files.get HTTP' + metaResp.getResponseCode() + ' Δ' + (Date.now() - tMeta) + 'ms');
        
        if (metaResp.getResponseCode() === 200) {
          var meta = JSON.parse(metaResp.getContentText());
          
          if (meta.thumbnailLink) {
            // Start with the LARGEST thumbnail that stays under ~950KB
            // (qrserver.com rejects files >~1MB). Try big→small so the
            // QR code gets the most pixels possible on the first API call.
            var sizes = ['s2000', 's1800', 's1600', 's1200', 's800'];
            for (var si = 0; si < sizes.length; si++) {
              var thumbUrl = meta.thumbnailLink.replace('=s220', '=' + sizes[si]);
              var tThumb = Date.now();
              var thumbResponse = UrlFetchApp.fetch(thumbUrl, {
                headers: { 'Authorization': 'Bearer ' + token },
                muteHttpExceptions: true
              });
              if (thumbResponse.getResponseCode() === 200) {
                var thumbBlob = thumbResponse.getBlob().setName('thumb.png');
                var thumbSize = thumbBlob.getBytes().length;
                msaLog_('  [QR.resize] ' + sizes[si] + '=' + Math.round(thumbSize / 1024) + 'KB Δ' + (Date.now() - tThumb) + 'ms');
                if (thumbSize < 950000) {
                  sendBlob = thumbBlob;
                  break;
                } else {
                  msaLog_('  [QR.resize] ' + sizes[si] + ' too large (' + Math.round(thumbSize / 1024) + 'KB>950KB), trying smaller');
                }
              } else {
                msaLog_('  [QR.resize] ' + sizes[si] + ' HTTP' + thumbResponse.getResponseCode() + ' Δ' + (Date.now() - tThumb) + 'ms');
              }
            }
          } else {
            msaLog_('  [QR.resize] no thumbnailLink');
          }
        }
      } catch (thumbErr) {
        msaWarn_('  [QR.resize] FAIL: ' + thumbErr.message);
      }
    }
    
    if (!sendBlob) {
      msaLog_('  [QR.blob] using original blob (' + Math.round(fileSize / 1024) + 'KB)');
      sendBlob = file.getBlob();
    }
    
    // Track whether we used a thumbnail so we know if retry is worthwhile
    var usedThumbnail = (sendBlob !== null && fileSize > 500000 && sendBlob.getName && sendBlob.getName() === 'thumb.png');
    msaLog_('  [QR.send] usedThumbnail=' + usedThumbnail + ' sendBlobSize=' + Math.round(sendBlob.getBytes().length / 1024) + 'KB');
    
    // ── Helper: call QR API and return {found:bool, responseText:string} ──
    var callQrApi_ = function(blob, label) {
      var tCall = Date.now();
      try {
        var resp = UrlFetchApp.fetch('https://api.qrserver.com/v1/read-qr-code/', {
          method: 'post',
          payload: { file: blob },
          muteHttpExceptions: true
        });
        var code = resp.getResponseCode();
        var text = resp.getContentText();
        msaLog_('  [QR.' + label + '] HTTP' + code + ' body=' + text.length + 'B Δ' + (Date.now() - tCall) + 'ms');
        if (code !== 200) {
          msaLog_('  [QR.' + label + '] non-200 response: ' + text.substring(0, 200));
          return { found: false, responseText: text };
        }
        var parsed = JSON.parse(text);
        if (parsed && parsed[0] && parsed[0].symbol && parsed[0].symbol[0] &&
            parsed[0].symbol[0].data && !parsed[0].symbol[0].error) {
          msaLog_('  [QR.' + label + '] ✅ QR FOUND! data=' + parsed[0].symbol[0].data.substring(0, 100));
          return { found: true, responseText: text };
        }
        var errMsg = (parsed[0] && parsed[0].symbol && parsed[0].symbol[0]) ? parsed[0].symbol[0].error : 'unknown';
        msaLog_('  [QR.' + label + '] no QR in response: ' + errMsg);
        return { found: false, responseText: text };
      } catch (e) {
        msaWarn_('  [QR.' + label + '] EXCEPTION: ' + e.message + ' Δ' + (Date.now() - tCall) + 'ms');
        return { found: false, responseText: '' };
      }
    };
    
    // ── Attempt 1: Send current blob (s1600 thumbnail or original if small) ──
    var apiResult = callQrApi_(sendBlob, 'attempt1_thumb');
    
    if (!apiResult.found && usedThumbnail) {
      msaLog_('  [QR.retry] thumbnail failed — trying bottom-crop and larger sizes');
      
      // ── Attempt 2: Crop bottom 25% of the s1600 thumbnail ──
      // The QR code is at the bottom of the page. Cropping keeps the QR at high
      // relative resolution while keeping file size small.
      // GAS doesn't have native image cropping, so we send larger thumbnails
      // where the QR occupies more pixels.
      
      try {
        var token2 = ScriptApp.getOAuthToken();
        var metaUrl2 = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=thumbnailLink';
        var metaResp2 = UrlFetchApp.fetch(metaUrl2, {
          headers: { 'Authorization': 'Bearer ' + token2 },
          muteHttpExceptions: true
        });
        
        if (metaResp2.getResponseCode() === 200) {
          var meta2 = JSON.parse(metaResp2.getContentText());
          if (meta2.thumbnailLink) {
            // Try progressively larger thumbnails (including >1MB ones
            // in case qrserver accepts them — it's worth a shot)
            var bigSizes = ['s2200', 's2400', 's3200', 's4000'];
            for (var bi = 0; bi < bigSizes.length && !apiResult.found; bi++) {
              var bigThumbUrl = meta2.thumbnailLink.replace('=s220', '=' + bigSizes[bi]);
              var tBig = Date.now();
              var bigResp = UrlFetchApp.fetch(bigThumbUrl, {
                headers: { 'Authorization': 'Bearer ' + token2 },
                muteHttpExceptions: true
              });
              if (bigResp.getResponseCode() === 200) {
                var bigBlob = bigResp.getBlob().setName('thumb_' + bigSizes[bi] + '.png');
                var bigSize = bigBlob.getBytes().length;
                msaLog_('  [QR.retry] fetched ' + bigSizes[bi] + '=' + Math.round(bigSize / 1024) + 'KB Δ' + (Date.now() - tBig) + 'ms');
                apiResult = callQrApi_(bigBlob, 'attempt_' + bigSizes[bi]);
              } else {
                msaLog_('  [QR.retry] ' + bigSizes[bi] + ' fetch HTTP' + bigResp.getResponseCode() + ' Δ' + (Date.now() - tBig) + 'ms');
              }
            }
          }
        }
      } catch (retryErr) {
        msaWarn_('  [QR.retry] thumbnail retry FAIL: ' + retryErr.message);
      }
      
      // ── Attempt 3: Use Mathpix OCR line_data to find QR-like text at bottom ──
      // Sometimes Mathpix detects the QR content as text (e.g., partial JSON)
      // This is a fallback heuristic.
      if (!apiResult.found) {
        msaLog_('  [QR.fallback] checking OCR lines for JSON-like QR content at page bottom');
        try {
          var cfg = msaGetConfig_();
          var ocrResult = msaMathpixOcrFromDriveImage_(fileId, cfg, { include_line_data: true });
          if (ocrResult && ocrResult.line_data && ocrResult.line_data.length > 0) {
            // Check last few OCR lines for JSON-like QR data
            var lastLines = ocrResult.line_data.slice(-5);
            for (var li = 0; li < lastLines.length; li++) {
              var lineText = (lastLines[li].text || '').trim();
              msaLog_('  [QR.fallback] bottom line ' + li + ': "' + lineText.substring(0, 100) + '"');
              // Check if line looks like QR JSON: {"s":"...","q":"...","e":"..."}
              if (lineText.match(/^\{.*"[sqe]"\s*:/)) {
                msaLog_('  [QR.fallback] ✅ found QR-like JSON in OCR line: ' + lineText);
                try {
                  var qrData = JSON.parse(lineText);
                  var qrResult = {
                    studentId: qrData.s || qrData.studentId,
                    questionCode: qrData.q || qrData.questionCode,
                    examName: qrData.e || qrData.examName,
                    raw: qrData
                  };
                  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(qrResult), 21600); } catch(ce) {}
                  msaLog_('  [QR] totalΔ' + (Date.now() - t0) + 'ms result(ocrFallback)={q:' + (qrResult.questionCode || 'null') + ' s:' + (qrResult.studentId || 'null') + '}');
                  return qrResult;
                } catch (jsonErr) {
                  msaLog_('  [QR.fallback] JSON parse failed: ' + jsonErr.message);
                }
              }
            }
          }
        } catch (ocrFallbackErr) {
          msaLog_('  [QR.fallback] OCR fallback error: ' + ocrFallbackErr.message);
        }
      }
      
      // ── Attempt 4: Last resort — send full original blob to API ──
      if (!apiResult.found) {
        msaLog_('  [QR.lastResort] trying ORIGINAL blob (' + Math.round(fileSize / 1024) + 'KB)');
        var origBlob = file.getBlob();
        apiResult = callQrApi_(origBlob, 'attempt_original');
      }
    }
    
    // ── Process final result ──
    if (!apiResult.found || !apiResult.responseText) {
      msaLog_('  [QR] totalΔ' + (Date.now() - t0) + 'ms result=null(allAttemptsFailed)');
      return null;
    }
    
    var result;
    try {
      result = JSON.parse(apiResult.responseText);
    } catch (parseErr) {
      msaWarn_('  [QR.api] JSON parse fail: ' + apiResult.responseText.substring(0, 200));
      msaLog_('  [QR] totalΔ' + (Date.now() - t0) + 'ms result=null');
      return null;
    }
    
    msaLog_('  [QR.response] symbols=' + (result && result[0] && result[0].symbol ? result[0].symbol.length : 0) + ' full=' + apiResult.responseText.substring(0, 500));
    if (result && result[0] && result[0].symbol && result[0].symbol[0]) {
      var qrContent = result[0].symbol[0].data;
      var qrError = result[0].symbol[0].error;
      msaLog_('  [QR.symbol] data=' + (qrContent ? qrContent.substring(0, 200) : 'null') + ' error=' + (qrError || 'none'));
      
      if (qrError) {
        msaLog_('  [QR.decode] symbol error: ' + qrError);
        msaLog_('  [QR] totalΔ' + (Date.now() - t0) + 'ms result=null(symbolErr)');
        return null;
      }
      
      if (qrContent) {
        msaLog_('  [QR.decode] raw=' + qrContent.substring(0, 200));
        try {
          var qrData = JSON.parse(qrContent);
          var qrResult = {
            studentId: qrData.s || qrData.studentId,
            questionCode: qrData.q || qrData.questionCode,
            examName: qrData.e || qrData.examName,
            raw: qrData
          };
          try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(qrResult), 21600); } catch(ce) {}
          msaLog_('  [QR] totalΔ' + (Date.now() - t0) + 'ms result={q:' + (qrResult.questionCode || 'null') + ' s:' + (qrResult.studentId || 'null') + ' e:' + (qrResult.examName || 'null') + '}');
          return qrResult;
        } catch (e) {
          var qrResult = { questionCode: qrContent };
          try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(qrResult), 21600); } catch(ce) {}
          msaLog_('  [QR] totalΔ' + (Date.now() - t0) + 'ms result={q:' + qrContent + '} (raw string)');
          return qrResult;
        }
      }
    }
    
    msaLog_('  [QR] totalΔ' + (Date.now() - t0) + 'ms result=null(noQR)');
    return null;
  } catch (e) {
    msaErr_('  [QR] FAIL: ' + e.message + ' Δ' + (Date.now() - t0) + 'ms');
    return null;
  }
}

/**
 * Determine if page is Q1 (first question) based on "Section A" header presence
 * @param {object} ocrResult The OCR result with text
 * @returns {boolean} True if this appears to be Q1 (has Section A header)
 */
function detectIfQ1FromOcr(ocrResult) {
  var text = (ocrResult.text || '').toLowerCase();
  // Q1 pages have "Section A" header and instruction text
  if (text.includes('section a') && text.includes('answer all questions')) {
    msaLog_('Detected Q1 (Section A header found)');
    return true;
  }
  msaLog_('Detected Q2+ (no Section A header)');
  return false;
}

/**
 * Grade student work against a mark scheme.
 * This function takes the student's OCR text and compares it to the pre-parsed
 * markscheme points to assign marks.
 * 
 * @param {string} studentOcrText The OCR text from the student's handwritten work.
 * @param {string} questionCode The question code (e.g., "14M.2.AHL.TZ2.H_1").
 * @param {string} [studentId] Optional student ID from QR for per-student corrections.
 * @returns {object} Grading result with scores and detailed feedback.
 */
function gradeStudentWork(studentOcrText, questionCode, studentId) {
  const t0 = Date.now();
  msaLog_('=== GRADING STUDENT WORK ===');
  msaLog_('Question code: ' + questionCode);
  
  try {
    const cfg = msaGetConfig_();
    
    // 1. Find the mark scheme data for this question
    const markschemePoints = loadMarkschemePoints_(questionCode);
    if (!markschemePoints || markschemePoints.length === 0) {
      return {
        status: 'error',
        message: 'Could not find mark scheme data for question: ' + questionCode
      };
    }
    
    msaLog_('Loaded ' + markschemePoints.length + ' markscheme points');
    
    // 1b. Auto-flag crossed-off / CJK garbage lines
    var crossedOffScan = flagCrossedOffLines_({ text: studentOcrText, line_data: studentOcrText.split('\n').map(function(t) { return { text: t }; }) });
    if (crossedOffScan.stats.flagged > 0) {
      msaLog_('Pre-grade crossed-off scan: removed ' + crossedOffScan.stats.flagged + ' garbage lines');
      studentOcrText = crossedOffScan.cleanedText;
    }

    // 2. Clean the student text - remove printed question content
    var cleanedStudentText = cleanStudentOcrText_(studentOcrText);
    msaLog_('Student text length (cleaned): ' + cleanedStudentText.length);
    
    // 2a. Apply per-student corrections (writer-adaptive)
    //     These are safe to apply pre-grading because they are teacher-verified
    //     patterns specific to THIS student's handwriting (unlike OCR Verify
    //     which auto-corrects toward mark-scheme answers).
    var preGradeStudentProfile = null;
    var preGradeCorrectionsEnabled = (typeof MSA_OCR_CORRECTIONS_ENABLED !== 'undefined') ? MSA_OCR_CORRECTIONS_ENABLED : true;
    if (studentId && preGradeCorrectionsEnabled) {
      try {
        preGradeStudentProfile = applyStudentCorrections_(
          studentId, cleanedStudentText,
          { minFrequency: (typeof MSA_STUDENT_OCR_MIN_FREQUENCY !== 'undefined') ? MSA_STUDENT_OCR_MIN_FREQUENCY : 1 }
        );
        if (preGradeStudentProfile.stats.rulesApplied > 0) {
          cleanedStudentText = preGradeStudentProfile.text;
          msaLog_('👤 [' + studentId + '] Pre-grade: applied ' + preGradeStudentProfile.stats.rulesApplied +
            ' personal rules (' + preGradeStudentProfile.stats.totalReplacements + ' replacements)');
        }
      } catch (profileErr) {
        msaLog_('Student profile pre-grade pass skipped: ' + profileErr.message);
      }
    }
    
    // 2b. Context-aware notation normalization
    //     Uses the mark scheme notation to fix OCR confusion (e.g. a_n → u_n)
    var markschemeText = markschemePoints.map(function(p) { return p.requirement || ''; }).join('\n');
    var gradeNormRules = buildNotationNormalizationRules_(markschemeText, markschemeText);
    if (gradeNormRules.rules.length > 0) {
      var gradeNorm = applyNotationNormalization_(cleanedStudentText, gradeNormRules.rules);
      if (gradeNorm.totalReplacements > 0) {
        cleanedStudentText = gradeNorm.text;
        gradeNorm.applied.forEach(function(a) {
          msaLog_('📝 Notation norm (grade): "' + a.from + '"→"' + a.to + '" ×' + a.count);
        });
      }
    }

    // 2c. Operator–digit confusion fix (e.g. 7335 → >335)
    var gradeOpDigit = fixOperatorDigitConfusion_(cleanedStudentText, markschemePoints);
    if (gradeOpDigit.totalReplacements > 0) {
      cleanedStudentText = gradeOpDigit.text;
      gradeOpDigit.applied.forEach(function(a) {
        msaLog_('📝 OpDigit fix (grade): "' + a.from + '"→"' + a.to + '" ×' + a.count);
      });
    }

    // 2d. OCR Verification Pass — cross-check numbers against mark-scheme
    //     using glyph-confusion matrix to catch common handwriting OCR errors.
    //
    //     IMPORTANT: We run in DRY-RUN / flag-only mode. The verified text is
    //     NOT passed to the grader because auto-correcting numbers toward the
    //     mark scheme answer would inflate scores — the grader would "find"
    //     numbers the student never wrote. Instead, we surface the near-misses
    //     in the UI for teacher review.
    var ocrVerification = null;
    var verifiedStudentText = cleanedStudentText;  // grader always uses the original
    try {
      ocrVerification = ocrVerifyStudentWork(
        cleanedStudentText,
        null,  // latexStyledText — pass if available
        markschemePoints,
        { autoCorrectThreshold: 0.55, dryRun: true }  // flag only, never rewrite
      );
      // NOTE: we intentionally do NOT use ocrVerification.verifiedText here
      if (ocrVerification.stats.corrected > 0 || ocrVerification.stats.flagged > 0) {
        msaLog_('OCR Verify (flag-only): ' + ocrVerification.stats.corrected + ' would-correct, ' +
          ocrVerification.stats.flagged + ' flagged for review');
      }
    } catch (verifyErr) {
      msaWarn_('OCR verification pass failed (non-fatal): ' + verifyErr.message);
    }
    
    // 3. Grade each point using the AI system with implied marks
    // The gradeWithImpliedMarks function handles:
    //   - First pass: grade each point normally
    //   - Second pass: check implied marks (parenthesized marks) for implication awards
    //   - Third pass: apply any learned rules from corrections database
    const results = gradeWithImpliedMarks(verifiedStudentText, markschemePoints, {
      questionCode: questionCode,
      enableLearning: true
    });
    
    // 4. Calculate total scores
    const possibleScore = msaCalculateTotalPossibleScore_(markschemePoints);
    const awardedScore = srgCalculateAwardedScore_(results);
    
    const processingTime = Date.now() - t0;
    msaLog_('Grading complete in ' + processingTime + 'ms');
    msaLog_('Score: ' + awardedScore.total + ' / ' + possibleScore.total);
    
    return {
      status: 'success',
      questionCode: questionCode,
      score: {
        awarded: awardedScore.total,
        possible: possibleScore.total,
        percentage: Math.round((awardedScore.total / possibleScore.total) * 100)
      },
      results: results,
      breakdown: awardedScore.breakdown,
      processingTime: processingTime,
      ocrVerification: ocrVerification ? {
        corrected: ocrVerification.stats.corrected,
        flagged: ocrVerification.stats.flagged,
        corrections: ocrVerification.corrections,
        originalText: ocrVerification.originalText,
        verifiedText: ocrVerification.verifiedText
      } : null,
      studentProfile: preGradeStudentProfile ? {
        applied: preGradeStudentProfile.applied,
        stats: preGradeStudentProfile.stats
      } : null
    };
    
  } catch (e) {
    msaErr_('Error grading student work: ' + e.message);
    return {
      status: 'error',
      message: e.message
    };
  }
}

/**
 * Load markscheme points for a question from the stored JSON file.
 * @param {string} questionCode The question code.
 * @returns {Array|null} Array of point objects or null if not found.
 */
function loadMarkschemePoints_(questionCode) {
  const cfg = msaGetConfig_();
  
  // Try to find the question folder by searching for the question code
  const parentFolder = DriveApp.getFolderById(cfg.MSA_PARENT_FOLDER_ID);
  
  // Search for a folder containing this question code (searches all subfolders)
  // Use Drive advanced search to search recursively
  var folderIterator = parentFolder.searchFolders('title contains "' + questionCode + '"');
  
  if (folderIterator.hasNext()) {
    const folder = folderIterator.next();
    msaLog_('Found folder directly: ' + folder.getName());
    return loadPointsFromFolder_(folder);
  }
  
  // If not found directly, search in common subfolders like "mark schemes"
  var subfolderNames = ['mark schemes', 'Mark Schemes', 'markschemes', 'MarkSchemes'];
  for (var s = 0; s < subfolderNames.length; s++) {
    var subIter = parentFolder.getFoldersByName(subfolderNames[s]);
    if (subIter.hasNext()) {
      var subfolder = subIter.next();
      msaLog_('Searching in subfolder: ' + subfolderNames[s]);
      var subFolderIterator = subfolder.searchFolders('title contains "' + questionCode + '"');
      if (subFolderIterator.hasNext()) {
        const folder = subFolderIterator.next();
        msaLog_('Found folder in ' + subfolderNames[s] + ': ' + folder.getName());
        return loadPointsFromFolder_(folder);
      }
    }
  }
  
  // Try searching for a doc with this title to get its folder
  const docIterator = parentFolder.getFilesByName(questionCode);
  if (docIterator.hasNext()) {
    const doc = docIterator.next();
    const docId = doc.getId();
    const folder = msaFindQuestionFolderByDocId_(cfg, docId);
    if (folder) {
      return loadPointsFromFolder_(folder);
    }
  }
  
  msaLog_('No folder found for question: ' + questionCode);
  return null;
}

/**
 * Load points from a question folder.
 * @param {DriveApp.Folder} folder The question output folder.
 * @returns {Array|null} Array of point objects.
 */
function loadPointsFromFolder_(folder) {
  // Try to load the best points JSON (best > Pass 3 > Pass 2 > Pass 1)
  const fileNames = [
    'markscheme_points_best.json',
    'markscheme_points_pass3.json',
    'markscheme_points_pass2.json', 
    'markscheme_points.json'
  ];
  
  msaLog_('Searching folder: ' + folder.getName());
  
  for (var i = 0; i < fileNames.length; i++) {
    var fileIterator = folder.getFilesByName(fileNames[i]);
    if (fileIterator.hasNext()) {
      var file = fileIterator.next();
      var content = file.getBlob().getDataAsString();
      try {
        var data = JSON.parse(content);
        msaLog_('Loaded points from ' + fileNames[i]);
        return data.points || data;
      } catch (e) {
        msaLog_('Error parsing ' + fileNames[i] + ': ' + e.message);
      }
    }
  }
  
  msaLog_('No markscheme points file found in folder');
  return null;
}

/**
 * Clean student OCR text by removing printed question content.
 * Removes question numbers, mark allocations, and instruction text.
 * @param {string} text Raw OCR text from student work.
 * @returns {string} Cleaned text with only student's handwritten content.
 */
function cleanStudentOcrText_(text) {
  if (!text) return '';
  
  var lines = text.split('\n');
  var cleanedLines = [];
  var inQuestionHeader = false;
  
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Skip question number headers (e.g., "5. [Maximum mark: 6]", "1. [Maximum mark: 14]")
    if (/^\d+\.\s*\[Maximum mark:\s*\d+\]/.test(line)) {
      inQuestionHeader = true;
      continue;
    }
    
    // Skip Section A header
    if (/^Section\s+A/i.test(line)) continue;
    
    // Skip "Answer all questions" instruction
    if (/Answer all questions/i.test(line)) continue;
    
    // Skip mark allocations like "[4]" or "[2]" on their own line
    if (/^\[\d+\]$/.test(line)) continue;
    
    // Skip lines that look like printed question text (common patterns)
    // - Lines starting with "(a)", "(b)", etc. followed by question text
    if (/^\([a-z]\)\s+(?:Find|Express|Calculate|Determine|Show|Prove|State|Write|An arithmetic|The sum)/i.test(line)) {
      continue;
    }
    
    // Skip lines with instruction patterns (find, express, etc.)
    if (inQuestionHeader && /^(?:Find|Express|Calculate|Determine|Show|Prove|State|Write)/i.test(line)) {
      continue;
    }
    
    // Reset question header flag after a few lines or when we hit student work
    if (inQuestionHeader && (i > 10 || /^[a-z]\s*[=]|^\d+[\s+\-\*\/]|^S_|^a_/.test(line))) {
      inQuestionHeader = false;
    }
    
    // Keep lines that look like student work (calculations, equations, etc.)
    cleanedLines.push(line);
  }
  
  return cleanedLines.join('\n');
}

/**
 * Quick test function to grade student work from the UI.
 * @param {string} studentOcrText The student's OCR text.
 * @param {string} questionCode The question code.
 * @returns {object} Grading results formatted for UI display.
 */
function testGradeStudentWork(studentOcrText, questionCode) {
  return gradeStudentWork(studentOcrText, questionCode);
}

/**
 * Grade student work and also return the mark scheme HTML for display.
 * This is the enhanced version for the full grading UI.
 * @param {string} studentOcrText The student's OCR text.
 * @param {string} questionCode The question code.
 * @param {string} [studentId] Optional student ID from QR for per-student corrections.
 * @returns {object} Grading results with mark scheme HTML.
 */
function gradeStudentWorkWithMarkscheme(studentOcrText, questionCode, studentId) {
  // First, do the grading
  var result = gradeStudentWork(studentOcrText, questionCode, studentId);
  
  if (result.status !== 'success') {
    return result;
  }
  
  // Now try to get the mark scheme preview HTML
  try {
    var markschemeHtml = loadMarkschemePreview_(questionCode);
    result.markschemeHtml = markschemeHtml;
  } catch (e) {
    msaLog_('Could not load mark scheme preview: ' + e.message);
    result.markschemeHtml = null;
  }
  
  return result;
}

/**
 * Load the mark scheme preview HTML for a question.
 * @param {string} questionCode The question code.
 * @returns {string|null} HTML content or null.
 */
function loadMarkschemePreview_(questionCode) {
  const cfg = msaGetConfig_();
  const parentFolder = DriveApp.getFolderById(cfg.MSA_PARENT_FOLDER_ID);
  
  // Search for a folder containing this question code (same logic as loadMarkschemePoints_)
  var folder = null;
  
  // Try direct search first
  var folderIterator = parentFolder.searchFolders('title contains "' + questionCode + '"');
  if (folderIterator.hasNext()) {
    folder = folderIterator.next();
  }
  
  // If not found, search in subfolders
  if (!folder) {
    var subfolderNames = ['mark schemes', 'Mark Schemes', 'markschemes', 'MarkSchemes'];
    for (var s = 0; s < subfolderNames.length; s++) {
      var subIter = parentFolder.getFoldersByName(subfolderNames[s]);
      if (subIter.hasNext()) {
        var subfolder = subIter.next();
        var subFolderIterator = subfolder.searchFolders('title contains "' + questionCode + '"');
        if (subFolderIterator.hasNext()) {
          folder = subFolderIterator.next();
          break;
        }
      }
    }
  }
  
  if (!folder) {
    msaLog_('No folder found for mark scheme preview: ' + questionCode);
    return null;
  }
  
  // Try to load the structured preview first, then the regular preview
  var previewFiles = ['markscheme_structured_preview.html', 'markscheme_preview.html'];
  
  for (var i = 0; i < previewFiles.length; i++) {
    var fileIterator = folder.getFilesByName(previewFiles[i]);
    if (fileIterator.hasNext()) {
      var file = fileIterator.next();
      var html = file.getBlob().getDataAsString();
      msaLog_('Loaded mark scheme preview from ' + previewFiles[i]);
      return html;
    }
  }
  
  msaLog_('No mark scheme preview file found in folder');
  return null;
}


/**
 * Generate an AI-powered suggestion for a grading run.
 * Calls the Anthropic Claude API with a concise summary of the grading results.
 * Returns JSON string: { text: "..." } or { error: "..." }
 *
 * @param {string} summaryJson - JSON string with grading summary
 * @return {string} JSON string with suggestion
 */
function getAiSuggestion(summaryJson) {
  try {
    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('ANTHROPIC_API_KEY');
    
    if (!apiKey) {
      // Fall back to a rule-based suggestion if no API key configured
      return JSON.stringify(generateRuleBasedSuggestion_(summaryJson));
    }
    
    var summary = JSON.parse(summaryJson);
    
    // Build a focused prompt
    var prompt = buildSuggestionPrompt_(summary);
    
    var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: prompt
        }]
      }),
      muteHttpExceptions: true
    });
    
    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('Anthropic API error: ' + code + ' ' + response.getContentText().substring(0, 500));
      // Fall back to rule-based suggestion
      return JSON.stringify(generateRuleBasedSuggestion_(summaryJson));
    }
    
    var body = JSON.parse(response.getContentText());
    var text = body.content && body.content[0] && body.content[0].text;
    if (text) {
      return JSON.stringify({ text: text.trim() });
    }
    
    return JSON.stringify({ error: 'AI returned empty response.' });
  } catch (e) {
    Logger.log('getAiSuggestion error: ' + e);
    // Fall back to rule-based on any error
    try {
      return JSON.stringify(generateRuleBasedSuggestion_(summaryJson));
    } catch (e2) {
      return JSON.stringify({ error: 'Could not generate suggestion.' });
    }
  }
}


/**
 * Build the prompt sent to Claude for generating a suggestion.
 */
function buildSuggestionPrompt_(summary) {
  var lines = [];
  lines.push('You are an expert IB Mathematics exam grading assistant. Analyze this automated grading result and provide ONE concise, actionable suggestion to improve the grading accuracy or the student\'s understanding. Keep it under 2 sentences.');
  lines.push('');
  lines.push('Question: ' + (summary.questionCode || 'unknown'));
  lines.push('Score: ' + summary.score.awarded + '/' + summary.score.possible);
  lines.push('');
  lines.push('Point-by-point results:');
  
  (summary.results || []).forEach(function(r) {
    var status = r.awarded ? '✅' : '❌';
    var strategy = r.strategy || 'none';
    var found = (r.found || []).join(', ') || 'nothing';
    var missing = (r.missing || []).join(', ') || 'none';
    var extras = [];
    if (r.awardedByImplication) extras.push('implied');
    if (r.excludedByMethod) extras.push('method-excluded');
    lines.push(status + ' ' + r.point_id + ' (' + (r.part || '') + ') ' + (r.marks || []).join('') + 
               ' — strategy: ' + strategy + ', found: [' + found + '], missing: [' + missing + ']' +
               (extras.length ? ' [' + extras.join(', ') + ']' : ''));
  });
  
  if (summary.ocrVerification) {
    lines.push('');
    lines.push('OCR: ' + summary.ocrVerification.correctionsMade + ' corrections applied');
  }
  
  lines.push('');
  lines.push('Respond with just the suggestion text — no preamble, no bullet points, no markdown. One practical observation or tip.');
  
  return lines.join('\n');
}


/**
 * Generate a rule-based suggestion when no AI API key is configured.
 * Analyzes the grading patterns to produce a useful observation.
 */
function generateRuleBasedSuggestion_(summaryJson) {
  try {
    var summary = typeof summaryJson === 'string' ? JSON.parse(summaryJson) : summaryJson;
    var results = summary.results || [];
    var score = summary.score || { awarded: 0, possible: 0 };
    
    // Count different patterns
    var strategies = {};
    var missingCount = 0;
    var impliedCount = 0;
    var excludedCount = 0;
    var globalMatchCount = 0;
    
    results.forEach(function(r) {
      var s = r.strategy || 'none';
      strategies[s] = (strategies[s] || 0) + 1;
      if (r.missing && r.missing.length > 0) missingCount++;
      if (r.awardedByImplication) impliedCount++;
      if (r.excludedByMethod) excludedCount++;
      if (s === 'numeric' && r.awarded) globalMatchCount++;
    });
    
    // Generate the most relevant suggestion
    if (score.possible > 0 && score.awarded === score.possible) {
      return { text: 'Perfect score — all marks awarded. Verify that global numeric matches (Strategy 3) found values from the correct part of the student\'s work, not coincidental numbers.' };
    }
    
    if (globalMatchCount > 2) {
      return { text: 'Multiple marks were awarded by global numeric search (Strategy 3), which scans the entire student response. Check that these numbers actually came from the relevant part — the same value might appear in a different context.' };
    }
    
    if (impliedCount > 0 && missingCount > 0) {
      return { text: impliedCount + ' mark(s) were awarded by implication while ' + missingCount + ' point(s) had missing values. Review the implied marks — a correct final answer doesn\'t always mean every intermediate step was understood.' };
    }
    
    if (strategies['none'] && strategies['none'] > 2) {
      return { text: strategies['none'] + ' marking points had no matching strategy. This may indicate OCR quality issues or mark scheme requirements that need keyword/regex patterns added to the grading engine.' };
    }
    
    if (missingCount > results.length / 2) {
      return { text: 'Over half the marking points are missing required values. The student may have used a completely different method — consider checking if an alternative method branch better matches their work.' };
    }
    
    if (excludedCount > 0) {
      return { text: 'The grader selected the best-scoring method branch, excluding ' + excludedCount + ' point(s) from alternative methods. Click ? on the excluded (grey) rows to verify the method selection was correct.' };
    }
    
    // Default
    var pct = score.possible > 0 ? Math.round(100 * score.awarded / score.possible) : 0;
    return { text: 'Score: ' + pct + '%. Click the ? button on any marking point to see exactly which strategy was used and what evidence was found in the student\'s work.' };
    
  } catch (e) {
    return { error: 'Could not analyze grading results.' };
  }
}