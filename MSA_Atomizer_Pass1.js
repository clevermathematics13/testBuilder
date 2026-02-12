/***********************
 * MSA_Atomizer_Pass1.gs (updated)
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
  let lastLetterPart = "unknown"; // 🟢 NEW: State for the last primary part, e.g., 'a'
  let branch = null;

  let buffer = [];
  let lastPoint = null;

  const points = [];

  for (let i = 0; i < lines.length; i++) {
    let line = String(lines[i] || "");

    // Part detector: (a), (b), etc.
    // This regex now captures combinations of part markers, allowing for spaces between them, e.g., "(a) (i)"
    const mPart = line.match(/^\s*((?:\(\s*[a-z]\s*\)|\(\s*[ivx]+\s*\)\s*)+)/i);
    if (mPart) {
      // Rule C & D: Before changing part, flush buffer of notes/meta to the last point.
      if (buffer.length > 0 && lastPoint) {
        const notesAndMeta = [];
        const remainingBuffer = [];
        buffer.forEach(l => {
          // Identify notes, "Accept", "Award", or "[x marks]" lines.
          if (/^\s*(Note:|Accept|Award|\[\s*\d+\s*marks?\s*\]|Total)/i.test(l)) {
            notesAndMeta.push(l.trim());
          } else {
            remainingBuffer.push(l);
          }
        });

        if (notesAndMeta.length > 0) {
          lastPoint.notes = (lastPoint.notes || []).concat(notesAndMeta);
        }
        if (remainingBuffer.length > 0) {
          warnings.push(`Pass1: Dangling requirement text found before new part: "${remainingBuffer.join(' ')}"`);
        }
      }
      buffer = []; // Always clear buffer on part change to prevent bleed.

      let newPart;
      const rawPart = mPart[1].replace(/[\s\(\)]/g, "").toLowerCase();

      // If the part is purely roman numerals (i, ii, v), it's a sub-part.
      if (/^[ivx]+$/.test(rawPart)) {
        // This is a sub-part like (ii) without a letter.
        newPart = lastLetterPart + rawPart;
      } else {
        // This is a primary part like (a) or (a)(i)
        newPart = rawPart;
        const primaryLetterMatch = rawPart.match(/^[a-z]/);
        if (primaryLetterMatch) lastLetterPart = primaryLetterMatch[0];
      }
      part = newPart;
      branch = null; // Unconditionally reset branch on any new part.
      // Strip the part marker from the line so it's not duplicated in the requirement,
      // but allow the rest of the line to be processed for marks.
      line = line.substring(mPart[0].length).trim();
    }

    // Branch markers
    if (/^\s*EITHER\s*$/i.test(line)) { branch = "EITHER"; buffer = []; continue; }
    if (/^\s*OR\s*$/i.test(line))     { branch = "OR";     buffer = []; continue; }
    if (/^\s*THEN\s*$/i.test(line))   { branch = "THEN";   continue; }
    const mMethod = line.match(/^\s*METHOD\s+(\d+)\s*$/i);
    if (mMethod) {
      // When a new method starts, it's a distinct branch.
      branch = "METHOD" + mMethod[1];
      buffer = []; // Clear buffer for the new method's context.
      continue;
    }

    // Mark-tag line?
    const markInfo = msaDetectMarkTag_(line);
    if (markInfo) {
      // Rule A & B: Handle "orphan" marks by attaching them to the previous point.
      const isOrphan = !markInfo.requirementPart && buffer.length === 0;
      if (isOrphan && lastPoint && lastPoint.part === part && lastPoint.branch === branch && (i - lastPoint.source_line_index) < 4) {
        // This is an orphan mark that should be attached.
        // Combine marks (e.g., "M1" + "A1" -> "M1A1") for Pass 2 to handle.
        lastPoint.mark += markInfo.mark;
        lastPoint.mark = msaNormalizeMarkToken_(lastPoint.mark);
        lastPoint.source_line_index = i; // Update line index to the latest mark
        continue; // Done with this line, move to the next.
      }

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

      // Post-process the requirement to extract any leading note lines.
      // This prevents "Note:" text from being part of the core requirement.
      const reqLines = (pt.requirement || "").split('\n');
      const finalReqLines = [];
      let isStrippingNotes = true;
      for (let k = 0; k < reqLines.length; k++) {
        const currentLine = reqLines[k];
        // Only strip a contiguous block of notes from the beginning.
        if (isStrippingNotes && /^\s*(Note:|Accept|Award)/i.test(currentLine)) {
          pt.notes.push(currentLine.trim());
        } else {
          isStrippingNotes = false; // Stop stripping after the first non-note line.
          finalReqLines.push(currentLine);
        }
      }
      pt.requirement = finalReqLines.join('\n').trim();

      // The guard below was removed because it was too aggressive. It correctly ignored simple marks
      // with empty requirements, but it also incorrectly dropped valid marks that appeared on their
      // own line (e.g., two consecutive "A1" lines). It is better to extract the point, even if its
      // requirement is empty, and allow the scoring function to penalize its low structure score.
      // if (!pt.requirement && !msaIsCompoundMark_(pt.mark)) {
      //   continue;
      // }

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

/**
 * Normalizes a mark token by removing parentheses, whitespace, and commas.
 * e.g., "(A1, A1)" -> "A1A1"
 * @param {string} mark The raw mark string.
 * @returns {string} The normalized mark string.
 */
function msaNormalizeMarkToken_(mark) {
  let s = (mark == null) ? "" : String(mark).trim();
  if (s.startsWith("(") && s.endsWith(")")) {
    s = s.substring(1, s.length - 1).trim();
  }
  return s.replace(/[\s,;]+/g, "");
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

/**
 * Helper to check if a mark string is compound (e.g., "A1A1", "M1A1").
 */
function msaIsCompoundMark_(mark) {
  // Re-uses the same logic as the Pass 2 splitter.
  const tokens = String(mark || "").match(/[AMRN]\d+/g);
  return tokens && tokens.length > 1;
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
