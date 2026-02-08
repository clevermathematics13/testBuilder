/********************************
 * SRG_Grader.js (Student Response Grader)
 *
 * This script takes a student's handwritten work (as an image)
 * and grades it against a pre-processed MSA markscheme.
 ********************************/

/**
 * 🟢 RUN THIS FUNCTION TO TEST THE GRADER 🟢
 * 1. Fill in the IDs below.
 * 2. Select "runSingleGradeTest" from the function dropdown in the editor.
 * 3. Click "Run" and check the Execution Log for the grading report.
 */
function runSingleGradeTest() {
  // --- ⭐️ PASTE YOUR TEST DATA HERE ⭐️ ---

  // The File ID of the student's handwritten work image you uploaded to Drive.
  const STUDENT_WORK_IMAGE_ID = "1ELLBxY_kZKZDQ7OmHa8cyaz1oMBF8FyC";

  // The Doc ID of the *question* the student was answering.
  // This must be a docId that has already been processed by the MSA batch.
  const QUESTION_DOC_ID = "1Q0j5sk0-2xQWPEAS4NIO6jBq02IJvnNFvjc4cJJQu88"; //mark scheme

  // -----------------------------------------

  if (STUDENT_WORK_IMAGE_ID === "YOUR_IMAGE_FILE_ID_HERE" || QUESTION_DOC_ID === "A_QUESTION_DOC_ID_FROM_YOUR_BATCH") {
    SpreadsheetApp.getUi().alert("Please open SRG_Grader.js and set the test IDs in the runSingleGradeTest function.");
    return;
  }

  gradeStudentResponse(STUDENT_WORK_IMAGE_ID, QUESTION_DOC_ID);
}


/**
 * Main function to grade a single student response.
 * @param {string} studentWorkImageId The File ID of the student's work image.
 * @param {string} questionDocId The Doc ID of the question being answered.
 */
function gradeStudentResponse(studentWorkImageId, questionDocId) {
  const t0 = Date.now();
  msaLog_("=== SRG (Student Response Grader) START ===");
  const cfg = msaGetConfig_();

  // 1. Find the markscheme folder and load the parsed points
  const questionFolder = srgFindQuestionFolderByDocId_(cfg, questionDocId);
  if (!questionFolder) return;

  const markscheme = msaReadJsonFileIfExists_(questionFolder, "markscheme_points_best.json");
  if (!markscheme || !markscheme.points) {
    msaErr_("SRG: Could not load or parse markscheme_points_best.json from folder: " + questionFolder.getName());
    return;
  }
  msaLog_("SRG: Loaded " + markscheme.points.length + " markscheme points.");

  // 2. OCR the student's work
  msaLog_("SRG: OCR'ing student work image: " + studentWorkImageId);
  const studentOcr = msaMathpixOcrFromDriveImage_(studentWorkImageId, cfg, {});
  const studentText = studentOcr.text || "";
  msaLog_("SRG: Student OCR text length: " + studentText.length);

  // 3. Grade each point against the student's work
  const results = [];
  markscheme.points.forEach(point => {
    const matchResult = srgMatchRequirement_(studentText, point.requirement);
    results.push({
      point_id: point.id,
      mark: point.mark,
      awarded: matchResult.awarded,
      match_score: matchResult.score,
      requirement: point.requirement,
      part: point.part,
      branch: point.branch
    });
  });

  // 4. Calculate scores, correctly handling alternative methods
  const possibleScoreInfo = msaCalculateTotalPossibleScore_(markscheme.points);
  const awardedScoreInfo = srgCalculateAwardedScore_(results);

  // 5. Log the final report
  msaLog_("---  النهائية GRADING REPORT ---");
  msaLog_("Total Points Awarded: " + awardedScoreInfo.total + " / " + possibleScoreInfo.total);
  results.forEach(res => {
    const status = res.awarded ? "✅ AWARDED" : "❌ NOT AWARDED";
    msaLog_(status + " (" + res.mark + ") - Match Score: " + res.match_score.toFixed(2) + " - ID: " + res.point_id);
  });

  const dt = Math.round((Date.now() - t0) / 1000);
  msaLog_("=== SRG END === (duration " + dt + "s)");
}

/**
 * The core matching engine. Compares student text to a markscheme requirement.
 * This is a simple keyword-based approach and can be improved over time.
 * @param {string} studentOcrText The full OCR text from the student's work.
 * @param {string} requirementText The requirement text from a single markscheme point.
 * @returns {{awarded: boolean, score: number}}
 */
function srgMatchRequirement_(studentOcrText, requirementText) {
  const clean = (text) => new Set(String(text || "").toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2));

  const studentWords = clean(studentOcrText);
  const requirementWords = Array.from(clean(requirementText)); // Convert Set to Array to get .length

  if (requirementWords.length === 0) {
    return { awarded: false, score: 0 };
  }

  let foundCount = 0;
  requirementWords.forEach(word => {
    if (studentWords.has(word)) {
      foundCount++;
    }
  });

  const matchRatio = foundCount / requirementWords.length;
  const THRESHOLD = 0.75; // 75% of keywords must match to award the point.

  return { awarded: matchRatio >= THRESHOLD, score: matchRatio };
}

/**
 * Finds the MSA output folder for a given question docId.
 * @param {object} cfg The configuration object.
 * @param {string} questionDocId The Google Doc ID of the question.
 * @returns {Drive.Folder|null} The folder object or null if not found.
 */
function srgFindQuestionFolderByDocId_(cfg, questionDocId) {
  const parentFolder = DriveApp.getFolderById(cfg.MSA_PARENT_FOLDER_ID);
  const folderIterator = parentFolder.searchFolders('title contains "' + questionDocId + '"');

  if (folderIterator.hasNext()) {
    return folderIterator.next();
  }

  msaWarn_("SRG: Could not find an MSA output folder for docId: " + questionDocId);
  return null;
}

/**
 * Calculates the total awarded score from a list of graded results,
 * correctly awarding points for the best-scoring METHOD branch.
 * @param {Array<Object>} results The array of graded results.
 * @returns {number} The total awarded score.
 */
function srgCalculateAwardedScore_(results) {
  const byPart = {};
  results.forEach(res => {
    if (!res.awarded) return; // Only consider awarded points
    // 🟢 NEW: Group by the primary part letter
    const primaryPart = (res.part || 'unknown').match(/^[a-z]+/i);
    const partKey = primaryPart ? primaryPart[0] : 'unknown';
    if (!byPart[partKey]) byPart[partKey] = [];
    byPart[partKey].push(res);
  });
 
  let totalAwarded = 0;
  const breakdown = [];
  for (const part in byPart) {
    const partResults = byPart[part];

    // 🟢 NEW: Heuristic for N marks.
    const hasAwardedN = partResults.some(res => (res.mark || "").startsWith("N"));
    if (hasAwardedN) {
      // If any N mark is awarded, the score for this part is ONLY the sum of awarded N marks.
      const partScore = partResults
        .filter(res => (res.mark || "").startsWith("N"))
        .reduce((sum, res) => sum + msaGetMarkValue_(res.mark || ""), 0);
      totalAwarded += partScore;
      breakdown.push(`Part '${part}': ${partScore} marks (N-marks rule)`);
      continue; // Move to next part
    }

    const branchGroups = {};
    let nonBranchScore = 0;
 
    partResults.forEach(res => {
      const value = msaGetMarkValue_(res.mark || "");
      const branch = res.branch || "";

      if (branch.startsWith("METHOD")) {
        if (!branchGroups.METHOD) branchGroups.METHOD = {};
        if (!branchGroups.METHOD[branch]) branchGroups.METHOD[branch] = 0;
        branchGroups.METHOD[branch] += value;
      } else if (branch === "EITHER" || branch === "OR") {
        if (!branchGroups.EITHER_OR) branchGroups.EITHER_OR = {};
        if (!branchGroups.EITHER_OR[branch]) branchGroups.EITHER_OR[branch] = 0;
        branchGroups.EITHER_OR[branch] += value;
      } else {
        nonBranchScore += value;
      }
    });
 
    let partScore = nonBranchScore;
    for (const group in branchGroups) {
      const groupScores = Object.values(branchGroups[group]);
      partScore += groupScores.length > 0 ? Math.max(...groupScores) : 0;
    }
    totalAwarded += partScore;
  }
  return totalAwarded;
}