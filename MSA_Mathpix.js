/****************
 * MSA_Mathpix.gs
 ****************/

function msaGetMathpixCreds_() {
  const props = PropertiesService.getScriptProperties();
  const appId = props.getProperty("MATHPIX_APP_ID");
  const appKey = props.getProperty("MATHPIX_APP_KEY");
  if (!appId || !appKey) {
    throw new Error("Missing Script Properties: MATHPIX_APP_ID and/or MATHPIX_APP_KEY");
  }
  return { appId: appId, appKey: appKey };
}

function msaMathpixOCR_(imageBlob) {
  const creds = msaGetMathpixCreds_();

  const url = "https://api.mathpix.com/v3/text";
  const payload = {
    src: "data:" + imageBlob.getContentType() + ";base64," + Utilities.base64Encode(imageBlob.getBytes()),
    formats: MSA_MATHPIX_FORMATS
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: {
      "app_id": creds.appId,
      "app_key": creds.appKey
    },
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  const text = resp.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error("Mathpix error " + code + ": " + text.slice(0, 400));
  }

  return JSON.parse(text);
}
