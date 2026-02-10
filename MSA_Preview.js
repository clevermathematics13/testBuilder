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
    .page-container { background-color: #fff; padding: 40px; margin: 20px; max-width: 800px; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    hr { margin: 2em 0; }
    .row { display: flex; align-items: flex-start; margin-bottom: 0.75em; }
    .main { flex: 1; padding-right: 15px; }
    .mark { width: 90px; text-align: right; color: #333; flex-shrink: 0; padding-left: 14px; }
    .mark .paren { font-style: italic; }
    .mark .plain { font-style: normal; }
    .method-heading { font-weight: bold; margin-top: 1em; }
    .note-box {
      border: 1px solid #aaa;
      padding: 10px 12px;
      margin: 10px 0 12px 0;
      font-size: 0.9em;
      border-radius: 4px;
      background-color: #f9f9f9;
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

  // Regex to find display math blocks and keep them as delimiters for splitting.
  const displayMathRegex = /(\\\[[\s\S]*?\\\])/g;
  const chunks = text.split(displayMathRegex);

  const htmlRows = [];
  const markRegex = /(\(\s*\b[AMRGN]\d+\b\s*\)|\b[AMRGN]\d+\b|\[\s*(?:Total\s*)?\d+\s*marks?\s*\])/g;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk || chunk.trim() === '') continue;

    // Is this chunk a display math block?
    if (chunk.startsWith('\\[') && chunk.endsWith('\\]')) {
      let mainContent = chunk;
      // Look ahead for "equals line" alignment
      const nextTextChunk = chunks[i + 1] ? chunks[i + 1].trim() : '';
      const nextMathChunk = chunks[i + 2];
      if (nextTextChunk === '' && nextMathChunk && nextMathChunk.startsWith('\\[=')) {
        // Found a subsequent equals line. Merge them into an 'aligned' environment.
        const firstEq = chunk.slice(2, -2).trim(); // content of first \[...\]
        const secondEq = nextMathChunk.slice(2, -2).trim(); // content of second \[...\]
        mainContent = `\\[\\begin{aligned}${firstEq} \\\\\\\\ ${secondEq}\\end{aligned}\\]`;
        i += 2; // Skip the next two chunks since we've consumed them.
      }

      const rowHtml = `<div class="row"><div class="main">${mainContent}</div><div class="mark"></div></div>`;
      htmlRows.push(rowHtml);
    } else {
      // This is a normal text chunk. Process it line by line.
      const preNormalized = chunk.replace(/\b(METHOD\s+\d+)\b/g, '\n$1\n');
      const lines = preNormalized.split(/\r?\n/);

      for (let j = 0; j < lines.length; j++) {
        let line = lines[j];
        if (line.trim() === '') continue;

        // Handle Note boxes
        if (/^Note:/i.test(line.trim())) {
          let noteContent = [line.trim()];
          // Consume subsequent lines of the note until a blank line or new part/method.
          while (j + 1 < lines.length && lines[j + 1].trim() !== '' && !/^\s*\(?[a-z]\)/i.test(lines[j + 1]) && !/^METHOD/i.test(lines[j + 1])) {
            j++;
            noteContent.push(lines[j].trim());
          }
          const noteHtml = `<div class="row"><div class="main"><div class="note-box">${noteContent.join('<br>')}</div></div><div class="mark"></div></div>`;
          htmlRows.push(noteHtml);
          continue;
        }

        let main = line;
        const marks = [];

        // Extract all mark tags from the line into the 'marks' array.
        main = main.replace(markRegex, (match) => {
          const trimmedMatch = match.trim();
          marks.push({
            text: trimmedMatch,
            type: trimmedMatch.startsWith('(') ? 'paren' : 'plain'
          });
          return ''; // Remove the mark from the main content.
        }).trim();

        if (main || marks.length > 0) {
          let mainClasses = ['main'];
          if (/^METHOD\s+\d+$/i.test(main)) { mainClasses.push('method-heading'); }

          const marksHtml = marks.map(m => `<div><span class="${m.type}">${m.text}</span></div>`).join('');
          const rowHtml = `<div class="row"><div class="${mainClasses.join(' ')}">${main}</div><div class="mark">${marksHtml}</div></div>`;
          htmlRows.push(rowHtml);
        }
      }
    }
  }

  return htmlRows.join('');
}