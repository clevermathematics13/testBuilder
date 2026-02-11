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
        inlineMath: [['\\(', '\\)']],
        displayMath: [['\\[', '\\]']],
        processEscapes: true
      },
      svg: {
        fontCache: 'global'
      }
    };
  </script>
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f0f0f0; display: flex; justify-content: center; }
    .page-container { background-color: #fff; padding: 40px; margin: 20px; max-width: 800px; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    hr { margin: 2em 0; }
    .row { display: flex; align-items: flex-start; margin-bottom: 0.5em; }
    .main { flex: 1; padding-right: 15px; }
    .mark { width: 100px; text-align: right; color: #555; font-style: italic; flex-shrink: 0; }
    .method-heading { font-weight: bold; margin-top: 1em; }
    .note-text { font-style: italic; font-size: 0.9em; }
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

  // Fix 2: Replace lone backslashes (often used as separators by OCR) with HTML line breaks.
  // Handles ` \ ` between words.
  sanitized = sanitized.replace(/ \s*\\ \s*/g, ' <br> ');
  // Handles ` \` at the end of a line. The 'm' flag is for multiline matching.
  sanitized = sanitized.replace(/ \s*\\\s*$/gm, '<br>');

  return sanitized;
}

/**
 * Parses a block of sanitized text into a two-column HTML structure.
 * @param {string} text The sanitized text for one page.
 * @returns {string} The generated HTML rows for the page.
 */
function _buildStructuredHtmlFromText_(text) {
  if (!text) return "";

  // Phase 1: Tokenize into a flat list of lines and display math blocks
  const displayMathRegex = /(\\\[[\s\S]*?\\\])/g;
  const textAndMathChunks = text.split(displayMathRegex);
  let allTokens = [];
  textAndMathChunks.forEach(chunk => {
    if (!chunk || chunk.trim() === '') return;
    if (chunk.startsWith('\\[') && chunk.endsWith('\\]')) {
      allTokens.push({ type: 'display-math', content: chunk });
    } else {
      const lines = chunk.split(/\r?\n/);
      lines.forEach(line => {
        if (line.trim() !== '') { // Only push non-empty lines
          allTokens.push({ type: 'text-line', content: line.trim() });
        }
      });
    }
  });

  // Phase 2: Build rows using the "attach backward" logic
  const rows = [];
  const markRegex = /(\(\s*\b[AMRGN]\d+\b\s*\)|\b[AMRGN]\d+\b|\[\s*(?:Total\s*)?\d+\s*marks?\s*\]|AG|\(AG\))/g;
  const isMarkOnly = (line) => {
    if (!line) return false;
    const marks = line.match(markRegex);
    if (!marks) return false;
    // Check if the line *only* contains marks and separators
    const stripped = line.replace(markRegex, '').replace(/[\s,;()]/g, '');
    return stripped === '';
  };

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];
    const content = token.content;

    // A) Handle mark-only tokens by attaching them backward
    if (token.type === 'text-line' && isMarkOnly(content)) {
      const marks = content.match(markRegex) || [];
      let lastMarkableRow = null;
      for (let j = rows.length - 1; j >= 0; j--) {
        if (rows[j].isMarkable) {
          lastMarkableRow = rows[j];
          break;
        }
      }
      if (lastMarkableRow) {
        lastMarkableRow.marks.push(...marks);
      }
      // If no previous markable row, these marks are effectively dropped.
      continue;
    }

    // B) Handle multi-line Note boxes
    if (token.type === 'text-line' && /^Note:/i.test(content)) {
      let noteContent = [content];
      // Consume subsequent text-line tokens for the note
      while (i + 1 < allTokens.length && allTokens[i + 1].type === 'text-line') {
        const nextLine = allTokens[i + 1].content;
        // Stop if the next line is a new part, a method, or a mark-only line
        if (/^\s*\(?[a-z]\)/i.test(nextLine) || /^METHOD/i.test(nextLine) || isMarkOnly(nextLine)) {
          break;
        }
        i++; // Consume the token
        noteContent.push(allTokens[i].content);
      }
      rows.push({
        main: `<div class="note-box">${noteContent.join('<br>')}</div>`,
        marks: [],
        type: 'note',
        isMarkable: true // Notes can have marks attached to them
      });
      continue;
    }

    // C) Handle content tokens
    let main = content;
    let currentMarks = [];

    if (token.type === 'text-line') {
      main = main.replace(markRegex, (match) => {
        currentMarks.push(match.trim());
        return '';
      }).trim();
    }
    
    const newRow = { main: main, marks: currentMarks, type: token.type, isMarkable: true };

    if (/^METHOD\s+\d+$/i.test(main)) {
      newRow.type = 'heading';
      newRow.isMarkable = false;
    } else if (token.type === 'display-math' && main.trim().startsWith('\\[=')) {
      newRow.type = 'equals-line';
    }
    
    rows.push(newRow);
  }

  // Phase 3: Render HTML
  return rows.map(row => {
    let rowClasses = ['row'];
    if (row.type === 'heading') { rowClasses.push('row--heading'); }
    if (row.type === 'display-math' || row.type === 'equals-line') { rowClasses.push('row--displaymath'); }
    if (row.type === 'equals-line') { rowClasses.push('row--equalsline'); }
    if (row.type === 'note') { rowClasses.push('row--note'); }

    const marksHtml = row.marks.map(m => {
      const type = m.startsWith('(') ? 'paren' : 'plain';
      return `<div><span class="${type}">${m}</span></div>`;
    }).join('');

    return `<div class="${rowClasses.join(' ')}"><div class="main">${row.main}</div><div class="mark">${marksHtml}</div></div>`;
  }).join('');
}