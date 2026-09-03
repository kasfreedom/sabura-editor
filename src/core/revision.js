/**
 * Sabura Revision Tracking and Content Integrity.
 *
 * Implements offline, deterministic document revision tracking, canonical content digest
 * computation (SHA-256), and safe revision transitions.
 */

export const REVISION_EXTENSION_KEY = 'ext:sabura:revision';
export const REVISION_ALLOWED_FIELDS = new Set([
  'version',
  'revisionId',
  'parentId',
  'contentDigest'
]);

/**
 * Standard pure-JS bitwise SHA-256 implementation (FIPS 180-4 compliant).
 * Runs synchronously offline with zero external dependencies in both Node.js and browser.
 *
 * @param {string} ascii - UTF-8 encoded binary string
 * @returns {string} 64-character hexadecimal digest
 */
function sha256Raw(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;
  let result = '';
  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  const hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = candidate * candidate; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';

  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }

  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0);
      const temp2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/**
 * Computes the SHA-256 hash of a UTF-8 string.
 *
 * @param {string} str
 * @returns {string} 64-character lowercase hex string
 */
export function computeSha256(str) {
  if (typeof str !== 'string') str = String(str || '');
  const utf8 = unescape(encodeURIComponent(str));
  return sha256Raw(utf8);
}

const REVISION_HEX_REGEX = /^[0-9a-f]{12,}$/;
const CONTENT_DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;

/**
 * Computes a cryptographically strong random revision ID.
 * Returns a 32-character lowercase hex string.
 * Fails safely if secure entropy is unavailable.
 *
 * @returns {string}
 */
export function generateRevisionId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure entropy source (crypto.getRandomValues) is required to generate revision IDs');
}

/**
 * Returns a short revision suffix of at least 12 hex characters for proposed filenames.
 *
 * @param {string} revisionId
 * @returns {string}
 */
export function getShortRevisionId(revisionId) {
  const safeId = String(revisionId || '').trim();
  if (safeId.length >= 12) return safeId.slice(0, 12);
  return safeId.padEnd(12, '0');
}

let defaultNormalizeFn = null;

export function setDefaultNormalizeFn(fn) {
  defaultNormalizeFn = fn;
}

/**
 * Computes the canonical content digest for a document, strictly excluding the revision metadata.
 * Includes all persisted document fields (schemaVersion, id, title, theme, objects, order, groups, assets)
 * and all unrelated ext:* extension properties.
 * Normalizes the content representation when a normalizeFn is provided to ensure consistent
 * digest evaluation across minimally specified and fully populated documents.
 *
 * @param {Object} doc
 * @param {(val: any) => string} canonicalJsonFn
 * @param {((doc: any) => any)} [normalizeFn]
 * @returns {string} Format: "sha256:<64-hex-chars>"
 */
export function computeContentDigest(doc, canonicalJsonFn, normalizeFn = defaultNormalizeFn) {
  if (!doc || typeof doc !== 'object') return '';
  // Shallow copy top-level keys to exclude the revision extension without mutating doc
  const copy = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k !== REVISION_EXTENSION_KEY) {
      copy[k] = v;
    }
  }
  const norm = normalizeFn || defaultNormalizeFn;
  const toHash = typeof norm === 'function' ? norm(JSON.parse(JSON.stringify(copy))) : copy;
  const json = canonicalJsonFn(toHash);
  return 'sha256:' + computeSha256(json);
}

/**
 * Validates the structure and content digest of a document's revision metadata.
 * Returns { valid: true, errors: [] } for legacy documents without revision metadata.
 * Rejects unknown fields, malformed values, self-parenting, or stale digests where content was changed
 * without updating the revision record.
 *
 * @param {Object} doc
 * @param {(val: any) => string} [canonicalJsonFn]
 * @param {((doc: any) => any)} [normalizeFn]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRevisionMetadata(doc, canonicalJsonFn = null, normalizeFn = defaultNormalizeFn) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['Document must be an object'] };
  }

  // Absent metadata is valid legacy document
  if (doc[REVISION_EXTENSION_KEY] === undefined) {
    return { valid: true, errors: [] };
  }

  const rev = doc[REVISION_EXTENSION_KEY];
  // Present but null or non-object is malformed
  if (rev === null || typeof rev !== 'object' || Array.isArray(rev)) {
    return { valid: false, errors: [`"${REVISION_EXTENSION_KEY}" must be an object`] };
  }

  for (const key of Object.keys(rev)) {
    if (!REVISION_ALLOWED_FIELDS.has(key)) {
      errors.push(`Unknown property "${key}" in "${REVISION_EXTENSION_KEY}"`);
    }
  }

  if (rev.version !== 1) {
    errors.push(`"${REVISION_EXTENSION_KEY}".version must be 1`);
  }

  if (typeof rev.revisionId !== 'string' || !REVISION_HEX_REGEX.test(rev.revisionId)) {
    errors.push(`"${REVISION_EXTENSION_KEY}".revisionId must be a lowercase hex string of at least 12 characters`);
  }

  if (rev.parentId !== null) {
    if (typeof rev.parentId !== 'string' || !REVISION_HEX_REGEX.test(rev.parentId)) {
      errors.push(`"${REVISION_EXTENSION_KEY}".parentId must be null or a lowercase hex string of at least 12 characters`);
    } else if (rev.parentId === rev.revisionId) {
      errors.push(`"${REVISION_EXTENSION_KEY}".parentId cannot be identical to revisionId (revision cannot be its own parent)`);
    }
  }

  if (typeof rev.contentDigest !== 'string' || !CONTENT_DIGEST_REGEX.test(rev.contentDigest)) {
    errors.push(`"${REVISION_EXTENSION_KEY}".contentDigest must be in the format "sha256:<64-hex-chars>"`);
  }

  if (errors.length === 0 && typeof canonicalJsonFn === 'function') {
    const expectedDigest = computeContentDigest(doc, canonicalJsonFn, normalizeFn);
    if (rev.contentDigest !== expectedDigest) {
      errors.push('Stale or mismatched revision metadata: contentDigest does not match canonical document content');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Determines the next revision record and snapshot for a save operation.
 *
 * Rules:
 * 1. If baseline exists and current contentDigest equals baseline.contentDigest:
 *    retains the baseline revision record unchanged (no self-parent, no new revision).
 * 2. If content differs (or no baseline exists):
 *    generates a new revision ID using secure entropy, parents to baseline?.revisionId || null,
 *    and computes new digest.
 *
 * @param {Object} currentDoc
 * @param {Object | null} baseline - The session export baseline { revisionId, parentId, contentDigest }
 * @param {(val: any) => string} canonicalJsonFn
 * @param {{ idGenerator?: () => string, normalizeFn?: (doc: any) => any }} [options]
 * @returns {{ changed: boolean, revisionRecord: { version: number, revisionId: string, parentId: string | null, contentDigest: string } }}
 */
export function transitionRevision(currentDoc, baseline, canonicalJsonFn, options = {}) {
  const normalizeFn = options.normalizeFn || null;
  const currentDigest = computeContentDigest(currentDoc, canonicalJsonFn, normalizeFn);

  if (baseline && baseline.contentDigest === currentDigest && baseline.revisionId) {
    return {
      changed: false,
      revisionRecord: {
        version: 1,
        revisionId: baseline.revisionId,
        parentId: baseline.parentId,
        contentDigest: currentDigest
      }
    };
  }

  const idGen = options.idGenerator || generateRevisionId;
  const newRevId = idGen();
  const parentId = baseline?.revisionId || null;

  return {
    changed: true,
    revisionRecord: {
      version: 1,
      revisionId: newRevId,
      parentId,
      contentDigest: currentDigest
    }
  };
}
