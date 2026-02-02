function harvestLegacyExams() {
  // --- CONFIGURATION ---
  // 1. Paste the ID of the folder containing your OLD exam forms
  var sourceFolderId = "1HNcSwPPJA5VCuomRMgAVSjCuOXVHE6p5"; 
  
  // 2. Your Master Database ID (Same as before)
  var masterSSId = "1sONUu-uxPHsp-VuNxa3d1pM7x_HdNBjftRjLE0BI9KA"; 
  // ---------------------

  var folder = DriveApp.getFolderById(sourceFolderId);
  var files = folder.getFilesByType(MimeType.GOOGLE_FORMS);
  var masterSS = SpreadsheetApp.openById(masterSSId);
  var studentSheet = masterSS.getSheetByName("Students");

  Logger.log("--- STARTING HARVEST ---");

  while (files.hasNext()) {
    var file = files.next();
    var fileName = file.getName();

    // Only process files that look like your exams (contain "marks achieved" or similar)
    // Adjust this check if your old files are named differently!
    if (fileName.toLowerCase().includes("marks achieved")) {
      
      try {
        Logger.log("Processing: " + fileName);
        
        // 1. Derive Test Name from Filename
        // Remove " marks achieved" to get the base name (e.g., "27AH [FA4] P1")
        var testName = fileName.replace(/ marks achieved/i, "").trim();
        
        // 2. Generate System Name (e.g., "27AH_P1_FA4")
        var cleanSheetName = testName.replace(/^(.*) \[(.*)\] (.*)$/, "$1_$3_$2");
        if (cleanSheetName === testName) { 
           cleanSheetName = testName.replace(/ \[/, "_").replace(/\] /, "_").replace(/ /g, "_"); 
        }

        // 3. Connect Form to Database
        var form = FormApp.openById(file.getId());
        
        // Take a snapshot of sheets to detect the new one
        var oldSheets = masterSS.getSheets().map(s => s.getSheetId());
        
        // This command pulls ALL historical responses into the sheet immediately
        form.setDestination(FormApp.DestinationType.SPREADSHEET, masterSSId);
        
        SpreadsheetApp.flush();
        Utilities.sleep(2000); // Wait for the dump

        // 4. Rename the Response Tab
        var allSheets = masterSS.getSheets();
        var responseSheet = allSheets.find(s => !oldSheets.includes(s.getSheetId()));
        var responseTabName = "UPDATE_ME"; 
        
        if (responseSheet) {
          responseTabName = cleanSheetName + "_res";
          // Delete duplicate if exists
          var existing = masterSS.getSheetByName(responseTabName);
          if (existing) masterSS.deleteSheet(existing);
          
          responseSheet.setName(responseTabName);
          Logger.log("  > Imported Responses to: " + responseTabName);
        }

        // 5. Create the Grade Tab (If it doesn't exist)
        var gradeSheet = masterSS.getSheetByName(cleanSheetName);
        if (!gradeSheet) {
          gradeSheet = masterSS.insertSheet(cleanSheetName);
          
          // Basic Setup
          gradeSheet.getRange("A4").setValue("Email");
          gradeSheet.getRange("B4").setValue("Name");
          gradeSheet.getRange("A5").setFormula("={'Students'!A2:B}");
          
          // Note: We can't easily guess headers/max points from the form alone 
          // without your "PPQSelector" data, so we leave Row 1-3 empty for you to fill.
          Logger.log("  > Created Grade Tab: " + cleanSheetName);
        }

        // 6. Register in Student Portal
        // Check if already registered to avoid duplicates
        var textFinder = studentSheet.createTextFinder(testName);
        if (!textFinder.findNext()) {
          var lastRow = studentSheet.getLastRow();
          var regRow = 2;
          while (studentSheet.getRange(regRow, 8).getValue() !== "" && regRow <= lastRow) {
            regRow++;
          }
          
          studentSheet.getRange(regRow, 8).setValue(testName);
          studentSheet.getRange(regRow, 9).setValue(responseTabName);
          studentSheet.getRange(regRow, 10).setValue(form.getPublishedUrl());
          studentSheet.getRange(regRow, 11).setValue("✅ Imported");
          Logger.log("  > Registered in Portal");
        } else {
          Logger.log("  > Already registered in Portal. Skipping.");
        }

      } catch (e) {
        Logger.log("❌ ERROR processing " + fileName + ": " + e.message);
      }
    }
  }
  Logger.log("--- HARVEST COMPLETE ---");
}