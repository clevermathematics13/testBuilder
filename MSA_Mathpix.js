/****************
 * MSA_Mathpix.gs
 ****************/

function msaGetMathpixCreds_() {
  return {
    appId: "clevermathematis_6a2d44_d66d17",
    appKey: "aea5fa5891cceb5486b02ba3505eb0667652379a310b596f9940dce1a6bf87a9"
  };
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
