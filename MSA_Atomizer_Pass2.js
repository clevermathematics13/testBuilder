/**
 * MSA Atomizer Pass 2 (Repair)
 * - Normalizes mark tokens like "A1,A1" -> "A1A1"
 * - Splits A1A1 into two A1 points using nearby note text:
 *     "Award A1 for a correct X and A1 for a correct Y"
 *
 * Expected input:
 *   pass1 = { pass:"pass1", points:[...], warnings:[...] }
 *   ocrByPage = { "1": [lines...], "2": [lines...] }  // pageNumber as string or number is fine
 *
 * Output:
 *   { pass:"pass2", points:[...], warnings:[...] }
 */

function msaAtomizerPass2_(pass1, ocrByPage) {
  var out = JSON.parse(JSON.stringify(pass1 || { pass: "pass1", points: [], warnings: [] }));
  out.pass = "pass2";
  out.warnings = (out.warnings || []).slice();

  var newPoints = [];
  var usedIds = {};

  for (var i = 0; i < (out.points || []).length; i++) {
    var p = JSON.parse(JSON.stringify(out.points[i]));
    p.mark = msaNormalizeMarkToken_(p.mark);

    // Attempt to split any compound mark (e.g., "A1A1", "A2N2")
    const splitTokens = msaSplitCompoundMark_(p.mark);

    if (splitTokens) {
      let splitPoints = null;

      // If it's a double-same-token (A1A1), try the smart note-based split first.
      if (msaIsDoubleSameToken_(p.mark)) {
        splitPoints = msaTrySplitDoubleMarkUsingNote_(p, ocrByPage);
      }

      // If smart split failed or wasn't applicable, do a simple split.
      if (!splitPoints) {
        splitPoints = msaSimpleSplit_(p, splitTokens);
      }

      // Add the newly created points to our list
      if (splitPoints && splitPoints.length > 0) {
        splitPoints.forEach(sp => {
          sp.id = msaMakeUniqueId_(sp.id, usedIds);
          usedIds[sp.id] = true;
          newPoints.push(sp);
        });
        continue; // Skip adding the original point
      } else {
        // This case is unlikely but safe: splitting was attempted but failed.
        // Keep the original point and add a warning.
        out.warnings.push("Pass2: Could not split compound mark '" + p.mark + "' for point id=" + (p.id || "(no id)"));
      }
    }

    // If it wasn't a compound mark or splitting failed, add the original point.
    p.id = msaMakeUniqueId_(p.id, usedIds);
    usedIds[p.id] = true;
    newPoints.push(p);
  }

  out.points = newPoints;
  return out;
}

/**
 * Splits a compound mark string like "A1A1N2" into an array of tokens ["A1", "A1", "N2"].
 * Returns null if it's not a compound mark (i.e., contains only one token).
 */
function msaSplitCompoundMark_(mark) {
  // Matches one or more mark tokens (A1, M2, N5, etc.)
  const tokens = String(mark || "").match(/[AMRN]\d+/g);
  if (tokens && tokens.length > 1) {
    return tokens;
  }
  return null; // Not a compound mark
}

/**
 * Converts variants like "(A1)" or "A1, A1" or "A1 A1" to "A1A1" where appropriate.
 */
function msaNormalizeMarkToken_(mark) {
  var s = (mark == null) ? "" : String(mark);
  s = s.trim();

  // strip parentheses
  if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") {
    s = s.substring(1, s.length - 1).trim();
  }

  // normalize separators
  s = s.replace(/\s+/g, "");     // remove spaces
  s = s.replace(/,/g, "");       // remove commas
  s = s.replace(/;/g, "");       // remove semicolons

  return s;
}

/**
 * True if mark looks like A1A1 / M2M2 / N2N2 etc (same token repeated twice).
 */
function msaIsDoubleSameToken_(mark) {
  if (!mark) return false;
  // Example: A1A1, M2M2, N2N2
  var m = String(mark).match(/^([A-Z]\d+)\1$/);
  return !!m;
}

/**
 * Attempts to split A1A1 into two A1 points using nearby OCR note lines.
 * Looks forward from source_line_index for a line like:
 *  "Note: Award A1 for a correct numerator and A1 for a correct denominator."
 *
 * Returns [p1, p2] or null.
 */
function msaTrySplitDoubleMarkUsingNote_(point, ocrByPage) {
  var pageNum = (point.page == null) ? null : String(point.page);
  var lines = ocrByPage && (ocrByPage[pageNum] || ocrByPage[Number(pageNum)]);
  if (!lines || !lines.length) return null;

  var idx = msaSafeLineIndex_(point, lines);

  // Scan for the CLOSEST relevant "Award A1 ... and A1 ..." note in a window.
  var windowStart = Math.max(0, idx);
  var windowEnd = Math.min(lines.length, idx + 20);

  var bestMatch = null;

  for (var j = windowStart; j < windowEnd; j++) {
    var l = String(lines[j] || "").trim();
    if (!l) continue;

    if (/Award\s+A1/i.test(l)) {
      // Try patterns like:
      // "Award A1 for a correct numerator and A1 for a correct denominator"
      // "Award A1 for a correct first term... and A1 for a correct second term..."
      var re = /Award\s+A1\s+for\s+(?:a\s+)?correct\s+(.+?)\s+and\s+A1\s+for\s+(?:a\s+)?correct\s+(.+?)(?:\.$|$)/i;
      var m = l.match(re);

      if (!m) {
        // Sometimes OCR drops "correct" twice, try a looser parse:
        var re2 = /Award\s+A1\s+for\s+(.+?)\s+and\s+A1\s+for\s+(.+?)(?:\.$|$)/i;
        m = l.match(re2);
      }

      if (m) {
        // It's a valid split line. Is it the closest one so far?
        const distance = Math.abs(j - idx);
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = { line: l, match: m, distance: distance };
        }
      }
    }
  }

  if (!bestMatch) return null;
  var awardLine = bestMatch.line;
  var m = bestMatch.match;

  var left = msaCleanSplitText_(m[1]);
  var right = msaCleanSplitText_(m[2]);

  // Original token like "A1A1" -> new marks are "A1"
  var baseToken = String(point.mark).match(/^([A-Z]\d+)\1$/)[1];

  var p1 = JSON.parse(JSON.stringify(point));
  var p2 = JSON.parse(JSON.stringify(point));

  p1.mark = baseToken;
  p2.mark = baseToken;

  // Better IDs (stable + readable)
  var baseId = point.id || ("p" + pageNum + "_split");
  p1.id = baseId + "_A";
  p2.id = baseId + "_B";

  // Prepend the split text to the original requirement to preserve context.
  const originalReq = (point.requirement || "").trim();
  p1.requirement = "Award " + baseToken + " for: " + left + (originalReq ? "\n\n" + originalReq : "");
  p2.requirement = "Award " + baseToken + " for: " + right + (originalReq ? "\n\n" + originalReq : "");

  // Add the split source to the notes array.
  p1.notes = (p1.notes || []).slice();
  p2.notes = (p2.notes || []).slice();
  p1.notes.push("Pass2 split source: " + awardLine);
  p2.notes.push("Pass2 split source: " + awardLine);

  return [p1, p2];
}

/**
 * A fallback splitter that creates multiple points from tokens, duplicating the requirement.
 * Used for cases like A2N2 or A1A1 where no "Award..." note is found.
 */
function msaSimpleSplit_(point, tokens) {
  const splitPoints = [];
  const baseId = point.id || ("p" + point.page + "_split");

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const pNew = JSON.parse(JSON.stringify(point));

    pNew.mark = token;
    pNew.id = baseId + "_" + String.fromCharCode(65 + i); // _A, _B, etc.

    // Add a note indicating this was a simple mechanical split.
    pNew.notes = (pNew.notes || []).slice();
    pNew.notes.push("Pass2: Simple split from original mark '" + point.mark + "'.");

    splitPoints.push(pNew);
  }

  return splitPoints;
}

function msaCleanSplitText_(s) {
  var t = (s == null) ? "" : String(s);
  t = t.replace(/^a\s+/i, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * If point.source_line_index exists, use it.
 * Otherwise try to locate the mark line in OCR (best effort).
 */
function msaSafeLineIndex_(point, lines) {
  if (point && point.source_line_index != null && !isNaN(Number(point.source_line_index))) {
    return Math.max(0, Math.min(lines.length - 1, Number(point.source_line_index)));
  }

  // fallback: search for the mark token in text
  var token = msaNormalizeMarkToken_(point && point.mark);
  if (token) {
    for (var i = 0; i < lines.length; i++) {
      var l = msaNormalizeMarkToken_(String(lines[i] || ""));
      if (l === token) return i;
    }
  }
  return 0;
}

function msaMakeUniqueId_(id, usedIds) {
  var base = (id == null || id === "") ? "point" : String(id);
  if (!usedIds[base]) return base;

  var n = 2;
  while (usedIds[base + "_" + n]) n++;
  return base + "_" + n;
}
