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
    .page-container { background-color: #fff; padding: 40px; margin: 20px; max-width: 900px; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    hr { margin: 2em 0; }
    .row {
      display: grid;
      grid-template-columns: 1fr 90px;
      column-gap: 18px;
      align-items: start;
      margin: 10px 0;
    }
    .main { font-size: 15px; }
    .mark { text-align: right; white-space: nowrap; color: #333; }
    .mark .paren { font-style: italic; }
    .mark .plain { font-style: normal; }
    .row--heading .main { font-weight: 700; letter-spacing: 0.02em; }
    .row--displaymath .mark { align-self: center; }
    .row--equalsline .main { padding-left: 2.2em; }
    .note-box {
      border: 1px solid #333;
      padding: 10px 12px;
      margin: 10px 0 12px 0;
      font-size: 0.95em;
    }
    mjx-container[display="true"] {
      margin: 0.35em 0 !important;
    }
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

  // Add \limits to \sum to force limits above/below even in inline math.
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

  // Tokenize into a flat list of lines and display math blocks
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
        allTokens.push({ type: 'text-line', content: line.trim() });
      });
    }
  });

  const rows = [];
  const markRegex = /(\(\s*\b[AMRGN]\d+\b\s*\)|\b[AMRGN]\d+\b|\[\s*(?:Total\s*)?\d+\s*marks?\s*\]|AG|\(AG\))/g;
  const isMarkOnly = (line) => {
    if (line.trim() === '') return false;
    const marks = line.match(markRegex);
    if (!marks) return false;
    const stripped = line.replace(markRegex, '').replace(/[\s,;()]/g, '');
    return stripped === '';
  };

  let pendingMarks = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];
    const content = token.content;

    if (content === '') continue;

    // Handle mark-only lines by adding to the buffer and skipping row creation.
    if (token.type === 'text-line' && isMarkOnly(content)) {
      const marks = content.match(markRegex) || [];
      pendingMarks.push(...marks);
      continue;
    }

    // Handle Note boxes
    if (token.type === 'text-line' && /^Note:/i.test(content)) {
      let noteContent = [content];
      while (i + 1 < allTokens.length && allTokens[i + 1].type === 'text-line') {
        const nextLine = allTokens[i + 1].content;
        if (nextLine === '' || /^\s*\(?[a-z]\)/i.test(nextLine) || /^METHOD/i.test(nextLine) || isMarkOnly(nextLine)) {
          break;
        }
        i++;
        noteContent.push(nextLine);
      }
      rows.push({ main: `<div class="note-box">${noteContent.join('<br>')}</div>`, marks: pendingMarks, type: 'note' });
      pendingMarks = [];
      continue;
    }

    // It's a content token. Create a row.
    let main = content;
    let currentMarks = [...pendingMarks];
    pendingMarks = [];

    if (token.type === 'text-line') {
      main = main.replace(markRegex, (match) => {
        currentMarks.push(match.trim());
        return '';
      }).trim();
    }

    if (main === '' && token.type === 'text-line') {
      pendingMarks.push(...currentMarks);
      continue;
    }

    rows.push({ main: main, marks: currentMarks, type: token.type });
  }

  // Attach any trailing marks to the last content row.
  if (pendingMarks.length > 0 && rows.length > 0) {
    let lastContentRowIndex = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].type !== 'note') {
        lastContentRowIndex = i;
        break;
      }
    }
    if (lastContentRowIndex !== -1) {
      rows[lastContentRowIndex].marks.push(...pendingMarks);
    }
  }

  // Render the final HTML
  return rows.map(row => {
    if (row.type === 'note') {
      const marksHtml = row.marks.map(m => `<div><span class="${m.startsWith('(') ? 'paren' : 'plain'}">${m}</span></div>`).join('');
      return `<div class="row">${row.main}<div class="mark">${marksHtml}</div></div>`;
    }

    let rowClasses = ['row'];
    if (/^METHOD\s+\d+$/i.test(row.main)) { rowClasses.push('row--heading'); }
    if (row.type === 'display-math') {
      rowClasses.push('row--displaymath');
      if (row.main.trim().startsWith('\\[=')) {
        rowClasses.push('row--equalsline');
      }
    }

    const marksHtml = row.marks.map(m => {
      const type = m.startsWith('(') ? 'paren' : 'plain';
      return `<div><span class="${type}">${m}</span></div>`;
    }).join('');

    return `<div class="${rowClasses.join(' ')}"><div class="main">${row.main}</div><div class="mark">${marksHtml}</div></div>`;
  }).join('');
}