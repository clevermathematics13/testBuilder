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
  const docIds = [
    "1Q0j5sk0-2xQWPEAS4NIO6jBq02IJvnNFvjc4cJJQu88",
    "1ogg4P9-_Q5-7GVgrtIbo355WjhYgoYs7Mjk0OOjO7Ho",
    "1zfGnVJHtGxrEGCVLR7PTsYFwcsbpyRU1aOcyO6MdNN4",
    "17VFlp49U15wcbOoSP7wNUdraz3TjElwYwyvavLErec8",
    "10JpdOR7L4xDl9gN0Ixckplf9kVLPTSmwRQ7cpeoQRdY"
  ];
  const cfg = msaGetConfig_();
  const meta = docIds.map(id => msaGetDocMeta_(cfg, id));
  return meta;
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
function reprocessWithCorrection(docId, correctedOcrText) {
  // Reconstruct the ocrPages structure from the single block of text
  const ocrPages = [{
    page: 1,
    text: correctedOcrText,
    confidence: 1.0, // Manually corrected, so confidence is 1.0
    request_id: "manual_correction"
  }];
  return _runMsaPipeline(docId, ocrPages);
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