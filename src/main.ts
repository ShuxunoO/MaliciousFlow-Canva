import { History, latestBalances, project, sumDecimal } from './case'
import type { CaseData, Draft, Edits, Filters, FlowEdge, HistorySnapshot, Point } from './case'
import { applyAnalysis, applyEntityMembership, entityMembers, investigationSummary, type AnalysisBatch, type Receipt } from './investigation'
import { blockscout, type Collected } from './blockscout'
import { traceTransfers, type TraceOptions } from './trace'
import { answerQuestion, type AgentContext, type AgentHandler } from './agent-context'
import { importCase } from './import-case'
import { indexEvidence, conclusionFor, validateDraft, publishConclusion } from './report'
import { importLocalReport } from './report-import'
import { loadCase, saveCase } from './storage'
import { demo } from './demo'
import { layout, NODE_HEIGHT, NODE_WIDTH } from './layout'
import { graphData, makeGraph, renderedSnapshot, type Selection } from './renderer'
import { nodeAssets } from './node-summary'
import './style.css'

const app = document.querySelector<HTMLElement>('#app')!
app.innerHTML = `
  <header class="top">
    <div class="identity"><span class="mark" aria-hidden="true">M</span><div>
      <div class="brand">MALICIOUSFLOW</div><input id="case-title" aria-label="Canvas name">
    </div></div>
    <div class="toolbar">
      <button id="demo">Demo</button><button id="new-case">New investigation</button><button id="import">Import case</button>
      <input type="file" id="case-file" accept="application/json,.json" multiple hidden>
      <button id="undo">Undo</button><button id="redo">Redo</button><button id="report-toggle" aria-pressed="true">Report</button>
    </div>
  </header>
  <div class="workspace">
    <section class="canvas-pane" aria-label="Fund flow canvas">
      <div class="filters toolbar">
        <button id="add-seed" class="primary">+ Address / Tx</button>
        <button id="connect" aria-pressed="false">Connect</button>
        <select id="address-filter" aria-label="Address or entity"></select>
        <div style="position:relative"><input id="search" type="search" aria-label="Address, name or transaction hash" placeholder="Search address, name or hash"><div id="results" hidden></div></div>
        <select id="asset" aria-label="Token"></select><select id="scope" aria-label="Case view" hidden><option value="core">Core view</option><option value="all">All transfers</option></select>
        <label>From <input type="date" id="from" aria-label="Start date UTC"></label>
        <label>Before <input type="date" id="to" aria-label="End date UTC"></label>
        <button id="grouped" aria-pressed="false">Group by entity</button><button id="reset">Reset filters</button>
      </div>
      <div id="stage">
        <div id="graph"></div><div id="empty" hidden>No transfers match the current filters</div>
        <aside id="selection" aria-label="Selection details" hidden></aside>
        <button id="handle" aria-label="Drag transaction edge" hidden></button>
        <div id="footer"><div class="actions"><button id="zoom-in" aria-label="Zoom in">＋</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit">Fit</button></div><output id="status" aria-live="polite"></output></div>
        <section id="agent-panel" aria-label="Agent chat" hidden></section>
        <button id="agent-toggle" aria-label="Agent chat" aria-expanded="false">✦</button>
      </div>
    </section>
    <aside id="report" aria-label="Case report"><header class="report-header section-heading"><h2>Case report</h2><button id="draft">New draft</button></header><div id="report-content"></div></aside>
  </div>`

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T
const value = (id: string) => $<HTMLInputElement>(id).value
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
let data = demo
let selection: Selection | undefined
let filters: Filters = {}
let hidden = new Set<string>()
let grouped = false
let revealed: string | undefined
let page = 0
let history = History.restore(readEdits(demo.id))
let view = project(data, history.value)
let drawing = layout(view)
let assetsByNode = nodeAssets(data, view)
let queue: Promise<void> = Promise.resolve()
let draftEditor: Draft | undefined
let review: { draft: Draft; revision: number } | undefined
let evidence = indexEvidence(data)
let reportMode: 'chapters' | 'timeline' = 'chapters'
let timelinePage = 0
let openedByUser = false
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
}, () => selection, toggleBranch)
const status = (text: string) => { $('status').textContent = text }

function readEdits(id: string): Edits | HistorySnapshot | undefined {
  try {
    const value = localStorage.getItem('flow-edits:' + id)
    if (!value) return undefined
    const raw = JSON.parse(value) as Edits | HistorySnapshot | null
    if (!raw) return undefined
    if ('value' in raw) return raw.value && Array.isArray(raw.past) && Array.isArray(raw.future) ? raw : undefined
    return raw.notes && raw.names && raw.positions ? raw : undefined
  } catch {
    return undefined
  }
}

function persist() {
  try {
    localStorage.setItem('flow-edits:' + data.id, JSON.stringify(history.snapshot()))
  } catch {
    status('Local storage is full')
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
    view = project(data, history.value, filters, grouped, hidden, revealed)
    if (selection && ![...view.nodes, ...view.edges].some(item => item.id === selection?.id)) selection = undefined
    drawing = layout(view, keepPositions ? { ...drawing.positions, ...history.value.positions } : history.value.positions,
      history.value.bends, keepPositions ? drawing : undefined)
    keepPositions = false
    assetsByNode = nodeAssets(data, view, filters.to)
    graph.setData(graphData(view, drawing, history.value, assetsByNode, hidden, selection))
    await graph.render()
    if (fit && view.nodes.length) await graph.fitView()
    if (focus) {
      if (graph.getZoom() < .62) await graph.zoomTo(.62)
      await graph.focusElement(focus)
    }
    $('empty').hidden = !!view.nodes.length
    $('graph').dataset.nodes = String(view.nodes.length)
    $('graph').dataset.edges = String(view.edges.length)
    const count = (total: number, word: string) => total.toLocaleString('en-US') + ' ' + word + (total === 1 ? '' : 's')
    status([count(view.nodes.length, 'node'), count(view.edges.length, 'edge'), count(view.count, 'transfer')].join(' · '))
    if (refreshInspector) renderSelection()
    renderAgentContext()
    if (linking) updateLinkStatus()
    updateHandle()
  }).catch(error => status(error instanceof Error ? error.message : String(error)))
  return queue
}

function openCase(next: CaseData) {
  investigation?.abort()
  investigation = undefined
  chatRequest++
  data = next
  exitLinkMode()
  entityPreview = undefined
  loadConversation()
  selection = undefined
  filters = { core: !!next.core }
  grouped = false
  hidden = new Set()
  revealed = undefined
  draftEditor = undefined
  review = undefined
  evidence = indexEvidence(next)
  reportMode = 'chapters'
  timelinePage = 0
  history = History.restore(readEdits(next.id))
  $<HTMLInputElement>('case-title').value = history.value.title ?? next.title
  $('scope').hidden = !next.core
  const scopes = Object.keys(next.views ?? {}).filter(id => id !== 'core')
  $('scope').innerHTML = '<option value="core">Core view</option><option value="all">All transfers</option>' + scopes
    .map(id => `<option value="${esc(id)}">${id === 'return' ? 'Return flows' : id === 'original' ? 'Original view'
      : 'Batch ' + esc(id.replace(/^batch-/, ''))}</option>`).join('')
  $<HTMLSelectElement>('scope').value = next.core ? 'core' : 'all'
  $('grouped').setAttribute('aria-pressed', 'false')
  updateAssets()
  updateAddresses()
  $<HTMLButtonElement>('agent-send').disabled = false
  $<HTMLTextAreaElement>('agent-question').value = ''
  renderConversation()
  for (const id of ['from', 'to', 'search']) $<HTMLInputElement>(id).value = ''
  $('results').hidden = true
  renderReport()
  void render(true)
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

function eventRows(edge: FlowEdge): string {
  const entries = edge.events.slice(page * 8, (page + 1) * 8).map(item => `
    <div class="transfer stack">
      <strong>${esc(item.amount)} ${esc(item.asset)}</strong>
      <div class="subtle">${esc(item.time)}${item.usd ? ' · $' + esc(item.usd) : ''}</div>
      <code class="mono">${esc(item.hash)}</code>
      <div class="subtle">${esc(item.sources?.join(' · '))}${item.verification ? ' · ' + esc(item.verification) : ''}</div>
      <button class="ref" data-report="${esc(item.id)}">${item.evidence ? 'Evidence ' + esc(item.evidence) : 'Transaction source'}</button>
      <label>Transaction note<textarea data-note="${esc(item.id)}">${esc(history.value.notes[item.id] ?? item.note)}</textarea></label>
    </div>`).join('')
  return entries + (edge.events.length > 8
    ? `<div class="actions"><button data-page="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><small>${page + 1} / ${Math.ceil(edge.events.length / 8)}</small><button data-page="1" ${(page + 1) * 8 >= edge.events.length ? 'disabled' : ''}>Next</button></div>` : '')
}

function renderSelection() {
  const panel = $('selection')
  const node = selection?.type === 'node' ? view.nodes.find(item => item.id === selection?.id) : undefined
  const edge = selection?.type === 'edge' ? view.edges.find(item => item.id === selection?.id) : undefined
  panel.hidden = !node && !edge
  const close = (revealed ? '<button data-return-view>Return to previous view</button>' : '') + '<button data-close aria-label="Close details">×</button>'
  if (node) {
    const balanceRows = assetsByNode.get(node.id) ?? []
    const snapshotRecords = latestBalances(data, node.members ?? [node.id], filters.to)
    const totals = (rows: string[]) => rows.length ? esc(sumDecimal(rows)) : '—'
    const tokenRows = balanceRows.map(item => `<tr title="${esc(item.id)}"><th>${esc(item.symbol)}</th>
      <td>${totals(item.incoming)}</td><td>${totals(item.outgoing)}</td><td>${totals(item.balances)}</td>
      <td>${item.prices.length ? '$' + totals(item.prices) + (item.prices.length < item.snapshots ? ' *' : '') : '—'}</td></tr>`).join('')
    panel.innerHTML = `<div class="section-heading"><h3>${esc(node.name)}</h3>${close}</div><div class="stack">
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
      <div class="actions"><button data-direction="in">${hidden.has(node.id + ':in') ? 'Expand' : 'Collapse'} inflow</button><button data-direction="out">${hidden.has(node.id + ':out') ? 'Expand' : 'Collapse'} outflow</button></div>
      <div class="actions"><button data-neighbors>Filter to selection</button>${node.members ? '<button data-members>Edit members</button><button data-ungroup>Ungroup</button>'
        : '<button data-group>Assign to entity</button><button data-link>Add relationship</button>'}</div>
    </div>`
  }
  if (edge) {
    const priced = edge.events.flatMap(item => item.usd === undefined ? [] : [item.usd])
    const usd = priced.length ? '$' + sumDecimal(priced) + ' · ' + priced.length + '/' + edge.events.length + ' priced' : 'No valuation'
    panel.innerHTML = `<div class="section-heading"><h3>${edge.asset ? 'Transaction details' : 'Relationship'}</h3>${close}</div><div class="stack">
      <div>${esc(view.nodes.find(node => node.id === edge.source)?.name)} → ${esc(view.nodes.find(node => node.id === edge.target)?.name)}</div>
      ${edge.asset ? `<div class="subtle">${esc(edge.amount)} ${esc(edge.asset)} · ${edge.events.length} transfers<br>USD ${esc(usd)}</div>` : ''}
      <label>Edge note<textarea data-note="${esc(edge.id)}">${esc(history.value.notes[edge.id] ?? edge.note)}</textarea></label>
      ${eventRows(edge)}</div>`
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
  document.querySelector('.workspace')!.setAttribute('data-report', 'open')
  $('report-toggle').setAttribute('aria-pressed', 'true')
  panel.querySelector('#report-evidence')?.remove()
  const item = findReference(reference)
  if (!item) return
  $('report-content').insertAdjacentHTML('afterbegin',
    `<article id="report-evidence" class="flash"><h3>${item.evidence ? 'Evidence ' + esc(item.evidence) : 'Transaction source'}</h3>
      <p>${esc(item.amount)} ${esc(item.asset)} · ${esc(item.time)}</p><code class="mono">${esc(item.hash)}</code>
      <p>${esc(item.sources?.join(' · ') || 'Source unavailable')}${item.verification ? ' · ' + esc(item.verification) : ''}</p>
      ${refsMarkup([item.evidence ?? item.id])}</article>`)
  panel.querySelector('#report-evidence')?.scrollIntoView({ block: 'nearest' })
}

function renderAgentContext() {
  const context = $('agent-context')
  if (!context) return
  context.textContent = selection ? (view.nodes.find(item => item.id === selection?.id)?.name
    ?? view.edges.find(item => item.id === selection?.id)?.events[0]?.evidence ?? 'Selected transaction') : 'No selection'
}

function applyFilters(fit = true) {
  const scope = value('scope')
  filters = { asset: value('asset') || undefined, address: value('address-filter') || undefined, from: value('from') || undefined, to: value('to') || undefined,
    core: scope === 'core', viewId: scope === 'all' || scope === 'core' ? undefined : scope }
  revealed = undefined
  void render(fit)
}

for (const id of ['asset', 'scope', 'from', 'to', 'address-filter']) $(id).addEventListener('change', () => applyFilters())
$('reset').onclick = () => {
  for (const id of ['asset', 'from', 'to', 'search', 'address-filter']) $<HTMLInputElement>(id).value = ''
  $('results').hidden = true
  hidden.clear()
  applyFilters()
}
$('demo').onclick = () => {
  openedByUser = true
  openCase(demo)
  void saveCase().catch(() => status('Could not clear the saved case'))
}
$('new-case').onclick = () => {
  openedByUser = true
  const blank: CaseData = { id: crypto.randomUUID(), title: 'Ethereum investigation', addresses: [], transfers: [],
    chapters: [{ id: 'findings', title: 'Findings', text: '', refs: [] }] }
  openCase(blank)
  void saveCase(blank).catch(() => status('Could not save the new case'))
  $('agent-panel').hidden = false
  $('agent-toggle').setAttribute('aria-expanded', 'true')
  $<HTMLDetailsElement>('collect-controls').open = true
  $('agent-seed').focus()
}
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
    openedByUser = true
    const payloads = await Promise.all(files.map(async file => JSON.parse(await file.text())))
    const raw = payloads.find(item => item && (Array.isArray(item.addresses) && Array.isArray(item.transfers)
      || Array.isArray(item.nodes) && Array.isArray(item.events)))
    const report = payloads.find(item => item !== raw && Array.isArray(item?.chapters))
    const importedReport = report && importLocalReport(report)
    const next = importCase(raw, importedReport?.chapters)
    if (importedReport) next.reportSources = importedReport.sources
    openCase(next)
    await saveCase(next)
  } catch (error) {
    status(error instanceof Error ? error.message : String(error))
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
  void render()
}
$('undo').onclick = () => { history.undo(); restore() }
$('redo').onclick = () => { history.redo(); restore() }
$('grouped').onclick = () => {
  grouped = !grouped
  $('grouped').setAttribute('aria-pressed', String(grouped))
  void render(true)
}
$('fit').onclick = () => { void graph.fitView().then(updateHandle) }
$('zoom-in').onclick = () => { void graph.zoomBy(1.25).then(updateHandle) }
$('zoom-out').onclick = () => { void graph.zoomBy(.8).then(updateHandle) }
$('report-toggle').onclick = () => {
  const open = $('report-toggle').getAttribute('aria-pressed') !== 'true'
  $('report-toggle').setAttribute('aria-pressed', String(open))
  document.querySelector('.workspace')!.setAttribute('data-report', open ? 'open' : 'closed')
}
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

document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button')
  if (!button) return
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
    filters.address = selection.id
    $<HTMLSelectElement>('address-filter').value = selection.id
    revealed = undefined
    void render(true)
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

$('agent-panel').innerHTML = `<div class="stack"><h3>Agent</h3><p id="agent-context" class="subtle"></p>
  <form id="agent-chat-form" class="stack"><label>Ask about this selection
    <textarea id="agent-question" placeholder="Ask about flows, balances or evidence" required></textarea></label>
    <button id="agent-send">Send</button>
  </form>
  <details id="collect-controls"><summary>Collect from Ethereum</summary>
  <form id="agent-form" class="stack"><label>Investigation seed<input id="agent-seed" placeholder="Ethereum address or transaction hash"></label>
    <div class="actions trace-controls">
      <label>Direction<select id="trace-direction"><option value="">Seed only</option><option value="upstream">Upstream</option><option value="downstream">Downstream</option></select></label>
      <label>Hops<select id="trace-hops" disabled><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label>
    </div>
    <div class="actions"><button id="include-case" type="button">Add from case</button><button id="agent-start">Collect and plot</button><button id="agent-stop" type="button" hidden>Stop</button></div>
  </form></details><div class="actions"><button id="agent-analyze" type="button">Analyze selection</button><button id="agent-draft" type="button">Draft</button></div><div id="entity-preview"></div><output id="agent-progress" aria-live="polite"></output><div id="agent-messages" class="stack"></div></div>`
$('agent-toggle').onclick = () => {
  $('agent-panel').hidden = !$('agent-panel').hidden
  $('agent-toggle').setAttribute('aria-expanded', String(!$('agent-panel').hidden))
  renderAgentContext()
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

function renderConversation() {
  const messages = $('agent-messages')
  if (!messages) return
  messages.innerHTML = conversation.slice(-8).map(item => `<div class="agent-message" data-speaker="${item.speaker ?? 'agent'}"><small>${item.speaker === 'user' ? 'You' : 'Agent'}</small><p>${esc(item.text)}</p>
    <div class="actions">${refsMarkup(item.refs.slice(0, 8))}</div></div>`).join('')
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

function applyBatch(batch: AnalysisBatch): Promise<Receipt> {
  const write = analysisQueue.then(async () => {
    const current = data
    const result = applyAnalysis(current, batch)
    if (result.data === current) return result.receipt
    await saveCase(result.data)
    if (data !== current) throw new Error('The active case changed')
    data = result.data
    evidence = indexEvidence(data)
    updateAssets()
    updateAddresses()
    renderReport()
    keepPositions = true
    await render(!view.nodes.length)
    app.dispatchEvent(new CustomEvent('flow:analysis', { detail: result.receipt }))
    return result.receipt
  })
  analysisQueue = write.catch(() => {})
  return write
}

function getAgentContext(): AgentContext {
  const node = selection?.type === 'node' ? view.nodes.find(item => item.id === selection?.id) : undefined
  return structuredClone({ caseId: data.id, selection, node, filters, transfers: selectedTransfers(),
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
    const publish = async (batch: Collected) => {
      controller.signal.throwIfAborted()
      if (caseId !== data.id) throw new Error('The active case changed')
      if (!batch.transfers.length && !batch.addresses.length && !batch.balances?.length) return
      const receipt = await applyBatch({ schemaVersion: 1, caseId, expectedRevision: data.analysis?.revision ?? 0,
        requestId: crypto.randomUUID(), ...batch })
      for (const transfer of batch.transfers) found.set(transfer.id, transfer)
      updateAgentControls(`Synced revision ${receipt.revision} · ${receipt.added} new transfers`)
    }
    const result = trace ? await traceTransfers(provider.investigate, seed, trace, publish, updateAgentControls, controller.signal)
      : { coverage: await provider.investigate(seed, publish, updateAgentControls, controller.signal) }
    const { coverage } = result
    if (data.id === caseId) message(investigationSummary([...found.values()]) + ' ' + coverage, [...found.keys()])
    return { refs: [...found.keys()], ...result }
  } catch (error) {
    if (data.id === caseId) message(controller.signal.aborted ? 'Investigation stopped. Synced records were saved.'
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
    collect: collectInvestigation,
    stop_collection: () => investigation?.abort(),
    get_selection: getAgentContext,
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
          $<HTMLSelectElement>('scope').value = filters.viewId ?? (filters.core ? 'core' : 'all')
          revealed = undefined
        }
        if (input.grouped !== undefined) {
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
          revealed = undefined
        }
        await render(input.fit)
        if (input.zoom !== undefined && Number.isFinite(input.zoom)) await graph.zoomTo(input.zoom)
        if (input.pan?.length === 2 && input.pan.every(Number.isFinite)) await graph.translateBy(input.pan)
        updateHandle()
      }
      if (ref) await locate(ref)
      return { caseId: data.id, revision: data.analysis?.revision ?? 0, selection: selection && { ...selection }, filters: { ...filters },
        visibleNodes: view.nodes.length, visibleTransfers: view.count, grouped, zoom: graph.getZoom() }
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
let dragging: { id: string; axis: 0 | 1; start: number } | undefined
const handle = $('handle')
handle.onpointerdown = event => {
  if (selection?.type !== 'edge') return
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  const axis = handle.dataset.axis === 'x' ? 0 : 1
  dragging = { id: selection.id, axis, start: graph.getCanvasByClient([event.clientX, event.clientY])[axis] }
}
handle.onpointerup = event => {
  if (!dragging) return
  const { id, axis, start } = dragging
  dragging = undefined
  const distance = graph.getCanvasByClient([event.clientX, event.clientY])[axis] - start
  if (Math.abs(distance) > 1) edit(edits => { edits.bends[id] = (edits.bends[id] ?? 0) + distance })
}
handle.onpointercancel = () => { dragging = undefined }

openCase(demo)
void loadCase().then(saved => { if (saved && !openedByUser) openCase(saved) }).catch(() => {})

export function canvasCoordinates(id: string): Point | undefined {
  const point = drawing.positions[id] ?? drawing.routes[id]?.label
  if (!point) return
  const [x, y] = graph.getClientByCanvas(point)
  return [x, y]
}

function inspectDrawing() {
  return {
    nodes: view.nodes.map(node => ({
      id: node.id,
      box: [drawing.positions[node.id][0] - NODE_WIDTH / 2, drawing.positions[node.id][1] - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT],
    })),
    edges: graph.getData().edges?.map(edge => {
      const route = drawing.routes[edge.id!]
      return { id: edge.id, source: edge.source, target: edge.target, points: route.points, path: route.path, blocked: route.blocked }
    }) ?? [],
  }
}

if (import.meta.env.DEV) Object.assign(window, { flowCanvas: { canvasCoordinates, inspectDrawing, renderedSnapshot: () => renderedSnapshot(graph, view, value('scope')) } })
