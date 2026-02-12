/***********************
 * MSA_Atomizer_Pass1.gs (updated)
 ***********************/

function msaAtomizePass1_(pagesOcr, rules, skipMapByPart) {
  msaLog_("PASS1 VERSION: 2026-02-12 lookahead-v1");
  const warnings = [];
  const points = [];

  for (let p = 0; p < pagesOcr.length; p++) {
    const pageNum = p + 1;
    const rawText = (pagesOcr[p] && pagesOcr[p].text) ? pagesOcr[p].text : "";

    // Add logging to inspect raw OCR text
    msaLog_(`Page ${pageNum} rawText length: ${rawText.length}`);
    msaLog_(`Page ${pageNum} rawText tail (300 chars): "...${rawText.slice(-300)}"`);
    const nEqualsLines = rawText.split(/\r?\n/).filter(l => /n\s*=\s*\d+/i.test(l));
    if (nEqualsLines.length > 0) {
        msaLog_(`Page ${pageNum} found lines matching 'n = ...': ${JSON.stringify(nEqualsLines)}`);
    } else {
        msaLog_(`Page ${pageNum} did NOT find any lines matching 'n = ...'`);
    }

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
    msaLog_("PASS1 PARSER VERSION: 2026-02-12 lookahead-v1");
    let part = "unknown";
    let lastLetterPart = "unknown";
    let branch = null;
    let buffer = [];
    let lastPoint = null;
    const points = [];
    let pendingMarks = []; // Holds marks from mark-only lines.

    const flushBuffer = (terminatingMarks = [], lineIndex) => {
        if (buffer.length === 0 && pendingMarks.length > 0 && lastPoint) {
            // Pending marks with no buffer attach to the previous point.
            msaLog_(`Pass1: Attaching pending marks [${pendingMarks.join(',')}] to previous point as no new requirement was found.`);
            lastPoint.marks.push(...pendingMarks);
            pendingMarks = [];
            return;
        }
        if (buffer.length === 0) return;

        let allMarks = [...pendingMarks, ...terminatingMarks];
        if (allMarks.length === 0) {
            warnings.push(`Pass1: Dangling buffer with no mark: "${buffer.join(' ')}"`);
            buffer = [];
            return;
        }

        const pt = {
            page: pageNum,
            part: part,
            branch: branch,
            marks: allMarks,
            requirement: msaTrimBlock_(buffer.join("\n")),
            notes: [],
            source_line_index: lineIndex
        };

        // Post-process to extract notes from the requirement.
        const reqLines = (pt.requirement || "").split('\n');
        const finalReqLines = [];
        let isStrippingNotes = true;
        for (const currentLine of reqLines) {
            if (isStrippingNotes && /^\s*(Note:|Accept|Award|\[\s*\d+\s*marks?\s*\]|Total)/i.test(currentLine)) {
                pt.notes.push(currentLine.trim());
            } else {
                isStrippingNotes = false;
                finalReqLines.push(currentLine);
            }
        }
        pt.requirement = finalReqLines.join('\n').trim();

        if (pt.requirement || pt.marks.length > 1) {
            points.push(pt);
            lastPoint = pt;
        }

        buffer = [];
        pendingMarks = [];
    };

    for (let i = 0; i < lines.length; i++) {
        let line = String(lines[i] || "");

        const mPart = line.match(/^\s*((?:\(\s*[a-z]\s*\)|\(\s*[ivx]+\s*\)\s*)+)/i);
        if (mPart) {
            flushBuffer([], i);
            const rawPart = mPart[1].replace(/[\s\(\)]/g, "").toLowerCase();
            if (/^[ivx]+$/.test(rawPart)) {
                part = lastLetterPart + rawPart;
            } else {
                part = rawPart;
                const primaryLetterMatch = rawPart.match(/^[a-z]/);
                if (primaryLetterMatch) lastLetterPart = primaryLetterMatch[0];
            }
            branch = null;
            line = line.substring(mPart[0].length).trim();
        }

        if (/^\s*EITHER\s*$/i.test(line)) { flushBuffer([], i); branch = "EITHER"; continue; }
        if (/^\s*OR\s*$/i.test(line)) { flushBuffer([], i); branch = "OR"; continue; }
        if (/^\s*THEN\s*$/i.test(line)) { flushBuffer([], i); branch = "THEN"; continue; }
        const mMethod = line.match(/^\s*METHOD\s+(\d+)\s*$/i);
        if (mMethod) {
            flushBuffer([], i);
            branch = "METHOD" + mMethod[1];
            continue;
        }

        const markInfo = msaDetectMarkTag_(line);
        // MARK-ONLY line (no requirementPart)
        if (markInfo && !markInfo.requirementPart) {
            // If we have requirement text in the buffer, this mark terminates it.
            if (buffer.length > 0) {
                msaLog_(`Pass1: Mark-only line [${markInfo.marks.join(',')}] is flushing buffer.`);
                flushBuffer(markInfo.marks, i);
                continue;
            }

            // If no buffer, this is an "orphan" mark. Use lookahead to decide where it belongs.
            let nextLine = "";
            for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                const l = (lines[j] || "").trim();
                if (l) {
                    nextLine = l;
                    break;
                }
            }

            const isNextLineAnswerLike = /^\s*=?\s*([nx]\s*=|=|\d|\\\[|\\\(|S_\d+)/.test(nextLine);
            const isNextLineBoundary = /^\s*(METHOD|EITHER|OR|THEN|\(\s*[a-z]\s*\)|\(\s*[ivx]+\s*\)\s*)/i.test(nextLine);

            // If next line looks like an answer, hold the mark for it.
            if (isNextLineAnswerLike && !isNextLineBoundary) {
                msaLog_(`Pass1: Mark [${markInfo.marks.join(',')}] is PENDING for next line: "${nextLine.slice(0, 30)}"`);
                pendingMarks.push(...markInfo.marks);
                continue;
            }
            // Otherwise, attach to the previous point if it exists.
            else if (lastPoint) {
                msaLog_(`Pass1: Attaching orphan mark(s) [${markInfo.marks.join(',')}] to previous point (no answer-like next line).`);
                lastPoint.marks.push(...markInfo.marks);
                continue;
            }
            // If no previous point and next line isn't an answer, we must hold it.
            else {
                msaLog_(`Pass1: Found pending mark(s) [${markInfo.marks.join(',')}] on line ${i} (no previous point and no answer-like next line).`);
                pendingMarks.push(...markInfo.marks);
                continue;
            }
        }

        if (markInfo && markInfo.requirementPart) {
            buffer.push(markInfo.requirementPart);
            flushBuffer(markInfo.marks, i);
            continue;
        }

        if (line.trim()) {
            buffer.push(line);
        }
    }

    flushBuffer([], lines.length);
    return points;
}

function msaDetectMarkTag_(line) {
  const s = String(line || "").trim();

  // Case 1: Handle simple cases like (AG) or AG
  if (/^\(?\s*AG\s*\)?$/.test(s)) {
    return { marks: ["AG"], requirementPart: null };
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
      marks: markTokens,
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
        marks: markTokens,
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
    const key = ["p" + msaPad2_(pt.page), pt.part || "x", (pt.marks || ["X"]).join(''), pt.branch || ""].join("_");
    counters[key] = (counters[key] || 0) + 1;
    const n = counters[key];

    let id = "p" + msaPad2_(pt.page) + "_" + msaPad2_(i + 1) + "_" + (pt.part || "x") + "_" + ((pt.marks || ["X"]).join(''));
    if (pt.branch) id += "_" + pt.branch;
    if (n > 1) id += "_" + n;

    pt.id = id;
  }
  return points;
}
