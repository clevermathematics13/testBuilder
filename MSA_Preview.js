/*******************
 * MSA_Preview.js
 * 
 * Generates a self-contained HTML file with rendered LaTeX for previewing.
 *******************/

/**
 * Builds a complete HTML document for previewing the OCR output with rendered LaTeX.
 * @param {string} title The title of the source document.
 * @param {string} docId The ID of the source document.
 * @param {Array<Object>} ocrPages The array of OCR page objects from Mathpix.
 * @returns {string} A string containing the full HTML for the preview file.
 */
function msaBuildPreviewHtml_(title, docId, ocrPages) {
  // Combine the 'latex_styled' content from all pages. This contains the LaTeX markup.
  const content = ocrPages.map(p => {
    // Find the best content for rendering. Prefer latex_styled, but fall back to text,
    // as sometimes latex_styled can be empty even if text has the correct markup.
    let renderableContent = null;
    if (p.latex_styled && (p.latex_styled.includes('\\(') || p.latex_styled.includes('\\['))) {
      renderableContent = p.latex_styled;
    } else if (p.text && (p.text.includes('\\(') || p.text.includes('\\['))) {
      renderableContent = p.text;
    }

    if (renderableContent) {
      // Sanitize the text first, then build the structured two-column HTML.
      const sanitized = _sanitizeForMathJax_(renderableContent);
      return _buildStructuredHtmlFromText_(sanitized);
    }

    // If no renderable content was found, fall back to displaying the raw text in a formatted block.
    const rawText = p.text || p.latex_styled || ''; // Prefer .text as it seems more reliable
    const escapedText = rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
      <div style="background-color: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; border-radius: 5px; margin-bottom: 1em; font-family: monospace;">
        <p style="margin-top: 0; font-weight: bold; font-size: 0.9em; color: #6c757d; font-family: sans-serif;">NOTE: Math rendering is not available for this content. Displaying raw text.</p>
        <pre style="white-space: pre-wrap; word-wrap: break-word; margin: 0;"><code>${escapedText}</code></pre>
      </div>`;
  }).join('<hr style="border-top: 1px dashed #ccc;">');
  // HTML template that includes the MathJax library to render LaTeX.
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Preview: ${title}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>
    // Configure MathJax
    MathJax = {
      tex: {
        // Use only LaTeX-native delimiters and correctly escape them for the JS string.
        inlineMath: [['\\\\(', '\\\\)']],
        displayMath: [['\\\\[', '\\\\]']],
        processEscapes: true
      },
      svg: {
        fontCache: 'global',
        displayAlign: 'left',
        displayIndent: '2em'
      }
    };
  </script>
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f0f0f0; display: flex; justify-content: center; }
    .page-container { background-color: #fff; padding: 40px; margin: 20px; max-width: 950px; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    hr { margin: 2em 0; }
    .row {
      display: grid;
      grid-template-columns: 40px 1fr 90px; /* primary-part | main-content | marks */
      column-gap: 18px;
      align-items: start;
      margin: 8px 0;
    }
    .row--new-part { margin-top: 1.8em; }
    .primary-part-label { text-align: left; }
    .main { font-size: 15px; }
    .secondary-part-label { display: inline-block; width: 45px; }
    .mark { text-align: right; white-space: nowrap; color: #333; }
    .mark .paren { font-style: italic; }
    .mark .plain { font-style: normal; }
    .row--heading .main { font-weight: 700; margin-top: 1em; }
    .row--displaymath .mark { align-self: center; }
    .row--equalsline .main { padding-left: 2.2em; }
    .note-box { border: 1px solid #333; padding: 10px 12px; margin: 10px 0 12px 0; font-size: 0.95em; }
    mjx-container[display="true"] { margin: 0.3em 0 !important; }
  </style>
</head>
<body>
  <div class="page-container">
    <h3>${title}</h3>
    <hr>
    ${content}
  </div>
</body>
</html>`;
  return html.trim();
}

/**
 * Sanitizes a string containing mixed text and LaTeX to fix common OCR errors
 * before it is rendered by MathJax.
 * @param {string} text The raw string from the OCR service.
 * @returns {string} The sanitized string, ready for rendering.
 */
function _sanitizeForMathJax_(text) {
  if (!text) return "";
  let sanitized = text;

  // Fix 3: "fake commands” like \A1 or \METHOD by removing the leading backslash.
  // This prevents MathJax from interpreting them as invalid LaTeX commands.
  sanitized = sanitized.replace(/\\(A\d+|M\d+|R\d+|N\d+|AG)\b/g, '$1');
  sanitized = sanitized.replace(/\\(METHOD|NOTE|EITHER|OR|THEN)\b/g, '$1');

  // Force sum limits to appear above/below even in inline math.
  sanitized = sanitized.replace(/(\\sum)(?!\\limits)/g, '$1\\limits');

  return sanitized;
}

/**
 * Parses a block of sanitized text into a two-column HTML structure.
 * @param {string} text The sanitized text for one page.
 * @returns {string} The generated HTML rows for the page.
 */
function _buildStructuredHtmlFromText_(text) {
  if (!text) return "";

  // Phase 1: Tokenize safely by extracting display math first.
  const displayMathRegex = /(\\\[[\s\S]*?\\\])/g;
  const displayMathBlocks = [];
  const textWithPlaceholders = text.replace(displayMathRegex, (match) => {
    displayMathBlocks.push(match);
    return `\n@@MJX_BLOCK_${displayMathBlocks.length - 1}@@\n`;
  });

  let allTokens = [];
  textWithPlaceholders.split(/\r?\n/).forEach(line => {
    if (line.trim() !== '') allTokens.push(line.trim());
  });

  // Phase 2: Build a structured row model using "attach backward" logic.
  const rows = [];
  const markRegex = /(\(\s*\b[AMRGN]\d+\b\s*\)|\b[AMRGN]\d+\b|\[\s*(?:Total\s*)?\d+\s*marks?\s*\]|AG|\(AG\))/g;
  const isMarkOnly = (line) => {
    if (!line) return false;
    const marks = line.match(markRegex);
    if (!marks) return false;
    const stripped = line.replace(markRegex, '').replace(/[\s,;()]/g, '');
    return stripped === '';
  };

  for (let i = 0; i < allTokens.length; i++) {
    const line = allTokens[i];

    // A) Handle METHOD headings by creating a dedicated row.
    const methodMatch = line.match(/^METHOD\s+(\d+)$/i);
    if (methodMatch) {
      rows.push({
        main: `METHOD ${methodMatch[1]}`,
        marks: [],
        primaryPart: '',
        secondaryPart: '&nbsp;', // Use a non-breaking space to force indent span
        type: 'heading',
        isMarkable: false
      });
      continue;
    }

    // B) Handle mark-only lines by attaching them to the previous markable row.
    if (isMarkOnly(line)) {
      const marks = line.match(markRegex) || [];
      let lastMarkableRow = null;
      for (let j = rows.length - 1; j >= 0; j--) {
        if (rows[j].isMarkable) { lastMarkableRow = rows[j]; break; }
      }
      if (lastMarkableRow) lastMarkableRow.marks.push(...marks);
      continue;
    }

    // C) Handle multi-line Note boxes.
    if (/^Note:/i.test(line)) {
      let noteContent = [line];
      while (i + 1 < allTokens.length) {
        const nextLine = allTokens[i + 1];
        if (/^\s*\(?[a-z]\)/i.test(nextLine) || /^METHOD/i.test(nextLine) || isMarkOnly(nextLine)) break;
        i++;
        noteContent.push(allTokens[i]);
      }
      rows.push({
        main: `<div class="note-box">${noteContent.join('<br>')}</div>`,
        marks: [],
        partLabels: [],
        type: 'note',
        isMarkable: true
      });
      continue;
    }

    // D) Handle all other content lines.
    let main = line;
    let currentMarks = [];
    let primaryPart = '';
    let secondaryPart = '';
    let isNewMainPart = false;

    // Extract primary part label, e.g., (a), (b)
    const primaryPartRegex = /^\s*(\(\s*[a-z]\s*\))/i;
    const primaryMatch = main.match(primaryPartRegex);
    if (primaryMatch) {
      primaryPart = primaryMatch[1];
      main = main.substring(primaryMatch[0].length).trim();
      if (primaryPart && /^\([b-z]\)$/i.test(primaryPart)) {
        isNewMainPart = true;
      }
    }

    // Extract secondary part label from the remaining text, e.g., (i), (ii)
    const secondaryPartRegex = /^\s*(\(\s*[ivx]+\s*\))/i;
    const secondaryMatch = main.match(secondaryPartRegex);
    if (secondaryMatch) {
      secondaryPart = secondaryMatch[1];
      main = main.substring(secondaryMatch[0].length).trim();
    }

    // If no primary part was found on this line, but a secondary one was,
    // it implies we are continuing the previous primary part.
    if (!primaryPart && secondaryPart) {
      // This space is intentional to keep the main content aligned.
      primaryPart = '&nbsp;';
    }

    // Extract any marks from the line itself.
    main = main.replace(markRegex, (match) => {
      currentMarks.push(match.trim());
      return '';
    }).trim();

    const newRow = {
      main: main,
      marks: currentMarks,
      primaryPart: primaryPart,
      secondaryPart: secondaryPart,
      type: 'text',
      isMarkable: true,
      isNewMainPart: isNewMainPart
    };

    // Re-substitute display math placeholders.
    if (/^@@MJX_BLOCK_\d+@@$/.test(main)) {
      const blockIndex = parseInt(main.match(/@@MJX_BLOCK_(\d+)@@/)[1], 10);
      newRow.main = displayMathBlocks[blockIndex];
      newRow.type = 'display-math';
      if (newRow.main.trim().startsWith('\\[=')) newRow.type = 'equals-line';
    }

    rows.push(newRow);
  }

  // Phase 3: Render the final HTML from the structured row model.
  return rows.map(row => {
    let rowClasses = ['row'];
    if (row.isNewMainPart) { rowClasses.push('row--new-part'); }
    if (row.type === 'heading') { rowClasses.push('row--heading'); }
    if (row.type === 'display-math' || row.type === 'equals-line') { rowClasses.push('row--displaymath'); }
    if (row.type === 'equals-line') { rowClasses.push('row--equalsline'); }
    if (row.type === 'note') { rowClasses.push('row--note'); }

    const primaryPartDiv = `<div class="primary-part-label">${row.primaryPart || ''}</div>`;

    const marksHtml = row.marks.map(m => {
      const type = m.startsWith('(') ? 'paren' : 'plain';
      return `<div><span class="${type}">${m}</span></div>`;
    }).join('');
    const marksDiv = `<div class="mark">${marksHtml}</div>`;

    const secondaryPartSpan = row.secondaryPart ? `<span class="secondary-part-label">${row.secondaryPart}</span>` : '';
    const mainContentDiv = `<div class="main">${secondaryPartSpan}${row.main}</div>`;

    return `<div class="${rowClasses.join(' ')}">${primaryPartDiv}${mainContentDiv}${marksDiv}</div>`;
  }).join('');
}