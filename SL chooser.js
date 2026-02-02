function updateChooserSheet() {
  // Access the active spreadsheet
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Get the HL list and Chooser sheets
  var hlListSheet = ss.getSheetByName("SL list");
  var chooserSheet = ss.getSheetByName("SL chooser");
  
  // Get all the data from HL list
  var hlListData = hlListSheet.getDataRange().getValues();
  var hlListRichTextData = hlListSheet.getDataRange().getRichTextValues(); // For hyperlinks and rich text
  
  // Get the current number of rows in Chooser sheet
  var lastRow = chooserSheet.getLastRow();
  
  // Clear Chooser sheet's existing data (except headers), but only if there are rows to clear
  if (lastRow > 1) {
    chooserSheet.getRange(2, 1, lastRow - 1, 3).clearContent();
  }

  // Variables to store the data to be written to the Chooser sheet
  var chooserData = [];
  var hyperlinkData = [];

  // Create a map to quickly find the position of codes in the HL list sheet
  var hlListCodeMap = {};
  for (var i = 0; i < hlListData.length; i++) {
    for (var j = 0; j < hlListData[i].length; j++) {
      var richTextValue = hlListRichTextData[i][j];
      var cellValue = hlListData[i][j];
      
      // If there's a valid hyperlink, store the position
      if (richTextValue.getLinkUrl() && isValidCode(cellValue)) {
        hlListCodeMap[cellValue] = { range: hlListSheet.getRange(i + 1, j + 1).getA1Notation(), row: i + 1, col: j + 1 };
      }
    }
  }
  
  // Now process and add data to the Chooser sheet
  for (var code in hlListCodeMap) {
    var codeInfo = hlListCodeMap[code]; // Get the location and row/column information of the code in HL list sheet
    
    var row = codeInfo.row - 1; // Convert to zero-based index for easier access to hlListData
    var col = codeInfo.col - 1;

    var marks = hlListData[row][col - 1]; // Get marks to the left
    var section = hlListData[row][col + 1]; // Get section one cell to the right
    
    // Add data to the Chooser array (marks, code placeholder, section)
    chooserData.push([marks, code, section]);
    
    // Create the hyperlink to the code in the HL list
    hyperlinkData.push({ row: chooserData.length + 1, code: code, range: codeInfo.range });
  }
  
  // Write all the data at once to the Chooser sheet
  if (chooserData.length > 0) {
    chooserSheet.getRange(2, 1, chooserData.length, 3).setValues(chooserData);
    
    // Now set hyperlinks in column B for the codes
    hyperlinkData.forEach(function(linkInfo) {
      var cell = chooserSheet.getRange(linkInfo.row, 2); // Get the cell for the hyperlink
      cell.setRichTextValue(SpreadsheetApp.newRichTextValue()
        .setText(linkInfo.code)
        .setLinkUrl(ss.getUrl() + "#gid=" + hlListSheet.getSheetId() + "&range=" + linkInfo.range)
        .build());
    });
  }
}

// Helper function to check if the code is valid (ignores codes like TZ1, TZ0, TZ2)
function isValidCode(code) {
  var invalidCodes = ["TZ1", "TZ0", "TZ2"];
  return !invalidCodes.includes(code);
}
