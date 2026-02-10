/********************************
 * WebApp.gs
 *
 * Server-side logic for the MSA Validation & Repair UI.
 ********************************/

/**
 * Serves the main HTML page for the web app.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('MSA Validation & Repair')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Called by the UI to get the list of documents to process.
 */
function getInitialData() {
  try {
    // Get the parent folder ID from the central configuration file (MSA_Config.js).
    // This avoids duplicating the ID and makes the system more robust.
    const cfg = msaGetConfig_();
    const sourceFolderId = cfg.MSA_PARENT_FOLDER_ID;

    // Add logging and a check to ensure the ID is properly loaded from the config.
    Logger.log(`getInitialData: Attempting to access folder with ID from MSA_Config.js: '${sourceFolderId}'`);
    if (!sourceFolderId) {
      throw new Error("The MSA_PARENT_FOLDER_ID is not set in your MSA_Config.js file. Please set it to a valid Google Drive folder ID.");
    }

    const folder = DriveApp.getFolderById(sourceFolderId);
    const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    const docIds = [];
    while (files.hasNext()) {
      docIds.push(files.next().getId());
    }
    const meta = docIds.map(id => msaGetDocMeta_(cfg, id));
    return meta;
  } catch (e) {
    Logger.log(`ERROR in getInitialData: ${e.stack}`);
    // Re-throw a more user-friendly error to the front-end.
    throw new Error(`Failed to fetch documents. Please check the folder ID and permissions. Details: ${e.message}`);
  }
}

/**
 * Called by the UI to process a single document.
 * This is the entry point for the initial OCR and parse.
 */
function processSingleDocForUI(docId) {
  return runMSA_VR_One_ForWebApp(docId);
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
 * @param {string} docId The ID of the document to compare.
 * @returns {object} An object containing the source doc URL and the preview HTML.
 */
function getPreviewData(docId) {
  const cfg = msaGetConfig_();
  // Assumes msaFindQuestionFolderByDocId_ is available from MSA_Helpers_And_Pass1.js
  const folder = msaFindQuestionFolderByDocId_(cfg, docId);
  if (!folder) {
    throw new Error("Output folder not found for document ID: " + docId);
  }

  const sourceDocUrl = DriveApp.getFileById(docId).getUrl();

  const previewFileIterator = folder.getFilesByName("markscheme_preview.html");
  if (!previewFileIterator.hasNext()) {
    throw new Error("markscheme_preview.html not found in the output folder. Please run the MSA process first.");
  }
  const previewHtml = previewFileIterator.next().getBlob().getDataAsString();

  return { sourceDocUrl: sourceDocUrl, previewHtml: previewHtml };
}