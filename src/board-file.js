/**
 * Board files without a browser: create, edit and read Sabura .html boards
 * from plain strings, using the same AgentApi, validator and packer as the
 * editor. Pure: no file system, clock or network. Callers do the I/O.
 *
 * Not part of the browser bundle (scripts/build.js lists its own modules).
 * Used by bin/sabura-board.js and the packaged plugin skill.
 */

import { AgentApi } from './agent-api.js';
import { applyCommandBatch } from './core/commands.js';
import { canonicalJson, createDefaultDocument, normalizeDocument, validateDocument } from './core/document.js';
import { REVISION_EXTENSION_KEY, transitionRevision } from './core/revision.js';
import { extractDocumentFromHtml, packageHtmlWithDocument } from './storage/file-packer.js';

/** A board file or command batch that Sabura refuses. `errors` lists every reason. */
export class BoardFileError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'BoardFileError';
    this.errors = errors;
  }
}

/** The minimum of SaburaApp that AgentApi.apply touches, with no DOM. */
function headlessHost(doc) {
  const host = {
    doc,
    mode: 'editing',
    isCorrupted: false,
    inPresentation: false,
    isSaving: false,
    undoStack: [],
    redoStack: [],
    subscribers: new Set(),
    dispatchCommandBatch(commands) {
      const result = applyCommandBatch(host.doc, commands);
      host.doc = result.doc;
      host.agent.recordDocumentChange();
      return true;
    },
  };
  host.agent = new AgentApi(host);
  return host;
}

function formatAgentError(e) {
  return [e.code, e.path, e.message].filter(Boolean).join(' ');
}

function applyCommands(doc, commands) {
  if (!Array.isArray(commands)) {
    throw new BoardFileError('Commands must be a JSON array', ['commands must be an array']);
  }
  if (commands.length === 0) return doc;
  const host = headlessHost(doc);
  const result = host.agent.apply({
    requestId: 'board-file',
    expectedEditToken: host.agent.editToken(),
    commands,
  });
  if (!result.success) {
    const errors = (result.errors || []).map(formatAgentError);
    throw new BoardFileError(`Commands refused (${errors.length})`, errors.length ? errors : ['unknown error']);
  }
  return host.doc;
}

/** Stamps a revision record (child of `baseline` when given) and packs the board into `templateHtml`. */
function pack(templateHtml, doc, baseline, options) {
  const { revisionRecord } = transitionRevision(doc, baseline, canonicalJson,
    options.revisionId ? { idGenerator: () => options.revisionId } : {});
  const stamped = { ...doc, [REVISION_EXTENSION_KEY]: revisionRecord };

  const check = validateDocument(stamped, { verifyDigest: true });
  if (!check.valid) throw new BoardFileError('Board failed validation', check.errors);

  const packed = packageHtmlWithDocument(templateHtml, stamped);
  if (!packed.success) throw new BoardFileError(packed.error, [packed.error]);
  return { html: packed.html, document: stamped };
}

/** Reads the board document out of a Sabura .html file. */
export function readBoardFile(html) {
  const result = extractDocumentFromHtml(html);
  if (!result.valid) throw new BoardFileError('Not a valid Sabura board file', result.errors);
  return result.document;
}

/**
 * Creates a new board from agent commands (sabura/commands/v1, explicit IDs).
 * `templateHtml` is any Sabura board file; only its editor runtime is kept.
 */
export function createBoardFile(templateHtml, { title, commands = [], id, revisionId } = {}) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new BoardFileError('A board needs a title', ['title is required']);
  }
  readBoardFile(templateHtml); // the template must itself be a working board
  let doc = normalizeDocument(createDefaultDocument({ id, title }));
  doc.title = title;
  doc = applyCommands(doc, commands);
  return pack(templateHtml, doc, null, { revisionId });
}

/**
 * Applies agent commands to an existing board. The result is packed into
 * `templateHtml` (normally the current editor), so the document and the
 * runtime that validated it always match. The new revision's parent is the
 * board's previous revision, as with Save Copy.
 */
export function editBoardFile(boardHtml, templateHtml, { commands, revisionId } = {}) {
  const current = readBoardFile(boardHtml);
  const baseline = current[REVISION_EXTENSION_KEY] || null;
  const { [REVISION_EXTENSION_KEY]: _drop, ...doc } = current;
  const edited = applyCommands(doc, commands);
  return pack(templateHtml, edited, baseline, { revisionId });
}

/** Short, content-free description of a board for tool output. */
export function summarizeBoard(doc) {
  const objects = Object.values(doc.objects || {});
  const count = (type) => objects.filter((o) => o.type === type).length;
  return {
    title: doc.title,
    objects: objects.length,
    connectors: count('connector'),
    groups: Object.keys(doc.groups || {}).length,
    revisionId: doc[REVISION_EXTENSION_KEY]?.revisionId ?? null,
    parentRevisionId: doc[REVISION_EXTENSION_KEY]?.parentId ?? null,
  };
}
