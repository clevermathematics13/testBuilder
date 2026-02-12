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
  const questionFolder = msaFindQuestionFolderByDocId_(cfg, questionDocId);
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
      marks: point.marks,
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
    msaLog_(status + " (" + (res.marks || []).join('') + ") - Match Score: " + res.match_score.toFixed(2) + " - ID: " + res.point_id);
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
  // 1. Extract all numbers (including decimals and negatives) from both texts.
  const getNumbers = (text) => (String(text || "").match(/-?\d+(\.\d+)?/g) || []);
  const studentNumbers = new Set(getNumbers(studentOcrText));
  const requirementNumbers = getNumbers(requirementText);

  // 2. If the requirement contains numbers, prioritize matching them.
  if (requirementNumbers.length > 0) {
    const foundNumbers = requirementNumbers.filter(num => studentNumbers.has(num));
    const numberMatchRatio = foundNumbers.length / requirementNumbers.length;

    // If all required numbers are found, it's a very strong match.
    if (numberMatchRatio === 1.0) {
      return { awarded: true, score: 1.0 };
    }
    // If some but not all numbers are found, it's a partial match.
    // We can use this score directly.
    return { awarded: numberMatchRatio > 0.8, score: numberMatchRatio };
  }

  // 3. Fallback to keyword matching for non-numeric requirements (e.g., "evidence of substitution").
  const getWords = (text) => new Set(String(text || "").toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !/^\d+$/.test(w)));
  const studentWords = getWords(studentOcrText);
  const requirementWords = Array.from(getWords(requirementText));

  if (requirementWords.length > 0) {
    const foundWords = requirementWords.filter(word => studentWords.has(word));
    const wordMatchRatio = foundWords.length / requirementWords.length;
    const THRESHOLD = 0.75; // 75% of keywords must match.
    return { awarded: wordMatchRatio >= THRESHOLD, score: wordMatchRatio };
  }

  // 4. If the requirement has no numbers and no keywords, we cannot grade it automatically.
  return { awarded: false, score: 0 };
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
    // Group by the parent part. e.g., 'ai' and 'aii' both group under 'a'.
    const partStr = res.part || 'unknown';
    const romanNumeralMatch = partStr.match(/[ivx]/);
    const partKey = romanNumeralMatch ? partStr.substring(0, romanNumeralMatch.index) : partStr;
    if (!byPart[partKey]) byPart[partKey] = [];
    byPart[partKey].push(res);
  });
 
  let totalAwarded = 0;
  const breakdown = [];
  for (const part in byPart) {
    const partResults = byPart[part];

    // 🟢 NEW: Heuristic for N marks.
    const hasAwardedN = partResults.some(res => (res.marks || []).some(m => m.startsWith("N")));
    if (hasAwardedN) {
      // If any N mark is awarded, the score for this part is ONLY the sum of awarded N marks.
      const nScore = partResults
        .filter(res => (res.marks || []).some(m => m.startsWith("N")))
        .reduce((sum, res) => sum + msaGetMarkValue_(res.marks || []), 0);
      totalAwarded += nScore;
      breakdown.push(`Part '${part}': ${nScore} marks (N-marks rule)`);
      continue; // Move to next part
    }

    const branchGroups = {};
    let nonBranchScore = 0;
 
    partResults.forEach(res => {
      const value = msaGetMarkValue_(res.marks || []);
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
    // For each group of alternative branches (like METHOD or EITHER_OR),
    // find the score of the highest-scoring branch and add it to the part's score.
    for (const group in branchGroups) {
      const groupScores = Object.values(branchGroups[group]); // e.g., [2, 2, 2] for METHODs
      partScore += groupScores.length > 0 ? Math.max(...groupScores) : 0;
    }
    totalAwarded += partScore;
    breakdown.push(`Part '${part}': ${partScore} marks`);
  }
  return {
    total: totalAwarded,
    breakdown: breakdown
  };
}