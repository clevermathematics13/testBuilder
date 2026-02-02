function returnAllID() {
  try {
    returnFileID();
    returnMSfileID();
    SpreadsheetApp.getUi().alert("✅ Doc IDs Populated Successfully");
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message);
  }
}

function returnFileID() {
  var examFolder = DriveApp.getFolderById('18vwi-jz_0vur8MjixNnTkKdb0lHygNV3'); 
  var examCodes = getRowDataClean(6); 
  if (examCodes.length === 0) return;

  var outputRow = 7; 
  var codeOutputRow = 5; 
  var startCol = 7; 
  
  var files = examFolder.getFiles();
  var fileMap = {};
  while (files.hasNext()) {
    var f = files.next();
    fileMap[f.getName()] = f.getId();
  }

  for (var i = 0; i < examCodes.length; i++) {
    var rawCode = examCodes[i];
    var strippedCode = rawCode;
    var codeEnd = strippedCode.slice(-1);
    while (isNaN(parseFloat(codeEnd)) && !isFinite(codeEnd) && strippedCode.length > 0) {
      strippedCode = strippedCode.slice(0,-1);
      codeEnd = strippedCode.slice(-1);
    }
    
    ppqSelector.getRange(codeOutputRow, startCol + i).setValue(strippedCode);

    var fileId = fileMap[strippedCode];
    var cell = ppqSelector.getRange(outputRow, startCol + i);
    
    if (fileId) {
      cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(fileId).setLinkUrl("https://docs.google.com/document/d/" + fileId).build());
    } else {
      cell.setValue("File Not Found");
    }
  }
}

function returnMSfileID() {
  var msFolder = DriveApp.getFolderById('1GDGql-mIeH2YoD1OfnFa0UhxUdaXsY4D'); 
  var examCodes = getRowDataClean(6); 
  if (examCodes.length === 0) return;

  var outputRow = 8; 
  var startCol = 7; 
  
  var files = msFolder.getFiles();
  var fileMap = {}; 
  while (files.hasNext()) {
    var f = files.next();
    fileMap[f.getName()] = f.getId();
  }

  for (var i = 0; i < examCodes.length; i++) {
    var rawCode = examCodes[i];
    var strippedCode = rawCode;
    var codeEnd = strippedCode.slice(-1);
    while (isNaN(parseFloat(codeEnd)) && !isFinite(codeEnd) && strippedCode.length > 0) {
      strippedCode = strippedCode.slice(0,-1);
      codeEnd = strippedCode.slice(-1);
    }
    
    var fileId = fileMap[strippedCode];
    var cell = ppqSelector.getRange(outputRow, startCol + i);
    
    if (fileId) {
      cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(fileId).setLinkUrl("https://docs.google.com/document/d/"+fileId).build());
    } else {
      cell.setValue("MS Not Found");
    }
  }
}