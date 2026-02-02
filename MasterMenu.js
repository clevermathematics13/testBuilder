/*
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  
  // Consolidate all menu items into a single menu
  ui.createMenu("Custom Tools")
    .addSubMenu(ui.createMenu("Chooser Tools")
      .addItem("Update Chooser Sheet", "updateChooserSheetV5_6")
      .addItem("Apply Regex Filter", "showRegexPromptV5_7"))
    .addSubMenu(ui.createMenu("PPQ Selector")
      .addItem("Clear PPQselector", "resetIteration"))
    .addSubMenu(ui.createMenu("Test Builder")
      .addItem("Populate Google Doc IDs", "returnAllID")
      .addItem("Export to GradeBook", "exportToGradebook")
      .addSeparator()
      .addItem("Create Test Materials", "testBuilder")
      .addItem("Edit Cover Page", "editCoverPage")
      .addSeparator()
      .addItem("Reset Builder", "resetBuilder")
      .addItem("Clear All", "clearAll"))
    .addToUi();
}
*/