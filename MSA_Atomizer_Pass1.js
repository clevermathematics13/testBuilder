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
    const line = String(lines[i] || "");

    // Part detector: (a), (b), etc.
    const mPart = line.match(/^\s*\(\s*([a-z])\s*\)\s*/i);
    if (mPart) {
      part = mPart[1].toLowerCase();
      // keep line content in buffer (it’s often meaningful)
      buffer.push(line);
      continue;
    }

    // Branch markers
    if (/^\s*EITHER\s*$/i.test(line)) { branch = "EITHER"; buffer = []; continue; }
    if (/^\s*OR\s*$/i.test(line))     { branch = "OR";     buffer = []; continue; }
    if (/^\s*THEN\s*$/i.test(line))   { branch = "THEN";   continue; }

    // Mark-tag line?
    const markInfo = msaDetectMarkTag_(line);
    if (markInfo) {
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

      // Post-process requirement to extract any leading/embedded note lines
      const reqLines = (pt.requirement || "").split('\n');
      const finalReqLines = [];
      for (let k = 0; k < reqLines.length; k++) {
        if (/^\s*(Note:|Accept|Award)/i.test(reqLines[k])) {
          pt.notes.push(reqLines[k].trim());
        } else {
          finalReqLines.push(reqLines[k]);
        }
      }
      pt.requirement = finalReqLines.join('\n').trim();

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

  // Handle simple cases first: (AG) or AG
  if (/^\(?\s*AG\s*\)?$/.test(s)) {
    return { mark: "AG" };
  }

  // More complex marks like (M1), A1, A1A1, N2
  // This regex looks for one or more mark tokens on a single line.
  // e.g., "A1", "(M1)", "A1A1", "A1, M1"
  const markTokens = s.match(/\b([AMRN]\d+)\b/g);

  if (!markTokens) {
    return null;
  }

  // If the line contains other text, it's not a mark tag line.
  // This is a heuristic to avoid grabbing marks from inside requirement text.
  // We create a "clean" version of the line with marks and punctuation removed.
  const stripped = s.replace(/\b([AMRN]\d+)\b/g, "").replace(/[\(\),;]/g, "").trim();
  if (stripped.length > 0) {
    return null;
  }

  // Join multiple tokens found, e.g., ["A1", "M1"] -> "A1M1"
  return {
    mark: markTokens.join("")
  };
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
