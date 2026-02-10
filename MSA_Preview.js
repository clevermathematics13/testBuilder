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
      // This content has LaTeX delimiters, so return it for MathJax to process
      // after sanitizing it to fix common OCR and formatting errors.
      return _sanitizeForMathJax_(renderableContent);
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
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']]
      },
      svg: {
        fontCache: 'global'
      }
    };
  </script>
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 20px; color: #212529; }
    hr { margin: 2em 0; }
  </style>
</head>
<body>
  <h3>${title}</h3>
  <hr>
  <div>${content}</div>
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