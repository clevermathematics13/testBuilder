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
      grid-template-columns: 110px 1fr 90px; /* method | main | marks */
      column-gap: 18px;
      align-items: start;
      margin: 8px 0;
    }
    .row--new-part { margin-top: 1.8em; }
    .method-label { font-weight: 700; text-align: left; padding-top: 1px; }
    .main { font-size: 15px; }
    .main .part { margin-right: 25px; }
    .main .subpart { margin-right: 20px; }
    .mark { text-align: right; white-space: nowrap; color: #333; }
    .mark .paren { font-style: italic; }
    .mark .plain { font-style: normal; }
    .row--displaymath .mark { align-self: center; }
    .row--displaymath .method-label { align-self: center; }
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

  let pendingMethod = null;

  for (let i = 0; i < allTokens.length; i++) {
    const line = allTokens[i];

    // A) Handle METHOD headings by setting a pending label.
    const methodMatch = line.match(/^METHOD\s+(\d+)$/i);
    if (methodMatch) {
      pendingMethod = `METHOD ${methodMatch[1]}`;
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
        methodLabel: pendingMethod,
        type: 'note',
        isMarkable: true
      });
      pendingMethod = null;
      continue;
    }

    // D) Handle all other content lines.
    let main = line;
    let currentMarks = [];
    let partLabels = [];
    let isNewMainPart = false;

    // Extract part labels
    const partRegex = /^\s*((?:\(\s*[a-z]\s*\)\s*)+)/i;
    const partMatch = main.match(partRegex);
    if (partMatch) {
      partLabels = partMatch[1].match(/\(.*?\)/g) || [];
      main = main.substring(partMatch[0].length).trim();
      if (partLabels.length > 0 && /^\([b-z]\)$/i.test(partLabels[0])) {
        isNewMainPart = true;
      }
    }

    // Extract any marks from the line itself.
    main = main.replace(markRegex, (match) => {
      currentMarks.push(match.trim());
      return '';
    }).trim();

    const newRow = {
      main: main,
      marks: currentMarks,
      partLabels: partLabels,
      methodLabel: pendingMethod,
      type: 'text',
      isMarkable: true,
      isNewMainPart: isNewMainPart
    };
    pendingMethod = null;

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
    if (row.methodLabel) { rowClasses.push('row--with-method'); }
    if (row.isNewMainPart) { rowClasses.push('row--new-part'); }
    if (row.type === 'display-math' || row.type === 'equals-line') { rowClasses.push('row--displaymath'); }
    if (row.type === 'equals-line') { rowClasses.push('row--equalsline'); }
    if (row.type === 'note') { rowClasses.push('row--note'); }

    const methodLabelHtml = `<div class="method-label">${row.methodLabel || ''}</div>`;

    const partLabelsHtml = (row.partLabels || []).map((label, index) => {
      const className = index === 0 ? 'part' : 'subpart';
      return `<span class="${className}">${label}</span>`;
    }).join('');

    const marksHtml = row.marks.map(m => {
      const type = m.startsWith('(') ? 'paren' : 'plain';
      return `<div><span class="${type}">${m}</span></div>`;
    }).join('');

    const mainContentHtml = `<div class="main">${partLabelsHtml}${row.main}</div>`;

    return `<div class="${rowClasses.join(' ')}">${methodLabelHtml}${mainContentHtml}<div class="mark">${marksHtml}</div></div>`;
  }).join('');
}