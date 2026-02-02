function inspectFolder() {
  var folderId = "189oFaF5nLyvB7FFOyL_A5RdDYIn22GBX"; // The 27AH Folder ID
  
  try {
    var folder = DriveApp.getFolderById(folderId);
    var owner = folder.getOwner();
    var access = folder.getSharingAccess();
    var permission = folder.getSharingPermission();
    
    Logger.log("----- FOLDER DIAGNOSTIC -----");
    Logger.log("📂 Folder Name: " + folder.getName());
    Logger.log("🆔 Folder ID: " + folderId);
    
    if (owner) {
      Logger.log("👤 Owner Email: " + owner.getEmail());
      Logger.log("👤 Owner Name: " + owner.getName());
    } else {
      Logger.log("🏢 Owner: NONE (Likely a Shared Drive/Team Drive)");
    }
    
    Logger.log("🔐 Access Level: " + access); // e.g., PRIVATE, ANYONE_WITH_LINK
    Logger.log("✏️ Permission: " + permission); // e.g., VIEW, EDIT
    Logger.log("-----------------------------");
    
  } catch (e) {
    Logger.log("❌ Error accessing folder: " + e.message);
  }
}