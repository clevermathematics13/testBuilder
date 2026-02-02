//PURPOSE: Populates PPQselector when questions are checked in HL/SL List.
//UPDATED: resetIteration now PRESERVES Row 3 (Question Labels).

var ppqSelector = SpreadsheetApp.getActive().getSheetByName('PPQselector');
var hlList = SpreadsheetApp.getActive().getSheetByName('HL list');
var slList = SpreadsheetApp.getActive().getSheetByName('SL list');

// CONFIGURATION
var SYLLABUS_OFFSET = 1; 
var MARKS_OFFSET = -1;   

function onEdit(e) {
  var range = e.range;
  var curSheet = range.getSheet();
  var sheetName = curSheet.getName();
  
  if (sheetName !== 'HL list' && sheetName !== 'SL list') { return; }

  if (e.value == "TRUE" || e.value === true) {
    var clickCol = range.getColumn();
    var clickRow = range.getRow();

    try {
      // 1. Zone Logic
      var inZone = curSheet.getRange(4, clickCol);
      var mergedRanges = inZone.getMergedRanges();
      var codeCol;
      
      if (mergedRanges.length == 0) {
        codeCol = clickCol + 1; 
      } else {
        var zoneCell = mergedRanges[0].getCell(1,1); 
        codeCol = zoneCell.getColumn()+1;
      }

      var codingCell = curSheet.getRange(clickRow, codeCol); 
      var code = codingCell.getValue();
      
      // 2. Setup PPQselector Column
      var prevColIt = Number(ppqSelector.getRange(1,2).getValue());
      var targetCol = prevColIt + 1;
      ppqSelector.getRange(1,2).setValue(targetCol); 
      ppqSelector.getRange(6, targetCol).setValue(code); 
      
      // 3. Run the optimized list processor
      processQuestionParts(curSheet, clickRow, codeCol, targetCol, codingCell.getValue());

    } catch (error) {
      Logger.log("Error in onEdit: " + error.message);
    }
  }
}

function processQuestionParts(sourceSheet, startRow, codeCol, targetCol, fullCode) {
  var codeStripParts = fullCode;
  var codePartsEnd = fullCode.slice(-1);
  while ( isNaN(parseFloat(codePartsEnd)) && !isFinite(codePartsEnd)) {
    codeStripParts = codeStripParts.slice(0,-1);
    codePartsEnd = codeStripParts.slice(-1);
  }
  var coreCode = codeStripParts;

  // Batch Read (20 rows)
  var searchRange = sourceSheet.getRange(startRow, codeCol - 1, 20, 3).getValues(); 
  
  var partsData = [];
  var syllabusData = [];
  var marksData = [];
  var totalMarks = 0;

  for (var i = 0; i < searchRange.length; i++) {
    var rowData = searchRange[i];
    var currentCode = rowData[1].toString(); 
    
    if (!currentCode.includes(coreCode)) {
      break; 
    }

    partsData.push([currentCode]);

    var mVal = rowData[0];
    marksData.push([mVal]); 
    if (typeof mVal === 'number') {
      totalMarks += mVal;
    }

    syllabusData.push([rowData[2]]);
  }

  // Batch Write
  if (partsData.length > 0) {
    ppqSelector.getRange(9, targetCol, partsData.length, 1).setValues(partsData);
    ppqSelector.getRange(17, targetCol, syllabusData.length, 1).setValues(syllabusData);
    ppqSelector.getRange(25, targetCol, marksData.length, 1).setValues(marksData);
    ppqSelector.getRange(2, targetCol).setValue(totalMarks);
  }
}

// ======================================================
// 🚀 UPDATED RESET FUNCTION (SKIPS ROW 3)
// ======================================================
function resetIteration() {
  // 1. Clear Row 2 ONLY (Total Marks)
  ppqSelector.getRange("G2:AZ2").clearContent();
  
  // 2. Clear Row 4 down to the bottom (Syllabus, Codes, Docs, Parts, Marks)
  // This explicitly PROTECTS Row 3 (Question Labels)
  ppqSelector.getRange("G4:AZ50").clearContent(); 
  
  // Reset Column Counter to 6 (Column F) so the next click starts at 7 (G)
  ppqSelector.getRange(1,2).setValue(6);
}