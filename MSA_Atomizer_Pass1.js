/***********************
 * MSA_Atomizer_Pass1.gs
 ***********************/

function msaAtomizePass1_(pagesOcr, rules, skipMapByPart) {
  const warnings = [];
  const points = [];

  for (let p = 0; p < pagesOcr.length; p++) {
    const pageNum = p + 1;
    const rawText = (pagesOcr[p] && pagesOcr[p].text) ? pagesOcr[p].text : "";
    const lines = msaPreprocessLines_(rawText, rules);

    const parsed = msaParsePointsFromLines_(lines, pageNum, skipMapByPart, warnings);
    for (let i = 0; i < parsed.length; i++) points.push(parsed[i]);
  }

  return {
    pass: "pass1",
    points: msaAssignIds_(points),
    warnings: warnings
  };
}

function msaPreprocessLines_(text, rules) {
  const raw = String(text || "").split(/\r?\n/);

  // Apply DROP_LINE rules to remove totals/headers
  const dropRules = rules.filter(r => r.enabled && r.action === "DROP_LINE" && r._re);
  const out = [];

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];

    let drop = false;
    for (let j = 0; j < dropRules.length; j++) {
      if (dropRules[j]._re.test(line)) {
        drop = true;
        break;
      }
    }
    if (!drop) out.push(line);
  }

  return out;
}

function msaParsePointsFromLines_(lines, pageNum, skipMapByPart, warnings) {
  let part = "unknown";
  let branch = null;

  let buffer = [];
  let lastPoint = null;

  const points = [];

  for (let i = 0; i < lines.length; i++) {
    let line = String(lines[i] || "");

    // Part detector: (a), (b), etc.
    const mPart = line.match(/^\s*\(\s*([a-z])\s*\)\s*/i);
    if (mPart) {
      part = mPart[1].toLowerCase();
      // Strip the part marker from the line so it's not duplicated in the requirement,
      // but allow the rest of the line to be processed for marks.
      line = line.substring(mPart[0].length).trim();
    }

    // Branch markers
    if (/^\s*EITHER\s*$/i.test(line)) { branch = "EITHER"; buffer = []; continue; }
    if (/^\s*OR\s*$/i.test(line))     { branch = "OR";     buffer = []; continue; }
    if (/^\s*THEN\s*$/i.test(line))   { branch = "THEN";   continue; }

    // Mark-tag line?
    const markInfo = msaDetectMarkTag_(line);
    if (markInfo) {
      // If the mark was found at the end of a line with content,
      // add that content to the buffer before creating the point.
      if (markInfo.requirementPart) {
        buffer.push(markInfo.requirementPart);
      }

      let requirement = msaTrimBlock_(buffer.join("\n"));
      buffer = [];

      const pt = {
        page: pageNum,
        part: part,
        branch: branch,
        mark: markInfo.mark, // e.g. "A1A1" or "M1"
        requirement: requirement,
        notes: [],
        source_line_index: i
      };

      // // Post-process the requirement to extract any leading note lines.
      // // This prevents "Note:" text from being part of the core requirement.
      // const reqLines = (pt.requirement || "").split('\n');
      // const finalReqLines = [];
      // let isStrippingNotes = true;
      // for (let k = 0; k < reqLines.length; k++) {
      //   const currentLine = reqLines[k];
      //   // Only strip a contiguous block of notes from the beginning.
      //   if (isStrippingNotes && /^\s*(Note:|Accept|Award)/i.test(currentLine)) {
      //     pt.notes.push(currentLine.trim());
      //   } else {
      //     isStrippingNotes = false; // Stop stripping after the first non-note line.
      //     finalReqLines.push(currentLine);
      //   }
      // }
      // pt.requirement = finalReqLines.join('\n').trim();

      if (!pt.requirement) {
        warnings.push("Page " + pageNum + ": mark " + pt.mark + " had empty requirement context.");
      }

      if (skipMapByPart && skipMapByPart[part]) {
        pt.skip_autograde = true;
      }

      points.push(pt);
      lastPoint = pt;
      continue;
    }

    // Otherwise accumulate as requirement context
    if (line.trim() !== "") buffer.push(line);
  }

  return points;
}

function msaDetectMarkTag_(line) {
  const s = String(line || "").trim();

  // Case 1: Handle simple cases like (AG) or AG
  if (/^\(?\s*AG\s*\)?$/.test(s)) {
    return { mark: "AG", requirementPart: null };
  }

  // Find all potential mark tokens on the line
  const markTokens = s.match(/[AMRN]\d+/g);

  if (!markTokens) {
    return null;
  }

  // Case 2: Check if it's a mark-only line (e.g., "(M1)" or "A1, A1")
  const stripped = s.replace(/[AMRN]\d+/g, "").replace(/[\(\),;]/g, "").trim();
  if (stripped.length === 0) {
    return {
      mark: markTokens.join(""),
      requirementPart: null // Indicates no requirement on this line
    };
  }

  // Case 3: Check for marks in parentheses at the end of a line with content.
  // e.g., "some text (A1)" or "other text (A1,A1)"
  const endOfLineMatch = s.match(/^(.*)\s+\((.*)\)$/);
  if (endOfLineMatch) {
    const requirementPart = endOfLineMatch[1].trim();
    const marksPart = endOfLineMatch[2];

    // Validate that the part in parentheses *only* contains mark tokens and separators.
    const marksPartTokens = marksPart.match(/[AMRN]\d+/g);
    if (!marksPartTokens) {
      // The content in parentheses was not a mark, e.g., "some text (see note)".
      return null;
    }

    const marksPartStripped = marksPart.replace(/[AMRN]\d+/g, "").replace(/[\(\),;]/g, "").trim();
    if (marksPartStripped.length === 0) {
      // This is a valid end-of-line mark construct.
      return {
        mark: marksPartTokens.join(""),
        requirementPart: requirementPart
      };
    }
  }

  return null;
}

function msaTrimBlock_(s) {
  s = String(s || "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function msaAssignIds_(points) {
  // stable-ish id scheme: p{page}_{index}_{part}_{mark}[_{k}]
  const counters = {};
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const key = ["p" + msaPad2_(pt.page), pt.part || "x", pt.mark || "X", pt.branch || ""].join("_");
    counters[key] = (counters[key] || 0) + 1;
    const n = counters[key];

    let id = "p" + msaPad2_(pt.page) + "_" + msaPad2_(i + 1) + "_" + (pt.part || "x") + "_" + (pt.mark || "X");
    if (pt.branch) id += "_" + pt.branch;
    if (n > 1) id += "_" + n;

    pt.id = id;
  }
  return points;
}
