/**
 * MSA Atomizer Pass 3 (Enrichment)
 * - Captures final value after THEN (supports -1/4 and LaTeX like -\frac{1}{4})
 * - Adds a note to the THEN A-point when a final value is found
 *
 * Expected input:
 *   passIn = pass1 or pass2 object
 *   ocrByPage = { "1": [lines...], "2": [lines...] }
 *
 * Output:
 *   { pass:"pass3", points:[...], warnings:[...] }
 */

function msaAtomizerPass3_(passIn, ocrByPage) {
  var out = JSON.parse(JSON.stringify(passIn || { pass: "pass1", points: [], warnings: [] }));
  out.pass = "pass3";
  out.warnings = (out.warnings || []).slice();

  for (var i = 0; i < (out.points || []).length; i++) {
    var p = out.points[i];

    // Normalize mark token (helps with A1,A1 etc)
    p.mark = msaNormalizeMarkToken_P3_(p.mark);

    // Enrich THEN A-points with final value
    var isThen = (p.branch || "").toString().toUpperCase() === "THEN";
    var isA = /^A\d+$/i.test(String(p.mark || ""));

    if (isThen && isA) {
      var pageNum = (p.page == null) ? null : String(p.page);
      var lines = ocrByPage && (ocrByPage[pageNum] || ocrByPage[Number(pageNum)]);
      if (!lines || !lines.length) continue;

      var idx = msaSafeLineIndex_P3_(p, lines);

      // scan forward for something that looks like a final computed value
      var finalVal = msaFindFinalValueAfterIndex_(lines, idx);

      p.notes = (p.notes || []).slice();

      if (finalVal) {
        p.notes.push("Pass3: captured final value after THEN: " + finalVal);
      } else {
        out.warnings.push("Pass3: THEN " + p.mark + " had no detected final value on page " + pageNum + " (id=" + (p.id || "(no id)") + ").");
      }
    }
  }

  return out;
}

function msaNormalizeMarkToken_P3_(mark) {
  var s = (mark == null) ? "" : String(mark).trim();
  if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") {
    s = s.substring(1, s.length - 1).trim();
  }
  s = s.replace(/\s+/g, "");
  s = s.replace(/,/g, "");
  s = s.replace(/;/g, "");
  return s;
}

function msaSafeLineIndex_P3_(point, lines) {
  if (point && point.source_line_index != null && !isNaN(Number(point.source_line_index))) {
    return Math.max(0, Math.min(lines.length - 1, Number(point.source_line_index)));
  }
  // fallback
  return 0;
}

/**
 * Finds a final value in lines after idx.
 * Supports:
 *  - "=-1/4"
 *  - "=-\frac{1}{4}"
 *  - "= -\frac{1}{4}"
 *  - "\[=-\frac{1}{4}\]"
 */
function msaFindFinalValueAfterIndex_(lines, idx) {
  var start = Math.max(0, idx);
  var end = Math.min(lines.length, idx + 40);

  for (var i = start; i < end; i++) {
    var l = String(lines[i] || "").trim();
    if (!l) continue;

    // LaTeX fraction: -\frac{1}{4} or \frac{-1}{4}
    var m1 = l.match(/-\\frac\{(\d+)\}\{(\d+)\}/);
    if (m1) return "-" + m1[1] + "/" + m1[2];

    var m2 = l.match(/\\frac\{-?(\d+)\}\{(\d+)\}/);
    if (m2) {
      // This matches \frac{-1}{4} (minus is inside numerator)
      return "-" + m2[1] + "/" + m2[2];
    }

    // Plain fraction: -1/4
    var m3 = l.match(/=\s*(-?\d+)\s*\/\s*(\d+)/);
    if (m3) return m3[1] + "/" + m3[2];

    var m4 = l.match(/(-?\d+)\s*\/\s*(\d+)/);
    if (m4) return m4[1] + "/" + m4[2];
  }

  return null;
}
