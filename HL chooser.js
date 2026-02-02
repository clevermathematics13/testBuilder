function onOpen() {
  var ui = SpreadsheetApp.getUi();

  // ⚡ Main Menu Name
  ui.createMenu("⚡ Exam Factory")
  
    // 🔍 Submenu: Tools for finding questions
    .addSubMenu(ui.createMenu("🔍 Question Chooser")
      .addItem("🔄 Update List from Database", "updateChooserSheet")
      .addItem("🌪️ Filter Questions (Regex)", "applyRegexFilterV6_3")
      .addItem("👀 Show All Rows (Reset)", "resetFilterV6_3"))
      
    // 🏗️ Submenu: Managing the selection area
    .addSubMenu(ui.createMenu("🏗️ PPQ Workspace")
      .addItem("🧹 Clear Workspace", "resetIteration"))
      
    // 📝 Submenu: Building the actual test
    .addSubMenu(ui.createMenu("📝 Exam Assembly")
      .addItem("🆔 Fetch Doc IDs", "returnAllID") 
      .addItem("📓 Export to Gradebook", "exportToGradebook") 
      .addSeparator()
      .addItem("🚀 Build Exam", "testBuilder") 
      .addItem("📄 Update Cover Page", "editCoverPage") 
      .addSeparator()
      .addItem("📦 Archive to History", "archiveCurrentExam") // New Archiver Item
      .addSeparator()
      .addItem("♻️ Reset Builder Form", "resetBuilder") 
      .addItem("🧨 Nuke Everything", "clearAll")) 
      
    .addToUi();
}

// Apply Regex Filter Function
function applyRegexFilterV6_3() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hlChooserSheet = ss.getSheetByName("HL chooser");

  if (!hlChooserSheet) {
    SpreadsheetApp.getUi().alert("HL chooser sheet not found!");
    return;
  }

  // Prompt for regex pattern (e.g., "\\(5\\)" for (5))
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt("Regex Filter", "Enter a regex pattern (e.g., '\\(5\\)' to filter out rows with (5) in Column C):", ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() != ui.Button.OK) {
    return; // Exit if user cancels
  }

  var regexPattern = response.getResponseText();
  if (!regexPattern) {
    ui.alert("No regex pattern provided!");
    return;
  }

  var range = hlChooserSheet.getDataRange();
  var data = range.getValues();
  var regex = new RegExp(regexPattern);

  // Iterate through rows and hide rows that match the filter criteria
  for (var i = 0; i < data.length; i++) {
    var cellValue = data[i][2]; // Column C (index 2)
    if (regex.test(cellValue)) {
      hlChooserSheet.hideRows(i + 1); // Hide the row (1-based index for rows)
    } else {
      hlChooserSheet.showRows(i + 1); // Ensure other rows are visible
    }
  }
}

// Reset Filter Function
function resetFilterV6_3() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hlChooserSheet = ss.getSheetByName("HL chooser");

  if (!hlChooserSheet) {
    SpreadsheetApp.getUi().alert("HL chooser sheet not found!");
    return;
  }

  hlChooserSheet.showRows(1, hlChooserSheet.getMaxRows()); // Unhide all rows
}

// Update Chooser Sheet Function
function updateChooserSheet() {
  // Access the active spreadsheet
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Get the HL list and Chooser sheets
  var hlListSheet = ss.getSheetByName("HL list");
  var chooserSheet = ss.getSheetByName("HL chooser");
  
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

    // Convert marks to string to retain decimal format (e.g., 1.10 instead of 1.1)
    var marks = hlListData[row][col - 1];
    marks = typeof marks === "number" ? marks.toFixed(2) : marks.toString();
    
    var section = hlListData[row][col + 1]; // Get section one cell to the right
    
    // Add data to the Chooser array (marks as string, code placeholder, section)
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
