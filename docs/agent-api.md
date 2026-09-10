# Sabura live agent API

Sabura exposes a narrow, versioned façade for an agent that can execute
JavaScript in the loaded editor page. It uses the editor's existing commands,
validation, rendering, history, and Save Copy implementation. It does not need a
server or network connection.

The user should put the editor in **Editing** mode before agent authoring. Agent
edits are rejected while the editor is Reading, Presenting, saving, importing an
image, editing text, or handling a pointer gesture.

## Discover and read

```js
const description = window.sabura.agent.describe();
// description.apiVersion === "sabura/agent/v1"
// description.commandSchemaVersion === "sabura/commands/v1"

const snapshot = window.sabura.agent.read();
const token = snapshot.editToken;
const documentCopy = snapshot.document;
```

`read()` and subscription results are copies. Changing them cannot change the
open board. The edit token is live session state; it is not document revision
metadata and is not written into a saved file.

## Apply one atomic batch

Agent-created objects, connectors, images, assets, and groups require explicit
IDs. Reusing an existing ID is rejected.

```js
const { editToken } = window.sabura.agent.read();

const result = window.sabura.agent.apply({
  requestId: "story-step-001",
  expectedEditToken: editToken,
  commands: [
    {
      type: "create_object",
      object: {
        id: "agent_gateway",
        type: "rectangle",
        x: 120,
        y: 180,
        width: 180,
        height: 90,
        text: "Gateway"
      }
    },
    {
      type: "create_object",
      object: {
        id: "agent_service",
        type: "ellipse",
        x: 420,
        y: 180,
        width: 180,
        height: 90,
        text: "Service"
      }
    },
    {
      type: "connect_objects",
      connectorId: "agent_gateway_service",
      fromId: "agent_gateway",
      toId: "agent_service",
      routing: "straight"
    }
  ]
});

if (!result.success) console.error(result.errors);
```

The batch is validated sequentially and committed as one undo step. If any
command fails, neither the document nor history changes. A successful response
reports `changed`, tokens before and after, and created, updated, deleted, and
render-affected IDs.

## Stale edits and safe retries

```js
const stale = window.sabura.agent.apply({
  requestId: "story-step-002",
  expectedEditToken: editToken,
  commands: [{
    type: "move_objects",
    ids: ["agent_service"],
    dx: 40,
    dy: 0
  }]
});

if (!stale.success && stale.errors[0].code === "STALE_EDIT") {
  const fresh = window.sabura.agent.read();
  // Re-evaluate the intended change against fresh.document, then use a new
  // requestId with fresh.editToken.
}
```

Retrying exactly the same completed request, including its original token,
returns the cached result and does not apply it twice. Reusing that request ID
with different content returns `REQUEST_ID_REUSE`. The cache is session-local,
bounded, and not saved in the document.

Undo and redo use the same token and request-ID safeguards:

```js
const undoSnapshot = window.sabura.agent.read();
const undone = window.sabura.agent.undo({
  requestId: "story-undo-001",
  expectedEditToken: undoSnapshot.editToken
});
```

## Focus, fit, and save

```js
window.sabura.agent.focusObjects(
  ["agent_gateway", "agent_service", "agent_gateway_service"],
  { padding: 80 }
);

window.sabura.agent.fitBoard();

const save = window.sabura.agent.saveCopy();
// save.exportPrepared === true
// save.downloadRequested === true
// save.deliveryConfirmed === false
```

Focus and fit are viewport-only: they do not change the document, history, or
edit token. Save Copy prepares a self-contained HTML artifact and requests a
browser download. The browser or agent harness must independently confirm that
the file was delivered.

## Supported command surface

Use `agent.describe().supportedCommands` as the source of truth. Internal
inverse/history commands, nested batches, and commands that generate implicit
IDs are intentionally absent. The legacy `window.sabura` API remains available
for backward compatibility; new live-agent integrations should use
`window.sabura.agent`.

## Native WebMCP bridge (experimental)

When the browser provides the experimental WebMCP imperative API, Sabura
feature-detects `document.modelContext.registerTool` and registers seven stable
tools:

- `sabura_read_board`
- `sabura_edit_board`
- `sabura_undo`
- `sabura_redo`
- `sabura_focus_objects`
- `sabura_fit_board`
- `sabura_save_copy`

The bridge is only an adapter over `window.sabura.agent`; it has no separate
editing engine. Therefore edits retain the same validation, atomic batch,
history, edit-token, and idempotent retry guarantees documented above. Browsers
without WebMCP continue normally and expose the JavaScript API only. A partial
or failed WebMCP registration is rolled back and does not prevent editor startup.

Board text and other user-authored content are marked untrusted in tool
metadata. `sabura_read_board` removes embedded raster `data` URLs from its
response by default while retaining asset IDs, MIME types, dimensions, and an
omission summary. This prevents image base64 from consuming agent context; the
normal JavaScript `agent.read()` API still returns the complete copied document.

An agent can discover and execute the tools using the browser-provided WebMCP
surface. For example, in an enabled browser:

```js
const tools = await document.modelContext.getTools();
const readTool = tools.find(tool => tool.name === 'sabura_read_board');
const snapshot = JSON.parse(
  await document.modelContext.executeTool(readTool, {})
);

const editTool = tools.find(tool => tool.name === 'sabura_edit_board');
const result = JSON.parse(
  await document.modelContext.executeTool(editTool, {
    requestId: 'agent-story-001',
    expectedEditToken: snapshot.editToken,
    commands: [{
      type: 'create_object',
      object: {
        id: 'agent_service',
        type: 'rectangle',
        x: 160,
        y: 140,
        width: 180,
        height: 90,
        text: 'Service'
      }
    }]
  })
);
```

WebMCP is an evolving browser API rather than a universal web-platform feature.
The adapter does not bundle a polyfill, dependency, origin-trial token, network
service, or cross-origin exposure. Availability and user confirmation remain
controlled by the browser or agent host. Save results deliberately distinguish
`exportPrepared` and `downloadRequested` from `deliveryConfirmed: false`.

### Manual Chrome verification note

The September 2026 draft accepts an input object and returns a JSON DOMString
from `executeTool`, which is why the example parses the result. Chrome 152's
experimental implementation lags that input signature: with Chrome launched
using `--enable-blink-features=WebMCPTesting`, pass `JSON.stringify(input)` to
`executeTool` and still `JSON.parse` its result. In a disposable `file://`
verification, confirm that all seven tool names appear, an edit renders, and
`sabura_undo` restores it. This compatibility difference belongs to the browser
harness; Sabura's registered tool callbacks continue to accept the specified
input object and do not include a version-specific shim or polyfill.
