/*****************
 * MSA_Preview.gs
 *****************/

function msaBuildPreviewHtml_(docTitle, docId, pagesOcr) {
  // Basic MathJax v3 preview
  const escapedTitle = msaHtmlEscape_(docTitle || "Markscheme Preview");
  const head = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escapedTitle}</title>
<script>
window.MathJax = {
  tex: {
    inlineMath: [['\\\\(','\\\\)']],
    displayMath: [['\\\\[','\\\\]']]
  }
};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<style>
  body { font-family: Arial, sans-serif; margin: 18px; }
  .meta { font-size: 12px; color: #444; margin-bottom: 12px; }
  .page { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin: 14px 0; }
  .page h2 { margin: 0 0 10px 0; font-size: 16px; }
  pre { white-space: pre-wrap; font-family: inherit; }
  .small { font-size: 11px; color: #666; }
</style>
</head>
<body>
<h1>Markscheme Preview (MathJax)</h1>
<div class="meta">
  <div>Doc title: ${escapedTitle}</div>
  <div>Doc ID: ${msaHtmlEscape_(docId)}</div>
  <div>Pages: ${pagesOcr.length}</div>
</div>
`;

  let body = "";
  for (let i = 0; i < pagesOcr.length; i++) {
    const p = pagesOcr[i];
    const reqId = p.request_id || "";
    const conf = (typeof p.confidence === "number") ? p.confidence.toFixed(3) : "";
    const txt = p.text || "";
    body += `
<div class="page">
  <h2>Page ${i + 1}</h2>
  <div class="small">request_id: ${msaHtmlEscape_(reqId)} | confidence: ${msaHtmlEscape_(conf)}</div>
  <pre>${msaHtmlEscape_(txt)}</pre>
</div>
`;
  }

  const foot = `
</body>
</html>`;

  return head + body + foot;
}

function msaHtmlEscape_(s) {
  s = String(s || "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
