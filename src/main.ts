import { History, latestBalances, project, sumDecimal } from './case'
import type { CanvasLayer, CaseData, Draft, Edits, Filters, FlowEdge, HistorySnapshot, LayoutSettings, Point } from './case'
import { analysisUpdates, applyAnalysis, applyEntityMembership, entityMembers, investigationSummary, type AnalysisBatch, type Receipt } from './investigation'
import { blockscout, type Collected } from './blockscout'
import { traceTransfers, type TraceOptions } from './trace'
import { answerQuestion, type AgentContext, type AgentHandler } from './agent-context'
import { enableAgentWidgetDrag } from './agent-panel'
import { importCase, KUCOIN_CASE_ID } from './import-case'
import { indexEvidence, conclusionFor, validateDraft, publishConclusion } from './report'
import { importLocalReport } from './report-import'
import { canRestoreCase, loadChart, readDraft, restoreCase, saveCase, saveChartEdits, updateCase } from './storage'
import { chartRoute, createChartsHome } from './charts-home'
import { demo } from './demo'
import { layout, layoutSettings, LAYOUT_LIMITS, NODE_HEIGHT, NODE_WIDTH } from './layout'
import { displayColor, edgeColorStyle, graphData, makeGraph, nodeColorStyle, renderedSnapshot, type Selection } from './renderer'
import { validateDrawing } from './layout-validation'
import { addressAccent, addressIcon } from './address-icons'
import { nodeAssets } from './node-summary'
import './style.css'

const app = document.querySelector<HTMLElement>('#app')!
app.innerHTML = `
  <div id="charts-home" hidden></div>
  <input type="file" id="case-file" accept="application/json,.json" multiple hidden>
  <div id="chart-screen" hidden>
  <header class="top">
    <div class="identity"><span class="mark" aria-hidden="true">M</span><div>
      <div class="brand">MALICIOUSFLOW</div><input id="case-title" aria-label="Canvas name">
    </div></div>
    <div class="toolbar">
      <button id="back-charts">‹ Saved Charts</button><button id="new-case">New investigation</button><button id="import">Import case</button>
      <button id="undo">Undo</button><button id="redo">Redo</button>
      <button id="save-chart" class="primary">Save</button><output id="save-status" aria-live="polite"></output>
    </div>
  </header>
  <div class="workspace">
    <section class="canvas-pane" aria-label="Fund flow canvas">
      <div class="filters toolbar">
        <button id="add-seed" class="primary">+ Address / Tx</button>
        <button id="connect" aria-pressed="false">Connect</button>
        <select id="address-filter" aria-label="Address or entity"></select>
        <div style="position:relative"><input id="search" type="search" aria-label="Address, name or transaction hash" placeholder="Search address, name or hash"><div id="results" hidden></div></div>
        <select id="asset" aria-label="Token"></select><button id="scopes-toggle" aria-controls="scope-panel" aria-expanded="true" hidden>Network scope</button>
        <label>From <input type="date" id="from" aria-label="Start date UTC"></label>
        <label>Before <input type="date" id="to" aria-label="End date UTC"></label>
        <button id="grouped" aria-pressed="false">Group by entity</button><button id="reset">Reset filters</button>
        <button id="box-select" aria-pressed="false">Box select</button>
        <button id="layout-toggle" aria-expanded="false" aria-controls="layout-panel">Layout</button>
        <button id="layers-toggle" aria-expanded="false" aria-controls="layers-panel">Layers</button>
        <button id="exit-pair" hidden>Exit pair view</button>
      </div>
      <div id="canvas-body" class="canvas-body">
        <aside id="scope-panel" aria-label="Network scope" hidden>
          <h2>Network scope</h2><div id="scope-options"></div>
          <label class="context-check"><input id="include-context" type="checkbox" checked>Include historical &amp; comparison activity</label>
          <details id="role-legend" open><summary>Address roles</summary><ul id="scope-legend"></ul></details>
        </aside>
        <div id="stage">
        <div id="graph"></div><div id="empty" hidden>No transfers match the current filters</div>
        <div id="box-surface" hidden><div id="box-marquee" hidden></div></div>
        <form id="layout-panel" class="canvas-popover stack" aria-label="Canvas layout" hidden>
          <label>Row gap <input type="number" name="rowGap" required></label>
          <label>Column gap <input type="number" name="columnGap" required></label>
          <label>Max nodes per column <input type="number" name="maxRows" required></label>
          <output id="layout-validation" class="subtle"></output>
          <div class="actions"><button class="primary">Apply layout</button><button id="layout-reset" type="button">Default</button></div>
        </form>
        <section id="layers-panel" class="canvas-popover stack" aria-label="Canvas layers" hidden>
          <form id="new-layer" class="stack"><label>Layer name <input name="name" required maxlength="80"></label>
            <button id="new-layer-submit" class="primary">New layer</button>
          </form>
          <div id="layer-list" class="stack"></div>
        </section>
        <button id="handle" aria-label="Drag transaction edge" hidden></button>
        <div id="footer"><div class="actions"><button id="zoom-in" aria-label="Zoom in">＋</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit">Fit</button></div><output id="status" aria-live="polite"></output></div>
        </div>
        <aside id="selection" aria-label="Selection details" hidden></aside>
        <div id="agent-widget">
          <section id="agent-panel" aria-label="Agent chat" hidden></section>
          <button id="agent-toggle" aria-label="Agent chat" aria-controls="agent-panel"
            aria-expanded="false" title="Click to open or close. Drag to move.">✦</button>
        </div>
      </div>
    </section>
    <div class="report-dock">
      <button id="report-toggle" aria-controls="report" aria-expanded="true" aria-pressed="true" aria-label="Collapse report"><span aria-hidden="true">›</span><span>Report</span></button>
      <aside id="report" aria-label="Case report"><header class="report-header section-heading"><h2>Case report</h2><button id="draft">New draft</button></header><div id="report-content"></div></aside>
    </div>
  </div>
  <dialog id="node-editor" aria-labelledby="node-editor-title">
    <form id="node-form" class="stack">
      <h2 id="node-editor-title">Edit node</h2>
      <code id="node-editor-address" class="mono"></code>
      <label>Display name <input name="name" required autofocus></label>
      <label>Note <textarea name="note"></textarea></label>
      <div class="actions"><button class="primary">Save node</button><button type="button" id="node-edit-cancel">Cancel</button></div>
    </form>
  </dialog></div>`

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T
const value = (id: string) => $<HTMLInputElement>(id).value
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
let data = demo
let selection: Selection | undefined
let colorPreview: { item: Selection; color: string } | undefined
let boxed = new Set<string>()
let soloLayer: string | undefined
let layerTransaction: string | undefined
let editingNode: string | undefined
let marquee: { pointer: number; start: Point } | undefined
let filters: Filters = {}
let hidden = new Set<string>()
let grouped = false
let revealed: string | undefined
let page = 0
let history = new History()
let savedEdits = JSON.stringify(history.snapshot())
let saving = false
let saveError = false
let routeRequest = 0
let activeCase = false
let view = project(data, history.value)
let drawing = layout(view)
let layoutValidation = validateDrawing(view, drawing)
let assetsByNode = nodeAssets(data, view)
let queue: Promise<void> = Promise.resolve()
let draftEditor: Draft | undefined
let review: { draft: Draft; revision: number } | undefined
let evidence = indexEvidence(data)
let reportMode: 'chapters' | 'timeline' = 'chapters'
let timelinePage = 0
let investigation: AbortController | undefined
let analysisQueue: Promise<unknown> = Promise.resolve()
let keepPositions = false
let linking = false
let linkSource: string | undefined
type AgentMessage = { text: string; refs: string[]; speaker?: 'user' | 'agent' }
let agentHandler: AgentHandler | undefined
let chatRequest = 0
let conversation: AgentMessage[] = []
let entityPreview: { caseId: string; state: Edits; name: string; members: string[]; id: string; replace: boolean } | undefined
const provider = blockscout(import.meta.env.VITE_BLOCKSCOUT_URL || undefined)
const graph = makeGraph($('graph'), setSelection, (id, point) => {
  keepPositions = true
  edit(edits => { edits.positions[id] = point })
}, () => selection, toggleBranch, showNodeEditor)
const status = (text: string) => { $('status').textContent = text }
let graphSize = [0, 0]
function resizeGraph() {
  const { clientWidth: width, clientHeight: height } = $('graph')
  if (width && height && (width !== graphSize[0] || height !== graphSize[1])) {
    graphSize = [width, height]
    graph.setSize(width, height)
    updateHandle()
  }
}
new ResizeObserver(resizeGraph).observe($('graph'))

function updateSaveStatus() {
  const output = $('save-status')
  output.dataset.state = saving ? 'saving' : saveError ? 'error' :
    JSON.stringify(history.snapshot()) === savedEdits ? 'saved' : 'pending'
  output.textContent = { saving: 'Saving…', error: 'Save failed. Retry.', saved: 'Saved', pending: 'Unsaved changes' }[output.dataset.state]!
  $<HTMLButtonElement>('save-chart').disabled = saving
}

function persist() {
  try {
    localStorage.setItem('flow-edits:' + data.id, JSON.stringify(history.snapshot()))
  } catch {
    status('Local storage is full')
  }
  updateSaveStatus()
}

$('save-chart').onclick = async () => {
  if (!activeCase || saving) return
  const id = data.id
  const currentRoute = routeRequest
  const snapshot = structuredClone(history.snapshot())
  const serialized = JSON.stringify(snapshot)
  saving = true
  updateSaveStatus()
  try {
    await saveChartEdits(id, snapshot.value.title ?? data.title, snapshot)
    try {
      const draft = readDraft(id)
      if (draft && JSON.stringify(History.restore(draft).snapshot()) === serialized) localStorage.removeItem('flow-edits:' + id)
    } catch {}
    if (routeRequest !== currentRoute) return
    savedEdits = serialized
    saveError = false
  } catch {
    if (routeRequest === currentRoute) saveError = true
  } finally {
    if (routeRequest === currentRoute) {
      saving = false
      updateSaveStatus()
    }
  }
}

function edit(change: (edits: Edits) => void) {
  history.change(change)
  persist()
  void render()
}

function toggleBranch(id: string, direction: 'in' | 'out') {
  const key = id + ':' + direction
  if (hidden.has(key)) hidden.delete(key)
  else hidden.add(key)
  revealed = undefined
  selection = { type: 'node', id }
  void render()
}

function setSelection(item?: Selection) {
  colorPreview = undefined
  boxed.clear()
  layerTransaction = undefined
  if (linking && item?.type === 'node') {
    if (!linkSource) {
      linkSource = item.id
      selection = item
      updateLinkStatus()
      return
    }
    if (linkSource !== item.id) {
      addRelationship(linkSource, item.id)
      exitLinkMode()
      selection = item
      void render()
    }
    return
  }
  selection = item
  page = 0
  void render()
}

function updateHandle() {
  const handle = $('handle')
  const route = selection?.type === 'edge' ? drawing.routes[selection.id] : undefined
  handle.hidden = !route
  if (!route) return
  const [x, y] = graph.getClientByCanvas(route.handle)
  const rect = $('stage').getBoundingClientRect()
  handle.style.left = (x - rect.left) + 'px'
  handle.style.top = (y - rect.top) + 'px'
  handle.dataset.axis = route.handleAxis
}

function render(fit = false, focus?: string, refreshInspector = true): Promise<void> {
  queue = queue.catch(() => {}).then(async () => {
    view = project(data, history.value, filters, grouped, hidden, revealed, soloLayer)
    if (selection && ![...view.nodes, ...view.edges].some(item => item.id === selection?.id)) selection = undefined
    const visibleIds = new Set(view.nodes.map(node => node.id))
    boxed = new Set([...boxed].filter(id => visibleIds.has(id)))
    const showInspector = !!(selection || boxed.size) && !linking
    const anchor = selection && (drawing.positions[selection.id] ?? drawing.routes[selection.id]?.handle)
    const beforeResize = refreshInspector && $('selection').hidden === showInspector && anchor && !fit && !focus
      ? graph.getClientByCanvas(anchor) : undefined
    if (refreshInspector) $('selection').hidden = !showInspector
    resizeGraph()
    drawing = layout(view, keepPositions ? { ...drawing.positions, ...history.value.positions } : history.value.positions,
      history.value.bends, keepPositions ? drawing : undefined, history.value.layout, !!filters.pair)
    layoutValidation = validateDrawing(view, drawing)
    const { transactions, summaries, missing, invalidAnchors, blockedRoutes, overlappingSummaries, detours } = layoutValidation
    const issues = missing.length + invalidAnchors.length + blockedRoutes.length + overlappingSummaries.length
    $('layout-validation').textContent = `${summaries}/${transactions} transaction summaries · ${issues} layout issues` +
      (detours.length ? ` · ${detours.length} extended routes` : '')
    keepPositions = false
    assetsByNode = nodeAssets(data, view, filters.to)
    const styles = colorPreview && colorPreview.item === selection
      ? withColor(history.value, colorPreview.item, colorPreview.color) : history.value
    graph.setData(graphData(view, drawing, styles, assetsByNode, hidden, selection, boxed, !!filters.pair))
    await graph.render()
    if (beforeResize && anchor) {
      const [x, y] = graph.getClientByCanvas(anchor)
      const rect = $('graph').getBoundingClientRect()
      const target = Math.max(rect.left + 30, Math.min(beforeResize[0], rect.right - 30))
      await graph.translateBy([target - x, beforeResize[1] - y])
    }
    if (fit && view.nodes.length) await graph.fitView()
    if (focus) {
      const readingZoom = filters.pair ? .9 : .62
      if (graph.getZoom() < readingZoom) await graph.zoomTo(readingZoom)
      await graph.focusElement(focus)
    }
    $('empty').hidden = !!view.nodes.length
    $('graph').dataset.nodes = String(view.nodes.length)
    $('graph').dataset.edges = String(view.edges.length)
    $('exit-pair').hidden = !filters.pair
    const count = (total: number, word: string) => total.toLocaleString('en-US') + ' ' + word + (total === 1 ? '' : 's')
    status([count(view.nodes.length, 'node'), count(view.edges.length, 'edge'), count(view.count, 'transfer')].join(' · '))
    if (refreshInspector) renderSelection()
    if (!$('layers-panel').hidden) renderLayers()
    renderAgentContext()
    if (linking) updateLinkStatus()
    updateHandle()
  }).catch(error => status(error instanceof Error ? error.message : String(error)))
  return queue
}

function openCase(next: CaseData, checkpoint?: HistorySnapshot) {
  activeCase = true
  investigation?.abort()
  investigation = undefined
  cancelDrag()
  chatRequest++
  data = next
  exitLinkMode()
  entityPreview = undefined
  loadConversation()
  selection = undefined
  colorPreview = undefined
  boxed.clear()
  soloLayer = undefined
  setBoxMode(false)
  $<HTMLDialogElement>('node-editor').close()
  filters = { core: !!(next.core ?? next.views?.core) }
  grouped = false
  hidden = new Set()
  revealed = undefined
  draftEditor = undefined
  review = undefined
  evidence = indexEvidence(next)
  reportMode = 'chapters'
  timelinePage = 0
  savedEdits = JSON.stringify(History.restore(checkpoint).snapshot())
  history = History.restore(readDraft(next.id) ?? checkpoint)
  saving = false
  saveError = false
  updateSaveStatus()
  syncLayout()
  showPopover('layout', false)
  showPopover('layers', false)
  $<HTMLInputElement>('case-title').value = history.value.title ?? next.title
  renderScopes()
  $('grouped').setAttribute('aria-pressed', 'false')
  updateAssets()
  updateAddresses()
  $<HTMLButtonElement>('agent-send').disabled = false
  $<HTMLTextAreaElement>('agent-question').value = loadAgentDraft()
  renderConversation()
  for (const id of ['from', 'to', 'search']) $<HTMLInputElement>(id).value = ''
  $('results').hidden = true
  setAgentOpen(false)
  $<HTMLDetailsElement>('collect-controls').open = false
  renderReport()
  return render(true)
}

const scopeNames: Record<string, [string, string]> = {
  all: ['Full network', 'All transfer records'],
  core: ['Core paths', 'Original graph and key v4 evidence'],
  original: ['Original data', 'Original graph transfers in the new layout'],
  return: ['Public return flow', 'Withdrawals through G2 and D1 to a later deposit'],
}
const activeScope = () => filters.viewId ?? (filters.core ? 'core' : 'all')

function syncScopes() {
  for (const button of $('scope-options').querySelectorAll<HTMLButtonElement>('[data-scope]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scope === activeScope()))
  }
  $<HTMLInputElement>('include-context').checked = filters.includeContext !== false
}

function setScopesOpen(open: boolean) {
  $('scope-panel').hidden = !open
  $('scopes-toggle').setAttribute('aria-expanded', String(open))
}

function renderScopes() {
  const ids = new Set(['all', ...Object.keys(data.views ?? {})])
  if (data.core) ids.add('core')
  const hasControls = ids.size > 1 || data.transfers.some(event => event.context)
  $('scopes-toggle').hidden = !hasControls
  setScopesOpen(hasControls && matchMedia('(min-width: 1051px)').matches)
  const scopes = [...ids].filter(id => !/^batch-D\d+$/.test(id))
  const batches = [...ids].filter(id => /^batch-D\d+$/.test(id)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const button = (id: string, title: string, description?: string) =>
    `<button data-scope="${esc(id)}"><strong>${esc(title)}</strong>${description ? `<small>${esc(description)}</small>` : ''}</button>`
  $('scope-options').innerHTML = '<div class="scope-list">' +
    scopes.map(id => button(id, scopeNames[id]?.[0] ?? id, scopeNames[id]?.[1])).join('') + '</div>' +
    (batches.length ? '<h3>Batch activity</h3><div class="scope-batches">' +
      batches.map(id => button(id, id.slice(6))).join('') + '</div>' : '')
  const roles = new Map(data.addresses.flatMap(node => node.role ? [[node.role, addressAccent(node.color)]] : []))
  $('role-legend').hidden = !roles.size
  $('scope-legend').innerHTML = [...roles].sort(([a], [b]) => a.localeCompare(b)).map(([role, color]) =>
    `<li><i style="background:${color}"></i>${esc(role)}</li>`).join('')
  syncScopes()
}

function updateAssets() {
  const assets = new Map(data.transfers.map(item => [item.assetId, item.asset]))
  const counts = new Map<string, number>()
  for (const name of assets.values()) counts.set(name, (counts.get(name) ?? 0) + 1)
  const select = $<HTMLSelectElement>('asset')
  select.innerHTML = '<option value="">All tokens</option>' + [...assets].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, asset]) => `<option value="${esc(id)}">${esc(asset)}${(counts.get(asset) ?? 0) > 1 ? ' · ' + esc(id.slice(-8)) : ''}</option>`).join('')
  select.value = filters.asset ?? ''
}

function updateAddresses() {
  const select = $<HTMLSelectElement>('address-filter')
  select.innerHTML = '<option value="">All addresses</option>' + [
    ...history.value.entities.map(entity => [entity.id, entity.name]),
    ...data.addresses.map(node => [node.id, history.value.names[node.id] ?? node.name]),
  ].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')
  select.value = filters.address ?? ''
}

function setAgentOpen(open: boolean) {
  $('agent-panel').hidden = !open
  $('agent-toggle').setAttribute('aria-expanded', String(open))
  if (!open) $<HTMLDetailsElement>('agent-attachments').open = false
  renderAgentContext()
}

function updateLinkStatus() {
  status(linkSource ? 'Choose the destination node' : 'Choose the source node')
}

function exitLinkMode() {
  linking = false
  linkSource = undefined
  $('connect').setAttribute('aria-pressed', 'false')
}

function addRelationship(source: string, target: string, note = '') {
  const ids = new Set([...data.addresses.map(item => item.id), ...history.value.entities.map(item => item.id)])
  if (!ids.has(source) || !ids.has(target) || source === target) throw new Error('Choose two distinct nodes in this case')
  const id = 'relation:' + crypto.randomUUID()
  edit(edits => { edits.relations.push({ id, source, target, note: note.trim() }) })
  return id
}

function eventRows(events: FlowEdge['events']): string {
  page = Math.max(0, Math.min(page, Math.ceil(events.length / 8) - 1))
  const entries = events.slice(page * 8, (page + 1) * 8).map(item => `
    <div class="transfer stack">
      <strong>${esc(item.amount)} ${esc(item.asset)}</strong>
      <div class="subtle">${esc(item.time)}${item.usd ? ' · $' + esc(item.usd) : ''}</div>
      <code class="mono">${esc(item.hash)}</code>
      <div class="subtle">${esc(item.sources?.join(' · '))}${item.verification ? ' · ' + esc(item.verification) : ''}</div>
      <button class="ref" data-report="${esc(item.id)}">${item.evidence ? 'Evidence ' + esc(item.evidence) : 'Transaction source'}</button>
      <button data-layer-event="${esc(item.id)}">Add transfer to layer</button>
      <label>Transaction note<textarea data-note="${esc(item.id)}">${esc(history.value.notes[item.id] ?? item.note)}</textarea></label>
    </div>`).join('')
  return entries + (events.length > 8
    ? `<div class="actions"><button data-page="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><small>${page + 1} / ${Math.ceil(events.length / 8)}</small><button data-page="1" ${(page + 1) * 8 >= events.length ? 'disabled' : ''}>Next</button></div>` : '')
}

const colorKey = (item: Selection) => item.type === 'node' ? 'nodeColors' : 'edgeColors'

function withColor(edits: Edits, item: Selection, color: string) {
  const key = colorKey(item)
  return { ...edits, [key]: { ...edits[key], [item.id]: color } }
}

function colorControls(item: Selection, color: string) {
  const custom = history.value[colorKey(item)]?.[item.id]
  return `<div class="inspector-color actions">
    <label>${item.type === 'node' ? 'Node color' : 'Edge color'} <input type="color" value="${esc(color)}" data-element-color></label>
    <button data-reset-color ${custom ? '' : 'disabled'}>Reset color</button>
  </div>`
}

function renderSelection() {
  const panel = $('selection')
  const node = selection?.type === 'node' ? view.nodes.find(item => item.id === selection?.id) : undefined
  const edge = selection?.type === 'edge' ? view.edges.find(item => item.id === selection?.id) : undefined
  panel.hidden = linking || !node && !edge && !boxed.size
  const close = (revealed ? '<button data-return-view>Return to previous view</button>' : '') + '<button data-close aria-label="Close details">×</button>'
  if (boxed.size) {
    const nodes = view.nodes.filter(item => boxed.has(item.id))
    panel.innerHTML = `<div class="section-heading"><h3>${nodes.length} selected ${nodes.length === 1 ? 'node' : 'nodes'}</h3>${close}</div>
      <div class="stack"><button data-open-layers>Add selection to layer</button>
      <div class="inspector-paths">${nodes.map(item => `<button data-focus="${esc(item.id)}"><span>${esc(item.name)}</span><small>${esc(item.role ?? 'Address')}</small></button>`).join('')}</div></div>`
  }
  if (node) {
    const icon = addressIcon(node)
    const adjacent = view.edges.filter(item => item.source === node.id || item.target === node.id)
    const related = adjacent.flatMap(item => item.events).sort((a, b) =>
      a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
    const relatedOpen = panel.querySelector<HTMLDetailsElement>('[data-related]')?.open
    const path = (item: FlowEdge) => {
      const outbound = item.source === node.id
      const peer = view.nodes.find(other => other.id === (outbound ? item.target : item.source))
      return `<button data-focus="${esc(item.id)}"><span>${outbound ? '→' : '←'} ${esc(peer?.name)}</span><small>${esc(item.asset ? item.amount + ' ' + item.asset : 'Relationship')}</small></button>`
    }
    const balanceRows = assetsByNode.get(node.id) ?? []
    const snapshotRecords = latestBalances(data, node.members ?? [node.id], filters.to)
    const totals = (rows: string[]) => rows.length ? esc(sumDecimal(rows)) : '—'
    const tokenRows = balanceRows.map(item => `<tr title="${esc(item.id)}"><th>${esc(item.symbol)}</th>
      <td>${totals(item.incoming)}</td><td>${totals(item.outgoing)}</td><td>${totals(item.balances)}</td>
      <td>${item.prices.length ? '$' + totals(item.prices) + (item.prices.length < item.snapshots ? ' *' : '') : '—'}</td></tr>`).join('')
    panel.innerHTML = `<div class="section-heading"><h3>${esc(node.name)}</h3>${close}</div><div class="stack">
      <div class="inspector-role">${icon ? `<img src="${esc(icon)}" alt="" width="22" height="22">` : ''}<small>${esc(node.role ?? 'Address')}</small></div>
      <code class="mono">${esc(node.address)}</code>
      ${node.members ? `<details><summary>Member addresses</summary><p class="mono">${node.members.map(id => esc(data.addresses.find(item => item.id === id)?.address)).join('<br>')}</p></details>` : ''}
      ${tokenRows ? `<div class="report-table"><table aria-label="Token flows and balances"><thead>
        <tr><th>Token</th><th>In</th><th>Out</th><th>Balance</th><th>USD</th></tr></thead><tbody>${tokenRows}</tbody></table></div>` : ''}
      ${snapshotRecords.length ? `<details><summary>Balance sources</summary><ul>${snapshotRecords.map(item =>
        `<li>${esc(item.asset)} · ${esc(item.time)} · ${esc(item.source)}</li>`).join('')}</ul></details>`
        : '<p class="subtle">No balance snapshot available</p>'}
      ${balanceRows.some(item => item.prices.length && item.prices.length < item.snapshots) ? '<p class="subtle">* Partial USD coverage</p>' : ''}
      <label>Name<input data-name="${esc(node.id)}" value="${esc(node.name)}"></label>
      <label>Node note<textarea data-note="${esc(node.id)}">${esc(history.value.notes[node.id])}</textarea></label>
      ${colorControls({ type: 'node', id: node.id }, displayColor(history.value, 'node', node))}
      <div class="actions"><button data-direction="in">${hidden.has(node.id + ':in') ? 'Expand' : 'Collapse'} inflow</button><button data-direction="out">${hidden.has(node.id + ':out') ? 'Expand' : 'Collapse'} outflow</button></div>
      <div class="actions"><button data-neighbors>Filter to selection</button>${node.members ? '<button data-members>Edit members</button><button data-ungroup>Ungroup</button>'
        : '<button data-group>Assign to entity</button><button data-link>Add relationship</button>'}</div>
      <div class="actions"><button data-edit-card="${esc(node.id)}">Edit node</button><button data-open-layers>Add to layer</button></div>
      ${adjacent.length ? `<details open><summary>Adjacent paths · ${adjacent.length}</summary><div class="inspector-paths">
        ${adjacent.slice(0, 8).map(path).join('')}</div>${adjacent.length > 8 ? '<small>Showing the first 8 paths. Filter to selection to explore all paths on the canvas.</small>' : ''}</details>` : ''}
      ${related.length ? `<details data-related ${relatedOpen ? 'open' : ''}><summary>Related transfers · ${related.length}</summary>${eventRows(related)}</details>` : ''}
    </div>`
  }
  if (edge) {
    const priced = edge.events.flatMap(item => item.usd === undefined ? [] : [item.usd])
    const usd = priced.length ? '$' + sumDecimal(priced) + ' · ' + priced.length + '/' + edge.events.length + ' priced' : 'No valuation'
    panel.innerHTML = `<div class="section-heading"><h3>${edge.asset ? 'Transaction details' : 'Relationship'}</h3>${close}</div><div class="stack">
      <div>${esc(view.nodes.find(node => node.id === edge.source)?.name)} → ${esc(view.nodes.find(node => node.id === edge.target)?.name)}</div>
      ${edge.asset ? `<div class="subtle">${esc(edge.amount)} ${esc(edge.asset)} · ${edge.events.length} transfers<br>USD ${esc(usd)}</div>` : ''}
      <label>Edge note<textarea data-note="${esc(edge.id)}">${esc(history.value.notes[edge.id] ?? edge.note)}</textarea></label>
      ${colorControls({ type: 'edge', id: edge.id }, displayColor(history.value, 'edge', edge))}
      ${!filters.pair && edge.source !== edge.target ? '<button data-focus-pair>Focus address pair</button>' : ''}
      <button data-open-layers>Add to layer</button>
      ${eventRows(edge.events)}</div>`
  }
}

function findReference(reference: string) {
  return evidence.get(reference)
}

async function locate(reference: string) {
  revealed = reference
  await render()
  const item = findReference(reference)
  const edge = item && view.edges.find(edge => edge.events.some(event => event.id === item.id))
  const directEdge = view.edges.find(edge => edge.id === reference)
  const node = view.nodes.find(node => node.id === reference || node.members?.includes(reference))
  if (!edge && !directEdge && !node) {
    status('No matching object in this case')
    return
  }
  selection = edge || directEdge ? { type: 'edge', id: (edge ?? directEdge)!.id } : { type: 'node', id: node!.id }
  boxed.clear()
  page = edge && item ? Math.floor(edge.events.indexOf(item) / 8) : 0
  await render(false, selection.id)
}

const refsMarkup = (refs: string[]) => refs.map(ref => `<button class="ref" data-focus="${esc(ref)}">${esc(ref)}</button>`).join(' ')

function renderReport() {
  const chapters = (data.chapters ?? []).map(chapter => {
    const conclusion = conclusionFor(chapter, history.value)
    return `<article>
      <h3>${esc(chapter.title)}</h3><p>${esc(conclusion.text)}</p>
      ${conclusion.revision ? `<small>Conclusion version ${conclusion.revision}</small>` : ''}
      ${chapter.paragraphs?.length || chapter.tables?.length ? `<details data-chapter="${esc(chapter.id)}"><summary>Text and tables</summary><div></div></details>` : ''}
      <div class="actions">${refsMarkup(conclusion.refs.slice(0, 8))}</div>
      ${conclusion.refs.length > 8 ? `<details data-chapter-refs="${esc(chapter.id)}"><summary>More references (${conclusion.refs.length - 8})</summary><div class="actions"></div></details>` : ''}
    </article>`
  }).join('')
  const rows = evidence.timeline.slice(timelinePage * 25, (timelinePage + 1) * 25).map(item =>
    `<tr><td>${esc(item.time.slice(0, 19).replace('T', ' '))}</td><td>${esc(item.amount + ' ' + item.asset)}</td><td>${refsMarkup([item.evidence ?? item.id])}</td></tr>`).join('')
  const timeline = rows
    ? `<div class="report-table"><table><thead><tr><th>Time UTC</th><th>Amount</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="actions"><button data-timeline="-1" ${timelinePage ? '' : 'disabled'}>Previous</button>
      <small>${timelinePage + 1} / ${Math.ceil(evidence.timeline.length / 25)}</small>
      <button data-timeline="1" ${(timelinePage + 1) * 25 >= evidence.timeline.length ? 'disabled' : ''}>Next</button></div>`
    : '<p class="subtle">No transactions</p>'
  const sources = data.reportSources?.map(([title, items]) =>
    `<h3>${esc(title)}</h3><ul>${items.map(item => `<li>${/^https?:\/\//.test(item)
      ? `<a href="${esc(item)}" target="_blank" rel="noreferrer">${esc(item)}</a>` : esc(item)}</li>`).join('')}</ul>`).join('')
  const drafts = history.value.drafts.map(draft => `<article><h3>Investigation draft</h3><p>${esc(draft.text)}</p>
    <div class="actions">${refsMarkup(draft.refs)}<button data-edit-draft="${esc(draft.id)}">Edit draft</button>
    ${draft.chapter ? `<button data-review-draft="${esc(draft.id)}">Review conclusion</button>` : ''}</div></article>`).join('')
  const editor = draftEditor ? `<form id="draft-form" class="stack">
    <label>Target chapter<select id="draft-chapter"><option value="">Investigation draft</option>${(data.chapters ?? [])
      .map(item => `<option value="${esc(item.id)}" ${item.id === draftEditor?.chapter ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select></label>
    <label>Draft<textarea id="draft-text" aria-label="Draft" required>${esc(draftEditor.text)}</textarea></label>
    <label>References (one per line)<textarea id="draft-refs" aria-label="References (one per line)">${esc(draftEditor.refs.join('\n'))}</textarea></label>
    <button>Save draft</button><output id="draft-error" role="alert"></output></form>` : ''
  const current = review ? conclusionFor(data.chapters?.find(item => item.id === review?.draft.chapter), history.value) : undefined
  const comparison = review && current ? `<article class="review stack"><h3>Conclusion review</h3>
    <div><small>Current · version ${review.revision}</small><p>${esc(current.text)}</p><div class="actions">${refsMarkup(current.refs.slice(0, 8))}</div></div>
    <div><small>Proposed</small><p>${esc(review.draft.text)}</p><div class="actions">${refsMarkup(review.draft.refs)}</div></div>
    <div class="actions"><button data-publish>Publish</button><button data-cancel-review>Cancel</button></div></article>` : ''
  const panel = $('report-content')
  panel.innerHTML = `<nav class="actions report-tabs" aria-label="Report view">
    <button data-report-mode="chapters" aria-pressed="${reportMode === 'chapters'}">Chapters</button>
    <button data-report-mode="timeline" aria-pressed="${reportMode === 'timeline'}">Timeline</button></nav>`
    + comparison + editor + (reportMode === 'chapters'
      ? drafts + (chapters || '<p class="subtle">No report chapters</p>') + (sources ? `<details><summary>Report sources</summary>${sources}</details>` : '')
      : timeline)
  panel.querySelectorAll<HTMLDetailsElement>('details[data-chapter], details[data-chapter-refs]').forEach(details => {
    details.addEventListener('toggle', () => {
      if (!details.open) return
      const body = details.querySelector('div')!
      if (body.hasChildNodes()) return
      const chapter = data.chapters?.find(item => item.id === (details.dataset.chapter ?? details.dataset.chapterRefs))
      if (!chapter) return
      body.innerHTML = details.dataset.chapterRefs ? refsMarkup(conclusionFor(chapter, history.value).refs.slice(8))
        : (chapter.paragraphs ?? []).map(text => `<p>${esc(text)}</p>`).join('')
          + (chapter.tables ?? []).map(rows => `<div class="report-table"><table><tbody>${rows
            .map((row, index) => `<tr>${row.map(cell => index ? `<td>${esc(cell)}</td>` : `<th>${esc(cell)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')
    })
  })
}

function reportEvidence(reference: string) {
  const panel = $('report')
  setReportOpen(true)
  panel.querySelector('#report-evidence')?.remove()
  const item = findReference(reference)
  if (!item) return
  $('report-content').insertAdjacentHTML('afterbegin',
    `<article id="report-evidence" class="flash"><h3>${item.evidence ? 'Evidence ' + esc(item.evidence) : 'Transaction source'}</h3>
      <p>${esc(item.amount)} ${esc(item.asset)} · ${esc(item.time)}</p><code class="mono">${esc(item.hash)}</code>
      <p>${esc(item.sources?.join(' · ') || 'Source unavailable')}${item.verification ? ' · ' + esc(item.verification) : ''}</p>
      ${refsMarkup([item.evidence ?? item.id])}</article>`)
  panel.scrollTop = 0
}

function renderAgentContext() {
  const context = $('agent-context')
  if (!context) return
  context.textContent = selection ? (view.nodes.find(item => item.id === selection?.id)?.name
    ?? view.edges.find(item => item.id === selection?.id)?.events[0]?.evidence ?? 'Selected transaction')
    : boxed.size ? boxed.size + ' selected nodes' : 'No selection'
}

function applyFilters(fit = true) {
  filters = { ...filters, asset: value('asset') || undefined, address: value('address-filter') || undefined,
    from: value('from') || undefined, to: value('to') || undefined,
    includeContext: $<HTMLInputElement>('include-context').checked ? undefined : false }
  revealed = undefined
  void render(fit)
}

function showPopover(name: 'layout' | 'layers', open: boolean) {
  if (open) showPopover(name === 'layout' ? 'layers' : 'layout', false)
  $(name + '-panel').hidden = !open
  $(name + '-toggle').setAttribute('aria-expanded', String(open))
  if (open && name === 'layers') renderLayers()
  if (!open && name === 'layers') layerTransaction = undefined
}

function showNodeEditor(id: string) {
  const node = view.nodes.find(item => item.id === id)
  if (!node) return
  const form = $<HTMLFormElement>('node-form')
  const name = form.elements.namedItem('name') as HTMLInputElement
  const note = form.elements.namedItem('note') as HTMLTextAreaElement
  editingNode = id
  $('node-editor-address').textContent = node.address
  name.value = node.name
  note.value = history.value.notes[id] ?? ''
  $<HTMLDialogElement>('node-editor').showModal()
}

$<HTMLFormElement>('node-form').onsubmit = event => {
  event.preventDefault()
  if (!editingNode) return
  const id = editingNode
  const fields = new FormData(event.target as HTMLFormElement)
  const name = String(fields.get('name')).trim()
  if (!name) return
  edit(edits => {
    edits.names[id] = name
    edits.notes[id] = String(fields.get('note'))
  })
  updateAddresses()
  $<HTMLDialogElement>('node-editor').close()
}
$('node-edit-cancel').onclick = () => $<HTMLDialogElement>('node-editor').close()
$('node-editor').addEventListener('close', () => { editingNode = undefined })

function setBoxMode(active: boolean) {
  const surface = $('box-surface')
  if (marquee && surface.hasPointerCapture(marquee.pointer)) surface.releasePointerCapture(marquee.pointer)
  marquee = undefined
  $('box-marquee').hidden = true
  surface.hidden = !active
  $('box-select').setAttribute('aria-pressed', String(active))
}

function boxBounds(start: Point, end: Point) {
  return { left: Math.min(start[0], end[0]), right: Math.max(start[0], end[0]),
    top: Math.min(start[1], end[1]), bottom: Math.max(start[1], end[1]) }
}

const boxSurface = $('box-surface')
boxSurface.onpointerdown = event => {
  if (event.button !== 0 || marquee) return
  marquee = { pointer: event.pointerId, start: [event.clientX, event.clientY] }
  boxSurface.setPointerCapture(event.pointerId)
}
boxSurface.onpointermove = event => {
  if (marquee?.pointer !== event.pointerId) return
  const bounds = boxBounds(marquee.start, [event.clientX, event.clientY])
  const surface = boxSurface.getBoundingClientRect()
  const box = $('box-marquee')
  box.hidden = false
  box.style.left = bounds.left - surface.left + 'px'
  box.style.top = bounds.top - surface.top + 'px'
  box.style.width = bounds.right - bounds.left + 'px'
  box.style.height = bounds.bottom - bounds.top + 'px'
}
boxSurface.onpointerup = event => {
  if (marquee?.pointer !== event.pointerId) return
  const client: Point = [event.clientX, event.clientY]
  const start = marquee.start
  const drag = Math.hypot(client[0] - start[0], client[1] - start[1]) >= 4
  const [startX, startY] = graph.getCanvasByClient(start)
  const [endX, endY] = graph.getCanvasByClient(client)
  const bounds = boxBounds([startX, startY], [endX, endY])
  boxed = new Set(drag ? view.nodes.filter(node => {
    const [x, y] = drawing.positions[node.id]
    return x - NODE_WIDTH / 2 <= bounds.right && x + NODE_WIDTH / 2 >= bounds.left &&
      y - NODE_HEIGHT / 2 <= bounds.bottom && y + NODE_HEIGHT / 2 >= bounds.top
  }).map(node => node.id) : [])
  selection = undefined
  revealed = undefined
  setBoxMode(false)
  keepPositions = true
  void render()
}
boxSurface.onpointercancel = () => setBoxMode(false)
$('box-select').onclick = () => {
  if (linking) exitLinkMode()
  showPopover('layers', false)
  showPopover('layout', false)
  setBoxMode(boxSurface.hidden)
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !boxSurface.hidden) setBoxMode(false)
})

const layoutForm = $<HTMLFormElement>('layout-panel')
function syncLayout() {
  const values = layoutSettings(history.value.layout)
  for (const key of Object.keys(values) as (keyof LayoutSettings)[]) {
    const input = layoutForm.elements.namedItem(key) as HTMLInputElement
    input.min = String(LAYOUT_LIMITS[key].min)
    input.max = String(LAYOUT_LIMITS[key].max)
    input.value = String(values[key])
  }
}
function applyCanvasLayout(settings: Partial<LayoutSettings>) {
  const next = layoutSettings({ ...history.value.layout, ...settings })
  edit(edits => { edits.layout = next })
  syncLayout()
  return next
}
layoutForm.onsubmit = event => {
  event.preventDefault()
  const fields = new FormData(layoutForm)
  applyCanvasLayout({ rowGap: Number(fields.get('rowGap')), columnGap: Number(fields.get('columnGap')),
    maxRows: Number(fields.get('maxRows')) })
  showPopover('layout', false)
  void render(true)
}
$('layout-reset').onclick = () => {
  applyCanvasLayout(layoutSettings())
  void render(true)
}
$('layout-toggle').onclick = () => showPopover('layout', layoutForm.hidden)

function selectionRefs(): string[] {
  if (layerTransaction) return [layerTransaction]
  const ids = new Set(boxed)
  if (selection?.type === 'node') ids.add(selection.id)
  const refs = new Set(view.nodes.filter(node => ids.has(node.id)).flatMap(node => node.members ?? [node.id]))
  for (const edge of view.edges) {
    if (edge.id !== selection?.id && !(boxed.has(edge.source) && boxed.has(edge.target))) continue
    for (const ref of edge.events.length ? edge.events.map(item => item.id) : [edge.id]) refs.add(ref)
  }
  return [...refs]
}

type LayerCommand =
  | { action: 'create'; name: string; refs?: string[] }
  | { action: 'assign' | 'unassign'; id: string; refs: string[] }
  | { action: 'rename'; id: string; name: string }
  | { action: 'visibility'; id: string; visible: boolean }
  | { action: 'delete'; id: string }
  | { action: 'show_unassigned'; visible: boolean }
  | { action: 'solo'; id?: string }

function changeLayer(command: LayerCommand) {
  const existing = 'id' in command ? history.value.layers?.find(layer => layer.id === command.id) : undefined
  if ('id' in command && command.id !== undefined && !existing) throw new Error('Unknown canvas layer')
  if (command.action === 'solo') {
    soloLayer = soloLayer === command.id ? undefined : command.id
    revealed = undefined
    void render(true)
    return soloLayer
  }
  const name = 'name' in command ? command.name.trim() : ''
  if ('name' in command && !name) throw new Error('Enter a layer name')
  const known = 'refs' in command && command.refs?.length ? new Set([
    ...data.addresses.map(node => node.id), ...data.transfers.map(item => item.id), ...history.value.relations.map(item => item.id),
  ]) : undefined
  const refs = 'refs' in command ? [...new Set(command.refs ?? [])] : []
  if (known && refs.some(ref => !known.has(ref))) throw new Error('Unknown layer reference')
  const created: CanvasLayer | undefined = command.action === 'create' ? { id: crypto.randomUUID(), name, refs, visible: true } : undefined
  if (command.action === 'delete' && soloLayer === command.id) soloLayer = undefined
  revealed = undefined
  edit(edits => {
    if (created) { (edits.layers ??= []).push(created); return }
    if (command.action === 'show_unassigned') { edits.showUnassigned = command.visible; return }
    if (command.action === 'delete') { edits.layers = edits.layers?.filter(layer => layer.id !== command.id); return }
    const layer = 'id' in command ? edits.layers?.find(item => item.id === command.id) : undefined
    if (!layer) return
    if (command.action === 'assign') layer.refs = [...new Set([...layer.refs, ...refs])]
    if (command.action === 'unassign') {
      const removed = new Set(refs)
      layer.refs = layer.refs.filter(ref => !removed.has(ref))
    }
    if (command.action === 'visibility') layer.visible = command.visible
    if (command.action === 'rename') layer.name = name
  })
  return created?.id
}

function renderLayers() {
  const refs = selectionRefs()
  const transfer = layerTransaction && evidence.get(layerTransaction)
  $('layer-list').innerHTML = (transfer ? `<small>Selected transfer · ${esc(transfer.evidence ?? transfer.hash)}</small>` : '') +
    `<label class="layer-visibility"><input type="checkbox" data-unassigned
    ${history.value.showUnassigned === false ? '' : 'checked'}>Unassigned objects</label>` +
    (history.value.layers ?? []).map(layer => `<div class="layer-row stack" data-layer="${esc(layer.id)}">
      <div class="layer-heading"><input type="checkbox" data-visible aria-label="Show layer ${esc(layer.name)}" ${layer.visible ? 'checked' : ''}>
      <input data-layer-name aria-label="Rename layer" value="${esc(layer.name)}" maxlength="80">
      <button data-solo aria-pressed="${soloLayer === layer.id}">Solo</button></div>
      <div class="actions"><small>${layer.refs.length} items</small><button data-assign ${refs.length ? '' : 'disabled'}>Add selection</button>
      <button data-unassign ${refs.length ? '' : 'disabled'}>Remove selection</button>
      <button data-delete-layer>Delete layer</button></div></div>`).join('')
  $<HTMLButtonElement>('new-layer-submit').textContent = refs.length ? 'New layer from selection' : 'New layer'
}

$('layers-toggle').onclick = () => showPopover('layers', $('layers-panel').hidden)
$<HTMLFormElement>('new-layer').onsubmit = event => {
  event.preventDefault()
  const form = event.target as HTMLFormElement
  const name = String(new FormData(form).get('name')).trim()
  if (!name) return
  changeLayer({ action: 'create', name, refs: selectionRefs() })
  form.reset()
}
$('layer-list').onchange = event => {
  const input = event.target as HTMLInputElement
  const id = input.closest<HTMLElement>('[data-layer]')?.dataset.layer
  if (input.hasAttribute('data-unassigned')) changeLayer({ action: 'show_unassigned', visible: input.checked })
  if (!id) return
  if (input.hasAttribute('data-visible')) changeLayer({ action: 'visibility', id, visible: input.checked })
  if (input.hasAttribute('data-layer-name')) {
    if (input.value.trim()) changeLayer({ action: 'rename', id, name: input.value })
    else renderLayers()
  }
}
$('layer-list').onclick = event => {
  const button = (event.target as HTMLElement).closest('button')
  const id = button?.closest<HTMLElement>('[data-layer]')?.dataset.layer
  if (!button || !id) return
  if (button.hasAttribute('data-solo')) changeLayer({ action: 'solo', id })
  if (button.hasAttribute('data-assign')) changeLayer({ action: 'assign', id, refs: selectionRefs() })
  if (button.hasAttribute('data-unassign')) changeLayer({ action: 'unassign', id, refs: selectionRefs() })
  if (button.hasAttribute('data-delete-layer')) changeLayer({ action: 'delete', id })
}

for (const id of ['asset', 'include-context', 'from', 'to', 'address-filter']) $(id).addEventListener('change', () => applyFilters())
$('scope-options').onclick = event => {
  const id = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-scope]')?.dataset.scope
  if (!id) return
  filters = { ...filters, core: id === 'core', viewId: id === 'all' || id === 'core' ? undefined : id }
  hidden.clear()
  syncScopes()
  applyFilters()
}
$('scopes-toggle').onclick = () => setScopesOpen($('scope-panel').hidden)
$('reset').onclick = () => {
  for (const id of ['asset', 'from', 'to', 'search', 'address-filter']) $<HTMLInputElement>(id).value = ''
  $('results').hidden = true
  $<HTMLInputElement>('include-context').checked = true
  hidden.clear()
  delete filters.pair
  applyFilters()
}
$('exit-pair').onclick = () => {
  delete filters.pair
  revealed = undefined
  void render(true)
}
async function newChart() {
  const blank: CaseData = { id: crypto.randomUUID(), title: 'Ethereum investigation', addresses: [], transfers: [],
    chapters: [{ id: 'findings', title: 'Findings', text: '', refs: [] }] }
  try {
    await saveCase(blank)
    await navigate(chartRoute(blank.id))
    if (activeCase && data.id === blank.id) $('add-seed').click()
  } catch (error) {
    showWorkspaceError(error)
  }
}
$('new-case').onclick = newChart
$('back-charts').onclick = () => { void navigate('#charts') }
$('add-seed').onclick = () => {
  setAgentOpen(true)
  $<HTMLDetailsElement>('collect-controls').open = true
  $('agent-seed').focus()
}
$('connect').onclick = () => {
  if (linking) {
    exitLinkMode()
    void render()
    return
  }
  linking = true
  linkSource = selection?.type === 'node' ? selection.id : undefined
  $('connect').setAttribute('aria-pressed', 'true')
  updateLinkStatus()
  void render()
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && linking) {
    exitLinkMode()
    void render()
  }
})
$('import').onclick = () => $('case-file').click()
$('case-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement
  try {
    const files = [...(input.files ?? [])]
    if (!files.length) return
    const payloads = await Promise.all(files.map(async file => JSON.parse(await file.text())))
    const raw = payloads.find(item => item && (Array.isArray(item.addresses) && Array.isArray(item.transfers)
      || Array.isArray(item.nodes) && Array.isArray(item.events)))
    const report = payloads.find(item => item !== raw && Array.isArray(item?.chapters))
    const importedReport = report && importLocalReport(report)
    const next = importCase(raw, importedReport?.chapters)
    if (importedReport) next.reportSources = importedReport.sources
    await saveCase(next)
    await navigate(chartRoute(next.id))
  } catch (error) {
    showWorkspaceError(error)
  } finally {
    input.value = ''
  }
})
$('case-title').addEventListener('change', () => edit(edits => { edits.title = value('case-title').trim() || data.title }))
function restore() {
  persist()
  updateAddresses()
  $<HTMLInputElement>('case-title').value = history.value.title ?? data.title
  renderReport()
  syncLayout()
  void render()
}
$('undo').onclick = () => { history.undo(); restore() }
$('redo').onclick = () => { history.redo(); restore() }
$('grouped').onclick = () => {
  grouped = !grouped
  delete filters.pair
  $('grouped').setAttribute('aria-pressed', String(grouped))
  void render(true)
}
$('fit').onclick = () => { void graph.fitView().then(updateHandle) }
$('zoom-in').onclick = () => { void graph.zoomBy(1.25).then(updateHandle) }
$('zoom-out').onclick = () => { void graph.zoomBy(.8).then(updateHandle) }
function setReportOpen(open: boolean) {
  const toggle = $('report-toggle')
  toggle.setAttribute('aria-pressed', String(open))
  toggle.setAttribute('aria-expanded', String(open))
  toggle.setAttribute('aria-label', open ? 'Collapse report' : 'Expand report')
  $('report').inert = !open
  document.querySelector('.workspace')!.setAttribute('data-report', open ? 'open' : 'closed')
}
$('report-toggle').onclick = () => setReportOpen($('report-toggle').getAttribute('aria-expanded') !== 'true')
$('search').addEventListener('input', () => {
  const query = value('search').trim().toLowerCase()
  const results = $('results')
  results.hidden = !query
  if (!query) return
  const matches = [...data.addresses.filter(item => [item.name, item.address, history.value.names[item.id]].some(value => value?.toLowerCase().includes(query)))
    .slice(0, 8).map(item => [item.id, (history.value.names[item.id] ?? item.name) + ' · ' + item.address]),
  ...data.transfers.filter(item => item.hash.toLowerCase().includes(query) || item.evidence?.toLowerCase() === query)
    .slice(0, 8).map(item => [item.id, item.hash])]
  results.innerHTML = matches.map(([key, label]) => `<button data-focus="${esc(key)}">${esc(label)}</button>`).join('')
    || '<span class="subtle">No matches</span>'
})
$('selection').addEventListener('change', event => {
  const input = event.target as HTMLInputElement
  if (input.hasAttribute('data-element-color') && selection) {
    const item = selection
    const key = colorKey(item)
    colorPreview = undefined
    if (history.value[key]?.[item.id] !== input.value) {
      history.change(edits => { edits[key] = { ...edits[key], [item.id]: input.value } })
      persist()
    }
    $('selection').querySelector<HTMLButtonElement>('[data-reset-color]')!.disabled = false
    void render(false, undefined, false)
  }
  if (input.dataset.name) {
    edit(edits => { edits.names[input.dataset.name!] = input.value.trim()
      || data.addresses.find(item => item.id === input.dataset.name)?.name
      || edits.entities.find(item => item.id === input.dataset.name)?.name || 'Address' })
    updateAddresses()
  }
  if (input.dataset.note) {
    // Keep other fields editable if the user tabs directly to a second field.
    history.change(edits => { edits.notes[input.dataset.note!] = input.value })
    persist()
    void render(false, undefined, false)
  }
})
$('selection').addEventListener('input', event => {
  const input = event.target as HTMLInputElement
  if (!selection || !input.hasAttribute('data-element-color')) return
  const preview = { item: selection, color: input.value }
  colorPreview = preview
  queue = queue.then(async () => {
    if (!activeCase || colorPreview !== preview || selection !== preview.item) return
    const { id, type } = preview.item
    if (type === 'node') graph.updateNodeData([{ id, style: nodeColorStyle(preview.color) }])
    else graph.updateEdgeData([{ id, style: edgeColorStyle(preview.color) }])
    await graph.draw()
  }).catch(error => status(error instanceof Error ? error.message : String(error)))
})

document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button')
  if (!button) return
  if (button.hasAttribute('data-reset-color') && selection) {
    const item = selection
    colorPreview = undefined
    edit(edits => { delete edits[colorKey(item)]?.[item.id] })
  }
  if (button.dataset.focus) {
    $('results').hidden = true
    void locate(button.dataset.focus)
  }
  if (button.hasAttribute('data-return-view')) {
    revealed = undefined
    setSelection()
  }
  if (button.dataset.reportMode) {
    reportMode = button.dataset.reportMode === 'timeline' ? 'timeline' : 'chapters'
    renderReport()
  }
  if (button.dataset.timeline) {
    timelinePage += Number(button.dataset.timeline)
    renderReport()
  }
  if (button.dataset.editDraft) {
    draftEditor = history.value.drafts.find(draft => draft.id === button.dataset.editDraft)
    renderReport()
  }
  if (button.dataset.reviewDraft) {
    const draft = history.value.drafts.find(item => item.id === button.dataset.reviewDraft)
    if (draft) {
      review = { draft, revision: conclusionFor(data.chapters?.find(item => item.id === draft.chapter), history.value).revision }
      renderReport()
    }
  }
  if (button.hasAttribute('data-publish') && review) {
    const proposal = review
    try {
      edit(edits => publishConclusion(edits, proposal.draft, data, proposal.revision, new Date().toISOString()))
      review = undefined
      renderReport()
    } catch (error) {
      status(error instanceof Error ? error.message : String(error))
    }
  }
  if (button.hasAttribute('data-cancel-review')) {
    review = undefined
    renderReport()
  }
  if (button.dataset.report) reportEvidence(button.dataset.report)
  if (button.dataset.editCard) showNodeEditor(button.dataset.editCard)
  if (button.hasAttribute('data-open-layers') || button.dataset.layerEvent) {
    layerTransaction = button.dataset.layerEvent
    showPopover('layers', true)
  }
  if (button.hasAttribute('data-close')) {
    revealed = undefined
    setSelection()
  }
  if (button.dataset.page) {
    page += Number(button.dataset.page)
    renderSelection()
  }
  if (button.dataset.direction && selection) {
    toggleBranch(selection.id, button.dataset.direction === 'in' ? 'in' : 'out')
  }
  if (button.hasAttribute('data-neighbors') && selection) {
    delete filters.pair
    filters.address = selection.id
    $<HTMLSelectElement>('address-filter').value = selection.id
    revealed = undefined
    void render(true)
  }
  if (button.hasAttribute('data-focus-pair') && selection?.type === 'edge') {
    const edge = view.edges.find(item => item.id === selection?.id)
    if (edge) {
      const siblings = view.edges.filter(item =>
        item.source === edge.source && item.target === edge.target || item.source === edge.target && item.target === edge.source)
      filters.pair = [edge.source, edge.target]
      revealed = undefined
      void (siblings.length <= 24 ? render(true) : render(false, edge.id))
    }
  }
  if (button.hasAttribute('data-group') && selection) {
    const name = prompt('Entity name')?.trim()
    if (!name) return
    previewEntity(name, [selection.id])
  }
  if ((button.hasAttribute('data-members') || button.hasAttribute('data-ungroup')) && selection) {
    const entity = history.value.entities.find(item => item.id === selection?.id)
    if (entity) {
      const input = button.hasAttribute('data-ungroup') ? '' : prompt(
        'Member address IDs or full addresses, separated by commas', entity.members.join(', '))
      if (input !== null) {
        const members = input.split(',').map(value => value.trim()).filter(Boolean).map(value =>
          data.addresses.find(node => node.address.toLowerCase() === value.toLowerCase())?.id ?? value)
        try {
          previewEntity(entity.name, members, entity.id)
        } catch (error) {
          status(error instanceof Error ? error.message : String(error))
        }
      }
    }
  }
  if (button.hasAttribute('data-link') && selection) {
    const source = selection.id
    const address = prompt('Destination address')?.trim().toLowerCase()
    if (!address) return
    const target = data.addresses.find(item => item.address.toLowerCase() === address)
    if (!target) {
      status('The destination address is outside this case')
      return
    }
    const note = prompt('Relationship note')?.trim()
    if (!note) return
    if (source !== target.id) addRelationship(source, target.id, note)
  }
})

$('draft').onclick = () => {
  const edge = view.edges.find(item => item.id === selection?.id)
  const refs = edge?.events.length ? edge.events.map(item => item.evidence ?? item.id) : selection?.type === 'node' ? [selection.id] : []
  draftEditor = draftEditor ? undefined : { id: crypto.randomUUID(), text: '', refs }
  reportMode = 'chapters'
  renderReport()
}
$('report').addEventListener('submit', event => {
  if ((event.target as HTMLFormElement).id !== 'draft-form' || !draftEditor) return
  event.preventDefault()
  try {
    const saved = validateDraft({ ...draftEditor, text: value('draft-text'),
      refs: value('draft-refs').split(/\r?\n/), chapter: value('draft-chapter') || undefined }, data, history.value)
    edit(edits => {
      const index = edits.drafts.findIndex(draft => draft.id === saved.id)
      if (index === -1) edits.drafts.push(saved)
      else edits.drafts[index] = saved
    })
    draftEditor = undefined
    review = undefined
    renderReport()
  } catch (error) {
    $('draft-error').textContent = error instanceof Error ? error.message : String(error)
  }
})

$('agent-panel').innerHTML = `
  <header id="agent-titlebar" class="agent-titlebar">
    <div id="agent-grip" tabindex="0" role="group" aria-label="Move Agent panel with the arrow keys" title="Drag to move">
      <span class="agent-grip-dots" aria-hidden="true"></span><h3>Agent</h3>
    </div>
    <div class="actions">
      <button aria-label="New session (Coming soon)" title="New session · Coming soon" disabled>＋</button>
      <button aria-label="Search chart sessions (Coming soon)" title="Search chart sessions · Coming soon" disabled>⌕</button>
      <button id="agent-collapse" aria-label="Collapse panel" title="Collapse">−</button>
    </div>
  </header>
  <div class="agent-body stack">
  <div id="agent-messages" class="stack" role="log" aria-label="Agent messages"></div>
  <div id="entity-preview"></div><output id="agent-progress" aria-live="polite"></output>
  <p id="agent-context" class="subtle"></p>
  <form id="agent-chat-form" class="stack">
    <textarea id="agent-question" aria-label="Ask about this selection" placeholder="Ask about flows, balances or evidence" required></textarea>
    <div class="agent-composer-bar">
      <details id="agent-attachments" class="agent-attachments">
        <summary aria-label="Attachments">＋</summary>
        <button type="button" disabled>Add files or images · Coming soon</button>
      </details>
      <button id="agent-send" class="primary">Send</button>
    </div>
  </form>
  <details id="collect-controls"><summary>Collect from Ethereum</summary>
  <form id="agent-form" class="stack"><label>Investigation seed<input id="agent-seed" placeholder="Ethereum address or transaction hash"></label>
    <div class="actions trace-controls">
      <label>Direction<select id="trace-direction"><option value="">Seed only</option><option value="upstream">Upstream</option><option value="downstream">Downstream</option></select></label>
      <label>Hops<select id="trace-hops" disabled><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label>
    </div>
    <div class="actions"><button id="include-case" type="button">Add from case</button><button id="agent-start">Collect and plot</button><button id="agent-stop" type="button" hidden>Stop</button></div>
  </form><div class="actions agent-tools"><button id="agent-analyze" type="button">Analyze selection</button><button id="agent-draft" type="button">Draft</button></div>
  </details></div>`
enableAgentWidgetDrag($('agent-widget'), $('agent-titlebar'), $('agent-grip'), $('agent-toggle'), $('canvas-body'), $('stage'))
$('agent-toggle').onclick = () => setAgentOpen($('agent-panel').hidden)
$('agent-collapse').onclick = () => {
  setAgentOpen(false)
  $('agent-toggle').focus()
}

function loadConversation() {
  conversation = []
  try {
    const saved = localStorage.getItem('flow-agent:' + data.id)
    if (saved) conversation = JSON.parse(saved)
  } catch {
    conversation = []
  }
}

function loadAgentDraft(): string {
  try {
    return localStorage.getItem('flow-agent-draft:' + data.id) ?? ''
  } catch {
    return ''
  }
}

function saveAgentDraft(text: string) {
  try {
    if (text) localStorage.setItem('flow-agent-draft:' + data.id, text)
    else localStorage.removeItem('flow-agent-draft:' + data.id)
  } catch {
    status('Could not save the question draft')
  }
}

$('agent-question').addEventListener('input', () => saveAgentDraft(value('agent-question')))

function renderConversation() {
  const messages = $('agent-messages')
  if (!messages) return
  messages.innerHTML = conversation.slice(-8).map(item => `<div class="agent-message" data-speaker="${item.speaker ?? 'agent'}"><small>${item.speaker === 'user' ? 'You' : 'Agent'}</small><p>${esc(item.text)}</p>
    <div class="actions">${refsMarkup(item.refs.slice(0, 8))}</div></div>`).join('')
  messages.scrollTop = messages.scrollHeight
  if (!entityPreview) $('entity-preview').replaceChildren()
  updateAgentControls()
}

function message(text: string, refs: string[] = [], speaker: 'user' | 'agent' = 'agent') {
  conversation = [...conversation, { text, refs, speaker }].slice(-20)
  try { localStorage.setItem('flow-agent:' + data.id, JSON.stringify(conversation)) } catch { status('Could not save the investigation history') }
  renderConversation()
}

function updateAgentControls(progress = '') {
  $<HTMLButtonElement>('agent-start').disabled = !!investigation
  $('agent-stop').hidden = !investigation
  $('agent-progress').textContent = progress
}

function applyBatch(batch: AnalysisBatch, seed?: string): Promise<Receipt> {
  const write = analysisQueue.then(async () => {
    if (!activeCase) throw new Error('Open a chart to apply analysis')
    const current = data
    const result = applyAnalysis(current, batch)
    if (result.data === current) return result.receipt
    await updateCase(result.data, seed)
    if (!activeCase || data !== current) return result.receipt
    data = result.data
    evidence = indexEvidence(data)
    updateAssets()
    updateAddresses()
    renderReport()
    keepPositions = true
    await render(!view.nodes.length)
    app.dispatchEvent(new CustomEvent('flow:analysis', { detail: { ...result.receipt, caseId: current.id } }))
    return result.receipt
  })
  analysisQueue = write.catch(() => {})
  return write
}

function getAgentContext(): AgentContext {
  const node = selection?.type === 'node' ? view.nodes.find(item => item.id === selection?.id) : undefined
  const selectedNodes = boxed.size ? view.nodes.filter(item => boxed.has(item.id)) : undefined
  return structuredClone({ caseId: data.id, selection, node, selectedNodes, filters, transfers: selectedTransfers(),
    assets: node ? assetsByNode.get(node.id) ?? [] : [] })
}

$('agent-chat-form').addEventListener('submit', async event => {
  event.preventDefault()
  const text = value('agent-question').trim()
  const button = $<HTMLButtonElement>('agent-send')
  if (!text || button.disabled) return
  const request = ++chatRequest
  const context = getAgentContext()
  button.disabled = true
  $<HTMLTextAreaElement>('agent-question').value = ''
  saveAgentDraft('')
  message(text, [], 'user')
  try {
    const reply = agentHandler ? await agentHandler({ question: text, context, history: structuredClone(conversation) })
      : answerQuestion(text, context)
    if (request !== chatRequest) return
    if (typeof reply?.text !== 'string' || !Array.isArray(reply.refs)) throw new Error('Invalid Agent reply')
    const refs = reply.refs.filter(ref => typeof ref === 'string' && (evidence.get(ref)
      || data.addresses.some(node => node.id === ref) || history.value.entities.some(entity => entity.id === ref)))
    message(reply.text, refs)
  } catch (error) {
    if (request === chatRequest) message(error instanceof Error ? error.message : 'Agent request failed')
  } finally {
    if (request === chatRequest) button.disabled = false
  }
})

function selectedTransfers() {
  const edge = view.edges.find(item => item.id === selection?.id)
  if (edge) return edge.events
  if (boxed.size) return view.edges.filter(item => boxed.has(item.source) || boxed.has(item.target)).flatMap(item => item.events)
  if (!selection) return view.edges.flatMap(item => item.events)
  return view.edges.filter(item => item.source === selection?.id || item.target === selection?.id).flatMap(item => item.events)
}

function includeFromCase(input: string) {
  const query = input.trim()
  if (!query) throw new Error('Enter an address, transaction hash or evidence ID')
  const id = query.toLowerCase()
  const address = data.addresses.find(item => item.id === query || item.address.toLowerCase() === id)
  const hits = data.transfers.filter(item => item.hash.toLowerCase() === id)
  const evidenceItem = evidence.get(query)
  const refs = address ? [address.id] : hits.length ? hits.map(item => item.id) : evidenceItem ? [evidenceItem.id] : []
  if (!refs.length) throw new Error('No matching records in this case')
  edit(edits => { edits.included = [...new Set([...(edits.included ?? []), ...refs])] })
  return refs
}

$('include-case').onclick = () => {
  try {
    includeFromCase(value('agent-seed'))
  } catch (error) {
    updateAgentControls(error instanceof Error ? error.message : String(error))
  }
}

$('trace-direction').addEventListener('change', () => {
  $<HTMLSelectElement>('trace-hops').disabled = !value('trace-direction')
})

$('agent-form').addEventListener('submit', event => {
  event.preventDefault()
  if (investigation) return
  const seed = value('agent-seed').trim()
  const direction = value('trace-direction')
  const trace: TraceOptions | undefined = direction === 'upstream' || direction === 'downstream' ? { direction, hops: Number(value('trace-hops')) } : undefined
  void collectInvestigation(seed, trace).catch(() => {})
})

async function collectInvestigation(seed: string, trace?: TraceOptions) {
  if (!activeCase) throw new Error('Open a chart to collect transactions')
  if (investigation) throw new Error('An investigation is already running')
  if (!seed.trim()) {
    updateAgentControls('Enter an address or transaction hash')
    return
  }
  const controller = new AbortController()
  const caseId = data.id
  investigation = controller
  const found = new Map<string, CaseData['transfers'][number]>()
  try {
    const current = () => activeCase && data.id === caseId && investigation === controller
    const progress = (text: string) => { if (current()) updateAgentControls(text) }
    const publish = async (batch: Collected) => {
      controller.signal.throwIfAborted()
      if (!current()) throw new Error('The active case changed')
      if (!batch.transfers.length && !batch.addresses.length && !batch.balances?.length) return
      const receipt = await applyBatch({ schemaVersion: 1, caseId, expectedRevision: data.analysis?.revision ?? 0,
        requestId: crypto.randomUUID(), ...batch }, seed.trim())
      for (const transfer of batch.transfers) found.set(transfer.id, transfer)
      progress(`Synced revision ${receipt.revision} · ${receipt.added} new transfers`)
    }
    const result = trace ? await traceTransfers(provider.investigate, seed, trace, publish, progress, controller.signal)
      : { coverage: await provider.investigate(seed, publish, progress, controller.signal) }
    const { coverage } = result
    if (current()) message(investigationSummary([...found.values()]) + ' ' + coverage, [...found.keys()])
    return { refs: [...found.keys()], ...result }
  } catch (error) {
    if (activeCase && data.id === caseId && investigation === controller) message(controller.signal.aborted ? 'Investigation stopped. Synced records were saved.'
      : error instanceof Error ? error.message : String(error), [...found.keys()])
    throw error
  } finally {
    if (investigation === controller) {
      investigation = undefined
      updateAgentControls()
    }
  }
}
$('agent-stop').onclick = () => investigation?.abort()
$('agent-analyze').onclick = () => {
  const transfers = selectedTransfers()
  message(investigationSummary(transfers), transfers.slice(0, 30).map(item => item.evidence ?? item.id))
}
$('agent-draft').onclick = () => {
  const last = [...conversation].reverse().find(item => item.refs.length)
  const transfers = selectedTransfers()
  const text = last?.text ?? investigationSummary(transfers)
  const refs = last?.refs ?? transfers.map(item => item.evidence ?? item.id)
  const draft = validateDraft({ id: crypto.randomUUID(), text, refs }, data, history.value)
  edit(edits => { edits.drafts.push(draft) })
  reportMode = 'chapters'
  renderReport()
  if ($('report-toggle').getAttribute('aria-pressed') === 'false') $('report-toggle').click()
}

type CanvasCommand =
  | { action: 'rename' | 'note'; id: string; text: string }
  | { action: 'move'; id: string; position: Point }
  | { action: 'bend'; id: string; offset: number }
  | { action: 'rename_case'; text: string }
  | { action: 'include'; ref: string }
  | { action: 'connect'; source: string; target: string; note?: string }
  | { action: 'disconnect'; id: string }
  | { action: 'undo' | 'redo' }

function previewEntity(name: string, members: string[], replaceId?: string) {
  const existing = replaceId ? history.value.entities.find(entity => entity.id === replaceId)
    : history.value.entities.find(entity => entity.name === name.trim())
  if (replaceId && !existing) throw new Error('Unknown entity')
  const entries = members.length || !replaceId ? entityMembers(data, history.value, name, members) : []
  const removed = replaceId ? (existing?.members ?? []).filter(member => !members.includes(member)) : []
  const target = existing?.id ?? 'entity:' + crypto.randomUUID()
  entityPreview = { caseId: data.id, state: history.value, name: name.trim(),
    members: entries.map(entry => entry.id), id: target, replace: !!replaceId }
  setAgentOpen(true)
  $('entity-preview').innerHTML = `<div class="stack"><h3>Entity assignment review</h3><p>${esc(name)}</p><ul>${entries
    .map(item => `<li>${esc(item.id)} · ${esc(item.previous ?? 'Unassigned')} → ${esc(name)}</li>`).join('')}
    ${removed.map(id => `<li>${esc(id)} · ${esc(name)} → Unassigned</li>`).join('')}</ul>
    <div class="actions"><button id="entity-confirm">Confirm assignment</button><button id="entity-cancel">Cancel</button></div></div>`
  $('entity-confirm').onclick = confirmEntity
  $('entity-cancel').onclick = () => { entityPreview = undefined; $('entity-preview').replaceChildren() }
  return entries
}

function confirmEntity() {
  const proposal = entityPreview
  entityPreview = undefined
  $('entity-preview').replaceChildren()
  if (!proposal || proposal.caseId !== data.id || proposal.state !== history.value) {
    message('The canvas changed. Review the assignment again.')
    return
  }
  edit(edits => applyEntityMembership(edits, proposal.name, proposal.members, proposal.id, proposal.replace))
  if (filters.address && !data.addresses.some(node => node.id === filters.address)
    && !history.value.entities.some(item => item.id === filters.address)) filters.address = undefined
  updateAddresses()
  message('Entity assignment updated · ' + proposal.name, proposal.members)
}

Object.assign(window, {
  maliciousFlow: Object.freeze({
    apply_analysis: applyBatch,
    analysis_updates: (caseId: string, afterRevision: number) => analysisUpdates(data, caseId, afterRevision),
    collect: collectInvestigation,
    stop_collection: () => investigation?.abort(),
    get_selection: getAgentContext,
    get_layout_validation: () => structuredClone(layoutValidation),
    get_layers: () => structuredClone({ layers: history.value.layers ?? [], showUnassigned: history.value.showUnassigned !== false, soloLayer }),
    edit_layer: changeLayer,
    set_layout: applyCanvasLayout,
    show_evidence: (ref: string) => {
      const item = evidence.get(ref)
      if (!item) throw new Error('Unknown evidence reference')
      reportEvidence(item.id)
      return structuredClone(item)
    },
    set_agent_handler: (handler?: AgentHandler) => {
      if (handler !== undefined && typeof handler !== 'function') throw new Error('Invalid Agent handler')
      agentHandler = handler
    },
    set_view: async (input?: string | { ref?: string; filters?: Filters; grouped?: boolean;
      branch?: { id: string; direction: 'in' | 'out'; collapsed: boolean }; fit?: boolean; zoom?: number; pan?: Point; clearSelection?: boolean }) => {
      const ref = typeof input === 'string' ? input : input?.ref
      if (input && typeof input === 'object') {
        if (input.filters) {
          filters = { ...input.filters }
          updateAssets()
          updateAddresses()
          $<HTMLInputElement>('from').value = filters.from?.slice(0, 10) ?? ''
          $<HTMLInputElement>('to').value = filters.to?.slice(0, 10) ?? ''
          syncScopes()
          revealed = undefined
        }
        if (input.grouped !== undefined) {
          if (grouped !== input.grouped && !input.filters) delete filters.pair
          grouped = input.grouped
          $('grouped').setAttribute('aria-pressed', String(grouped))
        }
        if (input.branch) {
          const key = input.branch.id + ':' + input.branch.direction
          if (input.branch.collapsed) hidden.add(key)
          else hidden.delete(key)
          revealed = undefined
        }
        if (input.clearSelection) {
          selection = undefined
          boxed.clear()
          revealed = undefined
        }
        await render(input.fit)
        if (input.zoom !== undefined && Number.isFinite(input.zoom)) await graph.zoomTo(input.zoom)
        if (input.pan?.length === 2 && input.pan.every(Number.isFinite)) await graph.translateBy(input.pan)
        updateHandle()
      }
      if (ref) await locate(ref)
      return { caseId: data.id, revision: data.analysis?.revision ?? 0, selection: selection && { ...selection }, filters: { ...filters },
        selectedNodes: [...boxed], layout: layoutSettings(history.value.layout), soloLayer,
        visibleNodes: view.nodes.length, visibleTransfers: view.count, grouped, edgeLabels: 'on', zoom: graph.getZoom() }
    },
    edit_canvas: (command: CanvasCommand) => {
      if (command.action === 'undo' || command.action === 'redo') {
        history[command.action]()
        restore()
        return
      }
      if (command.action === 'rename_case') {
        edit(edits => { edits.title = command.text.trim() || data.title })
        $<HTMLInputElement>('case-title').value = history.value.title!
        return
      }
      if (command.action === 'include') return includeFromCase(command.ref)
      if (command.action === 'connect') return addRelationship(command.source, command.target, command.note)
      if (command.action === 'disconnect') {
        if (!history.value.relations.some(item => item.id === command.id)) throw new Error('Unknown relationship')
        edit(edits => { edits.relations = edits.relations.filter(item => item.id !== command.id) })
        return
      }
      if (!('id' in command)) throw new Error('Invalid command')
      const node = view.nodes.find(item => item.id === command.id)
      const edge = view.edges.find(item => item.id === command.id)
      const event = evidence.get(command.id)
      if (command.action === 'rename' && node) edit(edits => { edits.names[node.id] = command.text.trim() })
      else if (command.action === 'note' && (node || edge || event)) edit(edits => { edits.notes[event?.id ?? command.id] = command.text })
      else if (command.action === 'move' && node && command.position?.length === 2 && command.position.every(Number.isFinite)) {
        edit(edits => { edits.positions[node.id] = [...command.position] })
      } else if (command.action === 'bend' && edge && Number.isFinite(command.offset)) edit(edits => { edits.bends[edge.id] = command.offset })
      else throw new Error('Invalid command or target')
    },
    edit_entity: (input: { name: string; members: string[]; replaceId?: string }) => previewEntity(input.name, input.members, input.replaceId),
    edit_report: (input: Omit<Draft, 'id'>) => {
      const draft = validateDraft({ ...input, id: crypto.randomUUID() }, data, history.value)
      edit(edits => { edits.drafts.push(draft) })
      renderReport()
      return { id: draft.id, refs: draft.refs }
    },
  }),
})

graph.on('aftertransform', updateHandle)
let dragging: { id: string; axis: 0 | 1; start: number; pointerId: number } | undefined
const handle = $('handle')
handle.onpointerdown = event => {
  if (selection?.type !== 'edge') return
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  const axis = handle.dataset.axis === 'x' ? 0 : 1
  dragging = { id: selection.id, axis, pointerId: event.pointerId, start: graph.getCanvasByClient([event.clientX, event.clientY])[axis] }
}
handle.onpointerup = event => {
  if (!dragging || dragging.pointerId !== event.pointerId) return
  const { id, axis, start } = dragging
  dragging = undefined
  const distance = graph.getCanvasByClient([event.clientX, event.clientY])[axis] - start
  if (Math.abs(distance) > 1) edit(edits => { edits.bends[id] = (edits.bends[id] ?? 0) + distance })
}
function cancelDrag() {
  const pointerId = dragging?.pointerId
  dragging = undefined
  if (pointerId !== undefined && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
}

handle.onpointercancel = cancelDrag
handle.onlostpointercapture = cancelDrag
window.addEventListener('blur', cancelDrag)
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') cancelDrag()
})

const chartsHome = createChartsHome($('charts-home'), {
  open: id => { void navigate(chartRoute(id)) },
  openDemo: () => { void navigate(chartRoute(demo.id)) },
  create: () => { void newChart() },
  importCase: () => $('case-file').click(),
})

function showWorkspaceError(error: unknown) {
  if ($('chart-screen').hidden) chartsHome.showError(error)
  else status(error instanceof Error ? error.message : String(error))
}

function readKuCoinArchive(payload: { graph: unknown; report: Parameters<typeof importLocalReport>[0] }) {
  const report = importLocalReport(payload.report)
  const imported = importCase(payload.graph, report.chapters)
  if (imported.id !== KUCOIN_CASE_ID) throw new Error('Invalid KuCoin archive')
  imported.reportSources = report.sources
  return imported
}

let workspaceRecovery: Promise<boolean> | undefined

function recoverWorkspaceKuCoin() {
  return workspaceRecovery ??= (async () => {
    if (location.protocol === 'file:' || document.getElementById('embedded-case')) return false
    if (!await canRestoreCase(KUCOIN_CASE_ID)) return false
    const response = await fetch(import.meta.env.BASE_URL + `cases/${KUCOIN_CASE_ID}.json`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return false
    return restoreCase(readKuCoinArchive(await response.json()))
  })()
}

function showHome() {
  $('chart-screen').hidden = true
  $('charts-home').hidden = false
  const recovery = recoverWorkspaceKuCoin()
  return chartsHome.refresh(recovery)
}

async function routeWorkspace(focusHome = false) {
  const request = ++routeRequest
  activeCase = false
  investigation?.abort()
  investigation = undefined
  chatRequest++
  await analysisQueue
  if (request !== routeRequest) return
  const route = location.hash.match(/^#chart\/(.+)$/)
  if (!route) {
    const loading = showHome()
    if (focusHome) chartsHome.focus()
    return loading
  }
  try {
    const id = decodeURIComponent(route[1])
    let record = await loadChart(id)
    if (!record && id === demo.id) {
      await saveCase(demo)
      record = await loadChart(id)
    }
    if (!record && id === KUCOIN_CASE_ID && await recoverWorkspaceKuCoin()) record = await loadChart(id)
    if (request !== routeRequest) return
    if (!record) throw new Error('This chart does not exist in this workspace.')
    $('charts-home').hidden = true
    $('chart-screen').hidden = false
    await openCase(record.data, record.edits)
  } catch (error) {
    if (request !== routeRequest) return
    window.history.replaceState(null, '', '#charts')
    await showHome()
    if (request === routeRequest) showWorkspaceError(error)
  }
}

function navigate(hash: string) {
  if (location.hash !== hash) window.history.pushState(null, '', hash)
  return routeWorkspace(hash === '#charts')
}

window.addEventListener('popstate', () => { void routeWorkspace() })

async function loadWorkspace() {
  setReportOpen(matchMedia('(min-width: 701px)').matches)
  const embedded = document.getElementById('embedded-case')
  if (!embedded?.textContent || location.hash) return routeWorkspace()
  let imported: CaseData | undefined
  try {
    imported = readKuCoinArchive(JSON.parse(embedded.textContent))
    if (!(await loadChart(imported.id))?.data.viewColumns) await saveCase(imported)
    window.history.replaceState(null, '', chartRoute(imported.id))
    await routeWorkspace()
  } catch (error) {
    if (imported) {
      $('chart-screen').hidden = false
      await openCase(imported)
    } else await showHome()
    showWorkspaceError(error)
  }
}
void loadWorkspace()

export function canvasCoordinates(id: string): Point | undefined {
  const point = drawing.positions[id] ?? drawing.routes[id]?.label
  if (!point) return
  const [x, y] = graph.getClientByCanvas(point)
  return [x, y]
}

function inspectDrawing() {
  const states = new Map((graph.getData().nodes ?? []).map(item => [item.id, item.states]))
  return {
    nodes: view.nodes.map(node => ({
      id: node.id,
      states: states.get(node.id),
      box: [drawing.positions[node.id][0] - NODE_WIDTH / 2, drawing.positions[node.id][1] - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT],
    })),
    edges: graph.getData().edges?.map(edge => {
      const route = drawing.routes[edge.id!]
      return { id: edge.id, source: edge.source, target: edge.target, states: edge.states,
        points: route.points, path: route.path, blocked: route.blocked }
    }) ?? [],
  }
}

if (import.meta.env.DEV) Object.assign(window, { flowCanvas: { canvasCoordinates, inspectDrawing,
  elementStyle: (id: string) => {
    const { stroke, fill, endArrowFill, lineWidth, halo } = graph.getElementRenderStyle(id)
    return { stroke, fill, endArrowFill, lineWidth, halo }
  },
  transactionHandlePoint: (id: string) => graph.getClientByCanvas(drawing.routes[id].handle),
  nodeActionPoint: (id: string, offset: Point) => graph.getClientByCanvas([
    drawing.positions[id][0] + offset[0], drawing.positions[id][1] + offset[1],
  ]),
  renderedSnapshot: () => renderedSnapshot(graph, view, activeScope()) } })
