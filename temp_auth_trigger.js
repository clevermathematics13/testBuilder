/**
 * Temporary function to trigger OAuth consent for Drive scope.
 * Run this ONCE in the Apps Script editor to authorize Drive access.
 * After running once, you can delete this function.
 */
function authorizeDriveForExecutionApi() {
  // This will trigger the OAuth consent flow for Drive scope
  var testFolder = DriveApp.getFolderById('root');
  Logger.log('Authorization successful! Folder: ' + testFolder.getName());
  return 'Drive scope authorized. You can now use the Execution API.';
}
