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
  const STUDENT_WORK_IMAGE_ID = "YOUR_IMAGE_FILE_ID_HERE";

  // The Doc ID of the *question* the student was answering.
  // This must be a docId that has already been processed by the MSA batch.
  const QUESTION_DOC_ID = "A_QUESTION_DOC_ID_FROM_YOUR_BATCH";

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

  // 3. Grade each point
  const results = [];
  let totalAwarded = 0;
  markscheme.points.forEach(point => {
    const matchResult = srgMatchRequirement_(studentText, point.requirement);
    if (matchResult.awarded) {
      totalAwarded++;
    }
    results.push({
      point_id: point.id,
      mark: point.mark,
      awarded: matchResult.awarded,
      match_score: matchResult.score,
      requirement: point.requirement
    });
  });

  // 4. Log the final report
  msaLog_("---  النهائية GRADING REPORT ---");
  msaLog_("Total Points Awarded: " + totalAwarded + " / " + markscheme.points.length);
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