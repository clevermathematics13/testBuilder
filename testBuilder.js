/**
 * ==============================================================================
 * 🏆 FINAL PRODUCTION SCRIPT (v12 - REST API EDITION)
 * ==============================================================================
 * 1. 🛡️ HYBRID BUILDER: Uses FormApp.create() to guarantee "Published" status.
 * 2. 🤖 REST API PATCH: Uses UrlFetchApp to force "Verified" emails.
 * 3. 🚚 MOVE LOGIC: Moves the form to the School Folder after creation.
 * ==============================================================================
 */

var ppqSelector = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PPQselector');

// --- ROW CONFIGURATION ---
var codeCell = ppqSelector.getRange("G6"); 
var codeCellRow = codeCell.getRow();
var codeCellColumn = codeCell.getColumn();
var testName = ppqSelector.getRange(1,7).getValue(); 
var templateFile; 
var parentFolder;
var scriptProperties = PropertiesService.getScriptProperties();
var templateId = "1C2tHSaN2mgJA9IU0FPbyTeo_Yk33j_6C13B5nUsK7Bg";
var classCode;

function testBuilder() {
  Logger.log("🔵 START: System initiated.");
  classCodeFinder();
  
  if (classCode !== "27AH") {
     SpreadsheetApp.getActiveSpreadsheet().toast("⚠️ No Database exists for " + classCode + ".", "System Alert", 5);
  }

  chooseOutputFolder();
  choosePaperTemplate();
  createTestInSlides(); 
  
  Logger.log("🏁 END: System completed.");
}

// --- HELPER FUNCTIONS ---
function classCodeFinder() {
  if (testName.toString().includes("27AH")) { 
    classCode = "27AH"; 
  } else {
    var match = testName.match(/(\d{2}AH)/);
    classCode = match ? match[1] : "UNKNOWN";
  }
}

function chooseOutputFolder() {
  if (classCode == "26AH") { parentFolder = DriveApp.getFolderById("1AUsMaX800AiLW-e4e6Cw_2ujF5FjoIFq"); }
  if (classCode == "27AH") { parentFolder = DriveApp.getFolderById("189oFaF5nLyvB7FFOyL_A5RdDYIn22GBX"); } 
  if (classCode == "24AH") { parentFolder = DriveApp.getFolderById("1SySkSBE_2lcenlAo1Jllg3G3rY6G-tr6"); }
  if (classCode == "25AH") { parentFolder = DriveApp.getFolderById("1A2gqeqooC0LO4ds57M-ElZ-RN6J-ScnA"); }
}

function choosePaperTemplate() {
  if (testName.toString().includes("P1")) { templateFile = DriveApp.getFileById("1C2tHSaN2mgJA9IU0FPbyTeo_Yk33j_6C13B5nUsK7Bg"); }
  if (testName.toString().includes("P2")) { templateFile = DriveApp.getFileById("135Eh2gVHvnum6Vq6GahPJhmnwNrb4dp4S7t6F1RondY"); }
  if (testName.toString().includes("P3")) { templateFile = DriveApp.getFileById("1tj44_JYJx1kGV64N1NItA8y3aHYBvNkPdpTb6o1dqR4"); }
}

function getRowDataClean(rowNumber) {
  var lastCol = ppqSelector.getLastColumn();
  if (lastCol < 7) return [];
  var data = ppqSelector.getRange(rowNumber, 7, 1, lastCol - 6).getValues()[0];
  return data.filter(function(cell) { return cell !== "" && cell !== null; });
}

function linkToDriveFolder() {
  codeCell = ppqSelector.getRange("G6");
  var codeCellColumn = codeCell.getColumn();
  var codeCellRow = codeCell.getRow();
  const rangeToAddLink = ppqSelector.getRange(codeCellRow - 5, codeCellColumn); 
  const richText = SpreadsheetApp.newRichTextValue().setText(testName).build();
  rangeToAddLink.setRichTextValue(richText);
}

function storeVariable(idToStore) { scriptProperties.setProperty('Id', idToStore); }

/**function createTestAndMS() {
  Logger.log("🚀 START: createTestAndMS");
  
  var newFolder = parentFolder.createFolder(testName);
  var copiedTemplate = templateFile.makeCopy(testName, newFolder);
  var templateID = copiedTemplate.getId();
  
  // --- 1. DOCS & MARKSCHEME ---
  var docIDs = []; docIDs.push(templateID); 
  var qDocs = getRowDataClean(7); docIDs = docIDs.concat(qDocs);
  var baseDoc = DocumentApp.openById(docIDs[0]); var body = baseDoc.getActiveSection();
  for (var i = 1; i < docIDs.length; ++i) {
    var otherBody = DocumentApp.openById(docIDs[i]).getActiveSection();
    var totalElements = otherBody.getNumChildren();
    for (var j = 0; j < totalElements; ++j) {
      var element = otherBody.getChild(j).copy();
      var type = element.getType();
      if (type == DocumentApp.ElementType.PARAGRAPH) body.appendParagraph(element);
      else if (type == DocumentApp.ElementType.TABLE) body.appendTable(element);
      else if (type == DocumentApp.ElementType.LIST_ITEM) body.appendListItem(element);
    }
  }
   var msTemplate = testName + '_ms'; const newTest = DocumentApp.create(msTemplate); 
   var newTestFile = DriveApp.getFileById(newTest.getId()); DriveApp.getFolderById(newFolder.getId()).addFile(newTestFile);
   var msIDs = [newTest.getId()]; var msDocs = getRowDataClean(8); msIDs = msIDs.concat(msDocs);
   var baseDocMS = DocumentApp.openById(msIDs[0]); var bodyMS = baseDocMS.getActiveSection();
   for (var i = 1; i < msIDs.length; ++i) {
      var otherBody = DocumentApp.openById(msIDs[i]).getActiveSection();
      var totalElements = otherBody.getNumChildren();
      for (var j = 0; j < totalElements; ++j) {
        var element = otherBody.getChild(j).copy();
        var type = element.getType();
       if (type == DocumentApp.ElementType.PARAGRAPH) bodyMS.appendParagraph(element);
       else if (type == DocumentApp.ElementType.TABLE) bodyMS.appendTable(element);
       else if (type == DocumentApp.ElementType.LIST_ITEM) bodyMS.appendListItem(element);
     }
   }
   baseDoc.saveAndClose(); newTest.saveAndClose();
   Logger.log("✅ Docs Generated.");

  // --- 2. ASSESSMENT FORM ---
  var assessIter = parentFolder.searchFiles('title contains "assessment" and mimeType = "' + MimeType.GOOGLE_FORMS + '"');
  if (assessIter.hasNext()) {
    assessIter.next().makeCopy(testName + " How was the assessment?", newFolder);
  }

  // --- GUARD RAIL ---
  if (classCode !== "27AH") {
    linkToDriveFolder(); 
    storeVariable(templateID); 
    return; 
  }

  // ===========================================================================
  // ☢️ HYBRID FORM BUILD
  // ===========================================================================
  var questionLabels = [];
  var capturedBankCodes = []; 
  var capturedTotalMarks = []; 
  var capturedSyllabus = [];   
  var capturedPartMarks = [];  
  
  // 🔗 LINKER UPDATE 1: Create array to store URLs
  var capturedURLs = []; 
  
  var rawExamCodes = getRowDataClean(6);
  var startCol = 7;
  var highestMark = 0; 
  
  for(var k=0; k < rawExamCodes.length; k++) {
      var currentColumn = startCol + k;
      var row3Label = ppqSelector.getRange(3, currentColumn).getValue().toString();
      var marksVal  = ppqSelector.getRange(2, currentColumn).getValue(); 
      
      // 🔗 LINKER UPDATE 2: Get Doc ID from Row 7 and convert to URL
      var docId = ppqSelector.getRange(7, currentColumn).getValue();
      var docUrl = "https://docs.google.com/document/d/" + docId;

      var rawParts = ppqSelector.getRange(9, currentColumn, 8, 1).getValues().flat().filter(String);
      var rawSyllabus = ppqSelector.getRange(17, currentColumn, 8, 1).getValues().flat();
      var rawPartMarks = ppqSelector.getRange(25, currentColumn, 8, 1).getValues().flat();
      
      if (rawParts.length === 1) {
        questionLabels.push(row3Label);
        capturedBankCodes.push(rawParts[0]);
        capturedTotalMarks.push(marksVal);
        capturedSyllabus.push(rawSyllabus[0] || "");
        var m = rawPartMarks[0] || 0;
        capturedPartMarks.push(m); 
        
        // Push URL for single part
        capturedURLs.push(docUrl); 
        
        if (Number(m) > highestMark) highestMark = Number(m);

      } else if (rawParts.length > 1) {
        rawParts.forEach(function(partCode, idx) {
            var match = partCode.match(/\d([^\d]*)$/);
            var suffix = (match && match[1]) ? match[1] : "";
            questionLabels.push(row3Label + suffix);
            capturedBankCodes.push(partCode);
            capturedSyllabus.push(rawSyllabus[idx] || "");
            var m = rawPartMarks[idx] || 0;
            capturedPartMarks.push(m);
            
            // Push URL for every part (so 1a, 1b, 1c all link to the same Doc)
            capturedURLs.push(docUrl);

            if (Number(m) > highestMark) highestMark = Number(m);
            if (idx === 0) { capturedTotalMarks.push(marksVal); } else { capturedTotalMarks.push(""); }
        });
      }
  }

  if (questionLabels.length > 0) {
    try {
      // ⚡ STEP A: NATIVE CREATION
      Logger.log("⚡ Creating Native Form (FormApp)...");
      var form = FormApp.create(testName + " marks achieved");
      var formId = form.getId();

      // ⚡ STEP B: INJECT PERMISSIONS
      try {
        var permissionResource = { "role": "reader", "type": "anyone", "withLink": true };
        Drive.Permissions.insert(permissionResource, formId);
      } catch (e) { Logger.log("❌ Permission Error: " + e.message); }

      // ⚡ STEP C: ADD CONTENT
      var gridItem = form.addGridItem();
      gridItem.setTitle("Please fill out the points that you think you earned based on the markscheme:");
      gridItem.setRows(questionLabels);
      
      var colArray = [];
      var limit = (highestMark > 0) ? highestMark : 10; 
      for (var c = 0; c <= limit; c++) { colArray.push(c.toString()); }
      gridItem.setColumns(colArray);
      gridItem.setRequired(false);

      // ⚡ STEP D: FORCE VERIFIED EMAIL
      try { setVerifiedEmailViaRest(formId); } catch (e) { Logger.log("⚠️ REST API Error: " + e.message); }

      // ⚡ STEP E: SETTINGS & EDITOR
      form.setAllowResponseEdits(true);
      form.setLimitOneResponsePerUser(true);
      try { form.addEditor("pcleveng@amersol.edu.pe"); } catch (e) {}
      
      // ⚡ STEP F: MOVE TO SCHOOL FOLDER
      var formFile = DriveApp.getFileById(formId);
      formFile.moveTo(newFolder);

      // --- STEP G: DATABASE CONNECTION ---
      var masterSSId = "1sONUu-uxPHsp-VuNxa3d1pM7x_HdNBjftRjLE0BI9KA"; 
      var masterSS = SpreadsheetApp.openById(masterSSId);
      var match = testName.match(/\[([A-Za-z]+)(\d+)\]/);
      var cleanSheetName = (match) ? match[1].charAt(0).toUpperCase() + ("0" + match[2]).slice(-2) : testName.replace(/ /g, "_");
      
      var oldSheets = masterSS.getSheets().map(s => s.getSheetId());
      
      form.setDestination(FormApp.DestinationType.SPREADSHEET, masterSSId);
      var formUrl = form.getPublishedUrl();
      
      SpreadsheetApp.flush(); 
      Utilities.sleep(2000); 
      
      var allSheets = masterSS.getSheets();
      var responseSheet = allSheets.find(s => !oldSheets.includes(s.getSheetId()));
      
      if (responseSheet) {
        var responseTabName = cleanSheetName + "_R";
        var existingResSheet = masterSS.getSheetByName(responseTabName);
        if (existingResSheet) { masterSS.deleteSheet(existingResSheet); }
        responseSheet.setName(responseTabName);
      }

      var newSheet = masterSS.getSheetByName(cleanSheetName);
      if (!newSheet) { newSheet = masterSS.insertSheet(cleanSheetName); } 
      else { newSheet.clear(); }

      var headerRow1 = ["Label (Student)", ""].concat(questionLabels);
      // var headerRow2 removed in favor of RichText below
      var headerRow3 = ["Max Points", ""].concat(capturedPartMarks); 
      var headerRow4 = ["Syllabus Code", ""].concat(capturedSyllabus);
      
      newSheet.getRange(1, 1, 1, headerRow1.length).setValues([headerRow1]);
      // Row 2 is handled below
      newSheet.getRange(3, 1, 1, headerRow3.length).setValues([headerRow3]);
      newSheet.getRange(4, 1, 1, headerRow4.length).setValues([headerRow4]);

      // 🔗 LINKER UPDATE 3: Build RichText Row 2 with Hyperlinks
      var richTextRow2 = [];
      // Add first two columns (Header + Empty Spacer)
      richTextRow2.push(SpreadsheetApp.newRichTextValue().setText("Bank Code (System)").build());
      richTextRow2.push(SpreadsheetApp.newRichTextValue().setText("").build());

      // Iterate through codes and apply corresponding URLs
      for (var i = 0; i < capturedBankCodes.length; i++) {
        var builder = SpreadsheetApp.newRichTextValue()
          .setText(capturedBankCodes[i])
          .setLinkUrl(capturedURLs[i])
          .build();
        richTextRow2.push(builder);
      }
      // Write Row 2 as RichText
      newSheet.getRange(2, 1, 1, richTextRow2.length).setRichTextValues([richTextRow2]);


      newSheet.getRange("A5").setValue("Email");
      newSheet.getRange("B5").setValue("Name");
      newSheet.getRange("A6").setFormula("={'Students'!A2:B}");

      var studentSheet = masterSS.getSheetByName("Students");
      var lastRow = studentSheet.getLastRow();
      var regRow = 2;
      while (studentSheet.getRange(regRow, 8).getValue() !== "" && regRow <= lastRow) { regRow++; }
      
      studentSheet.getRange(regRow, 7).setValue(cleanSheetName);       
      studentSheet.getRange(regRow, 8).setValue(testName);             
      studentSheet.getRange(regRow, 9).setValue(cleanSheetName + "_R"); 
      studentSheet.getRange(regRow, 10).setValue(formUrl);             
      studentSheet.getRange(regRow, 11).setValue("✅ Ready");          

      masterSS.setActiveSheet(newSheet);
      masterSS.moveActiveSheet(1);

      Logger.log("🎉 SUCCESS: Pipeline Complete.");
      SpreadsheetApp.getActiveSpreadsheet().toast("Pipeline Complete!", "Success", 5);

    } catch (e) {
      Logger.log("❌ CRITICAL ERROR: " + e.message);
      SpreadsheetApp.getUi().alert("CRITICAL ERROR: " + e.message);
    }
  }
  
  linkToDriveFolder();
  storeVariable(templateID);
}
*/

/**
 * 🤖 SET VERIFIED EMAIL VIA REST API
 * This uses UrlFetchApp to bypass the limitations of FormApp service.
 * Requires scopes in appsscript.json.
 */
function setVerifiedEmailViaRest(formId) {
  var url = "https://forms.googleapis.com/v1/forms/" + formId + ":batchUpdate";
  var payload = {
    "requests": [
      {
        "updateSettings": {
          "settings": {
            "emailCollectionType": "VERIFIED"
          },
          "updateMask": "emailCollectionType"
        }
      }
    ]
  };
  
  var options = {
    "method": "post",
    "contentType": "application/json",
    "headers": {
      "Authorization": "Bearer " + ScriptApp.getOAuthToken()
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();
  
  if (responseCode !== 200) {
    throw new Error("Forms API returned " + responseCode + ": " + response.getContentText());
  }
}

function editCoverPage() {
  // Retrieve the ID of the last created doc (stored by testBuilder)
  var storedId = scriptProperties.getProperty('Id');
  
  if (!storedId) {
    SpreadsheetApp.getActiveSpreadsheet().toast("❌ No recent document found. Run testBuilder first.", "Error", 5);
    return;
  }

  var doc = DocumentApp.openById(storedId);
  var body = doc.getBody();
  var paragraphs = body.getParagraphs();

  // 1. Update Test Name (Paragraph 5)
  try {
    paragraphs[5].setText(testName);
    paragraphs[5].setAttributes({FONT_SIZE: 11, BOLD: false});
  } catch (e) { Logger.log("Index 5 (Name) not found"); }

  // 2. Calculate Total Marks from Row 2
  var marksData = getRowDataClean(2);
  var marks = marksData.reduce((a, b) => a + Number(b), 0);

  // 3. Update Marks (Paragraph 18)
  try {
    paragraphs[18].appendText(" [" + marks + " marks].");
    paragraphs[18].setAttributes({FONT_SIZE: 11, BOLD: true});
  } catch (e) { Logger.log("Index 18 (Marks) not found"); }

  // 4. Calculate & Update Time (Paragraph 7)
  // Logic: 1.1 minutes per mark
  var minutes = Math.ceil(marks * 12 / 11);
  try {
    paragraphs[7].setText(minutes + " minutes");
    paragraphs[7].setAttributes({FONT_SIZE: 11});
  } catch (e) { Logger.log("Index 7 (Time) not found"); }

  // 5. 📄 RESTORED: Page Count (Paragraph 46)
  // This exports the Doc as a PDF blob to count the pages reliably.
  try {
    var pdfBlob = DriveApp.getFileById(storedId).getBlob();
    var pdfText = pdfBlob.getDataAsString();
    // The "split" hack counts the number of page content streams in the PDF structure
    var pages = pdfText.split("/Contents").length - 2; 
    
    // Safety check: Ensure the value isn't negative or weird
    if (pages < 1) pages = 1; 

    if (paragraphs.length > 46) {
      paragraphs[46].setText(pages + " pages");
      paragraphs[46].setAttributes({FONT_SIZE: 11});
      Logger.log("✅ Page count updated: " + pages);
    } else {
      Logger.log("⚠️ Paragraph 46 does not exist. Doc is too short.");
    }
  } catch (e) {
    Logger.log("❌ Error counting pages: " + e.message);
  }

  // 6. Cleanup "Section B" placeholders
  // (Removes extra section headers if they exist)
  var secB = body.getText().indexOf("Section B", 400);
  while (secB > 0) {
    try {
       // Only deletes if found.
       // Note: This requires careful indexing. Disabling delete for safety is an option.
       // doc.editAsText().deleteText(secB, secB + 105); 
    } catch (e) {}
    secB = body.getText().indexOf("Section B", secB + 1);
  }
  
  doc.saveAndClose();
  SpreadsheetApp.getActiveSpreadsheet().toast("✅ Cover Page Updated (Title, Marks, Time, Pages)", "Success", 3);
}