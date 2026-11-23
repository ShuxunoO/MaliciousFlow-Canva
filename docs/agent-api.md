# Canvas Agent API

The application exposes `window.maliciousFlow` to JavaScript running in the canvas page. The same commands drive the built-in investigation tools and the Agent panel. Call `set_view()` after the page has loaded to read the active case and analysis revision.

## Commands

| Method | Input | Result |
| --- | --- | --- |
| `set_view()` | Optional reference string or view options | Resolves to the active case ID, analysis revision, selection, filters, grouping, visible counts and zoom level |
| `get_selection()` | None | Returns a copy of the view context, including selected node, related transfers, filter bounds, and asset balances |
| `collect(seed, trace?)` | Ethereum address or transaction hash and optional `{ direction, hops }` | Queries the data provider, applies verified batches, then returns the data coverage statement and event references |
| `stop_collection()` | None | Aborts an ongoing provider request. Previously committed results remain available |
| `analysis_updates(caseId, afterRevision)` | Case ID and last processed analysis revision | Returns subsequent persisted receipts in order, including after a reload |
| `apply_analysis(batch)` | Versioned batch | Resolves to a receipt after writing the batch and updating the graph |
| `edit_canvas(command)` | Canvas edit described below | Changes the active case. `connect` returns the new relationship ID |
| `edit_entity({ name, members, replaceId? })` | Entity name and address IDs | Shows the proposed membership in the Agent panel and returns the proposed changes. The user confirms or cancels. Set `replaceId` to replace the members of an existing entity. An empty replacement ungroups it |
| `edit_report({ text, refs, chapter })` | Draft text, reference IDs and optional chapter ID | Saves a cited draft and returns its ID and references. The user reviews the proposed conclusion before publishing |
| `show_evidence(ref)` | Transaction event ID or evidence ID | Opens the evidence in the report pane and returns a copy of the transaction |
| `set_agent_handler(handler?)` | Function or `undefined` | Installs an Agent integration or restores the built-in rule-based responder |

A reference can be an address ID, entity ID, graph edge ID, transaction event ID or evidence ID. Transaction evidence can be revealed temporarily outside the current filters. Use `set_view({ clearSelection: true })` to clear the selection and dismiss temporary reveals.

### View options

- `ref` locates a graph object or evidence record.
- `filters` replaces the current filter object. It may include `address`, `asset`, `from`, `to`, `core` and `viewId`. An address filter accepts an address or entity ID. `asset` uses the stable asset ID from the case, such as `1:native` for ETH. `from` is inclusive and `to` is exclusive.
- `grouped` turns entity aggregation on or off. `branch` accepts `{ id, direction: 'in' | 'out', collapsed }`.
- `fit` fits visible nodes to the canvas. `zoom` sets the zoom factor and `pan: [dx, dy]` translates the viewport.

### Canvas edits

| Action | Fields |
| --- | --- |
| `include` | `ref` containing an existing address, transaction hash, event ID, or evidence ID |
| `rename_case` | `text` |
| `rename` | Visible node `id` and `text` |
| `note` | Node, edge or transaction `id` and `text` |
| `move` | Visible node `id` and canvas coordinates `position: [x, y]` |
| `bend` | Visible edge `id` and numeric route `offset` |
| `connect` | `source` and `target` node IDs, with optional `note` |
| `disconnect` | Manual relationship `id` |
| `undo`, `redo` | None |

The canvas renders manual relationships as dashed edges. The transaction ledger continues to represent sourced on-chain events.

## Analysis batches

Use `apply_analysis` when an Agent already has transaction evidence or computed snapshots. Use a stable event ID that includes the transaction hash and log position when applicable. Amounts and USD values use exact decimal strings. Times use ISO 8601 with a timezone.

| Field | Contract |
| --- | --- |
| `schemaVersion` | `1` |
| `caseId` | ID of the active case |
| `expectedRevision` | Current analysis revision from `set_view()` |
| `requestId` | A unique string. Reuse the exact request body and ID for a transport retry |
| `addresses` | Array of `{ id, address, name }`, optionally with role, column and color |
| `transfers` | Array of `{ id, source, target, hash, time, asset, assetId, amount, sources }`. Optional `usd`, `evidence`, `rawAmount`, `verification` and `note` |
| `balances` | Optional array of `{ addressId, assetId, asset, amount, time, source, usd? }` |

Both endpoints of a transfer must exist in the case or the incoming batch. Each transfer requires at least one source. A receipt includes `revision`, `added`, `duplicates`, and `refs`, and the app dispatches a `flow:analysis` event at `#app` after rendering, with the case ID and receipt in `event.detail`. A consumer recovering after a reload can call `analysis_updates(caseId, lastSeenRevision)` before resuming event processing. Version conflicts and duplicate ID conflicts reject the batch. An identical retry returns the original receipt.

```js
const api = window.maliciousFlow
const { caseId, revision } = await api.set_view()
const address = "0x0000000000000000000000000000000000000001"
const id = "eth:" + address
await api.apply_analysis({
  schemaVersion: 1,
  caseId,
  expectedRevision: revision,
  requestId: crypto.randomUUID(),
  addresses: [{ id, address, name: "Example address" }],
  transfers: []
})
await api.set_view(id)
api.edit_canvas({ action: "note", id, text: "Review the evidence before attributing this address." })
```

## Agent chat integration

The built-in responder answers questions about amounts, direction, balances and evidence with data from the current selection. To connect an external Agent, provide a callback. It receives a snapshot of the question, selection and conversation. Return a string `text` and an array of `refs` containing identifiers from the active case.

```js
window.maliciousFlow.set_agent_handler(async ({ question, context, history }) => {
  const response = await fetch("/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context, history })
  })
  if (!response.ok) throw new Error("Agent request failed")
  return response.json()
})
```

The example `/agent` route is implemented by the host. Hold any model-provider credentials at that integration boundary.

## Ethereum data provider

Set `VITE_BLOCKSCOUT_URL` to a compatible Ethereum mainnet v2 service that allows requests from the canvas origin. The built-in collection tool reads native balances and confirmed, nonzero native ETH and ERC-20 transfers. It reads up to two pages per feed and reports when more are available. The tool uses historical provider prices for eligible transfer estimates. The default collection covers the seed. Choose **Upstream** or **Downstream** in the Agent panel, or pass `{ direction: 'upstream' | 'downstream', hops: 1 | 2 | 3 }` to `collect`. The seed transaction or first directional address transfers count as hop 1. Follow-up searches use matching assets and strictly earlier or later UTC timestamps. Up to 8 follow-up addresses are queried using the provider’s recent pages. For traced searches, `hops` in the result is an array of event-ID arrays by hop, `followedAddresses` counts queried follow-up addresses, `limited` flags the address cap, and `failed` counts follow-up addresses with provider errors. Results describe candidate connections supported by individually sourced transfers. Internal calls, NFT transfers and additional chains are outside the current data coverage. [Blockscout v2 API](https://github.com/blockscout/blockscout-api-v2-swagger/blob/main/swagger.yaml)

Use `npm test` for unit tests and `npm run test:browser` for the browser suite. With `FLOW_LIVE_BLOCKSCOUT=1`, the browser suite also queries a historical transaction through the online provider.
