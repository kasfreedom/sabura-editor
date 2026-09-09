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
