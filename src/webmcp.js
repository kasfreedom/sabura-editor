import {
  AGENT_EDIT_REQUEST_SCHEMA,
  AGENT_HISTORY_REQUEST_SCHEMA
} from './agent-api.js';

export const SABURA_WEBMCP_TOOL_NAMES = Object.freeze([
  'sabura_read_board',
  'sabura_edit_board',
  'sabura_undo',
  'sabura_redo',
  'sabura_focus_objects',
  'sabura_fit_board',
  'sabura_save_copy'
]);

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false
});

const FOCUS_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    ids: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 }
    },
    padding: { type: 'number', minimum: 0, maximum: 400 }
  },
  required: ['ids'],
  additionalProperties: false
});

const READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  untrustedContentHint: true,
  consequentialHint: false
});

const MUTATION_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  untrustedContentHint: true,
  consequentialHint: false
});

const SAVE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  untrustedContentHint: true,
  consequentialHint: true
});

function cancelled() {
  return {
    success: false,
    errors: [{ code: 'CANCELLED', message: 'The WebMCP tool call was cancelled before execution' }]
  };
}

function failed() {
  return {
    success: false,
    errors: [{ code: 'TOOL_EXECUTION_FAILED', message: 'The Sabura tool could not complete the request' }]
  };
}

function executeSafely(operation) {
  return async (input = {}, options = {}) => {
    if (options?.signal?.aborted) return cancelled();
    try {
      return await operation(input);
    } catch (_) {
      return failed();
    }
  };
}

function redactRasterData(snapshot) {
  const documentCopy = snapshot?.document;
  if (!documentCopy?.assets || typeof documentCopy.assets !== 'object') return snapshot;

  const omittedAssetData = [];
  for (const [assetId, asset] of Object.entries(documentCopy.assets)) {
    if (!asset || typeof asset !== 'object' || typeof asset.data !== 'string') continue;
    omittedAssetData.push({
      id: assetId,
      mimeType: asset.mimeType || null,
      dataUrlCharacters: asset.data.length
    });
    delete asset.data;
    asset.dataOmitted = true;
  }
  if (omittedAssetData.length > 0) {
    snapshot.rasterDataOmitted = true;
    snapshot.omittedAssetData = omittedAssetData;
  }
  return snapshot;
}

export function createSaburaWebMcpTools(agent) {
  return [
    {
      name: 'sabura_read_board',
      title: 'Read Sabura board',
      description: 'Read a copied snapshot of the live Sabura document, selection, viewport, history, mode, and edit token. Embedded raster bytes are omitted; board text is user-authored and untrusted.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
      execute: executeSafely(() => redactRasterData(agent.read()))
    },
    {
      name: 'sabura_edit_board',
      title: 'Edit Sabura board',
      description: 'Apply one validated, atomic Sabura command batch in Editing mode. Use the edit token from sabura_read_board and a unique requestId; exact retries are idempotent.',
      inputSchema: AGENT_EDIT_REQUEST_SCHEMA,
      annotations: MUTATION_ANNOTATIONS,
      execute: executeSafely(input => agent.apply(input))
    },
    {
      name: 'sabura_undo',
      title: 'Undo Sabura edit',
      description: 'Undo one Sabura history entry using optimistic concurrency and an idempotent requestId.',
      inputSchema: AGENT_HISTORY_REQUEST_SCHEMA,
      annotations: MUTATION_ANNOTATIONS,
      execute: executeSafely(input => agent.undo(input))
    },
    {
      name: 'sabura_redo',
      title: 'Redo Sabura edit',
      description: 'Redo one Sabura history entry using optimistic concurrency and an idempotent requestId.',
      inputSchema: AGENT_HISTORY_REQUEST_SCHEMA,
      annotations: MUTATION_ANNOTATIONS,
      execute: executeSafely(input => agent.redo(input))
    },
    {
      name: 'sabura_focus_objects',
      title: 'Focus Sabura objects',
      description: 'Focus the live viewport on existing Sabura object IDs without changing the document or edit token.',
      inputSchema: FOCUS_INPUT_SCHEMA,
      annotations: MUTATION_ANNOTATIONS,
      execute: executeSafely(input => agent.focusObjects(input.ids, { padding: input.padding }))
    },
    {
      name: 'sabura_fit_board',
      title: 'Fit Sabura board',
      description: 'Fit all board content in the live viewport without changing the document or edit token.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: MUTATION_ANNOTATIONS,
      execute: executeSafely(() => agent.fitBoard())
    },
    {
      name: 'sabura_save_copy',
      title: 'Save Sabura copy',
      description: 'Prepare a self-contained Sabura HTML copy and request a browser download. The result never independently confirms file delivery.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: SAVE_ANNOTATIONS,
      execute: executeSafely(() => agent.saveCopy())
    }
  ];
}

export class SaburaWebMcpBridge {
  constructor(agent, modelContext = globalThis.document?.modelContext) {
    this.agent = agent;
    this.modelContext = modelContext;
    this.controller = null;
    this.registration = null;
  }

  register() {
    if (this.registration) return this.registration;
    if (!this.modelContext || typeof this.modelContext.registerTool !== 'function') {
      this.registration = Promise.resolve({ supported: false, registered: [] });
      return this.registration;
    }

    this.controller = new AbortController();
    this.registration = this.registerTools();
    return this.registration;
  }

  async registerTools() {
    const registered = [];
    try {
      for (const tool of createSaburaWebMcpTools(this.agent)) {
        await this.modelContext.registerTool(tool, { signal: this.controller.signal });
        registered.push(tool.name);
      }
      return { supported: true, registered };
    } catch (_) {
      this.controller.abort();
      return { supported: true, registered: [], failed: true };
    }
  }

  dispose() {
    this.controller?.abort();
  }
}

export function registerSaburaWebMcp(agent, modelContext = globalThis.document?.modelContext) {
  const bridge = new SaburaWebMcpBridge(agent, modelContext);
  bridge.register();
  return bridge;
}
