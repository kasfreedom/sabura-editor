/**
 * Sabura File Packer: Single-file HTML packaging, canonical seam embedding, and save/download coordinator.
 */

import { canonicalJson, validateDocument } from '../core/document.js';

export const DOCUMENT_SEAM_ID = 'sabura-document';
export const DOCUMENT_SCRIPT_REGEX = new RegExp('<script\\s+type=["\']application\\/json["\']\\s+id=["\']sabura-document["\']>([\\s\\S]*?)<\\/' + 'script>', 'i');

/**
 * Extracts and validates the embedded Sabura document from an HTML string.
 * @param {string} htmlContent 
 * @returns {{ valid: boolean, document: Object | null, errors: string[] }}
 */
export function extractDocumentFromHtml(htmlContent) {
  if (typeof htmlContent !== 'string') {
    return { valid: false, document: null, errors: ['HTML content must be a string'] };
  }

  const match = htmlContent.match(DOCUMENT_SCRIPT_REGEX);
  if (!match) {
    return { valid: false, document: null, errors: ['No <script id="sabura-document"> tag found in HTML'] };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    return { valid: false, document: null, errors: [`JSON parse error in document seam: ${err.message}`] };
  }

  const validation = validateDocument(parsed);
  if (!validation.valid) {
    return { valid: false, document: parsed, errors: validation.errors };
  }

  return { valid: true, document: parsed, errors: [] };
}

/**
 * Packages a document into an HTML shell by replacing ONLY the canonical document seam.
 * 
 * @param {string} htmlShell - The full HTML template or current document HTML
 * @param {Object} doc - The validated Sabura document
 * @returns {{ success: boolean, html: string, error?: string }}
 */
export function packageHtmlWithDocument(htmlShell, doc) {
  const validation = validateDocument(doc);
  if (!validation.valid) {
    return {
      success: false,
      html: '',
      error: `Cannot package invalid document: ${validation.errors.join(', ')}`
    };
  }

  const serialized = canonicalJson(doc);
  const seamReplacement = '<script type="application/json" id="' + DOCUMENT_SEAM_ID + '">\n' + serialized + '\n<' + '/script>';

  if (!DOCUMENT_SCRIPT_REGEX.test(htmlShell)) {
    return {
      success: false,
      html: '',
      error: 'Base HTML template missing sabura-document seam'
    };
  }

  const updatedHtml = htmlShell.replace(DOCUMENT_SCRIPT_REGEX, seamReplacement);
  return {
    success: true,
    html: updatedHtml
  };
}

/**
 * Initiates a browser download for a self-contained HTML file.
 * 
 * @param {string} filename 
 * @param {string} htmlContent 
 */
export function triggerFileDownload(filename, htmlContent) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('triggerFileDownload can only be called in a browser environment');
  }

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}
