import { History, latestBalances, project, sumDecimal } from './case'
import type { CaseData, Edits, Filters, FlowEdge, Point } from './case'
import { importCase } from './import-case'
import { loadCase, saveCase } from './storage'
import { demo } from './demo'
import { layout, NODE_HEIGHT, NODE_WIDTH } from './layout'
import { graphData, makeGraph, type Selection } from './renderer'
import './style.css'

const app = document.querySelector<HTMLElement>('#app')!
app.innerHTML = `
  <header class="top">
    <div class="identity"><span class="mark" aria-hidden="true">M</span><div>
      <div class="brand">MALICIOUSFLOW</div><input id="case-title" aria-label="画布名称">
    </div></div>
    <div class="toolbar">
      <button id="demo">示例</button><button id="import">导入案件</button>
      <input type="file" id="case-file" accept="application/json,.json" multiple hidden>
      <button id="undo">撤销</button><button id="redo">重做</button><button id="report-toggle" aria-pressed="true">报告</button>
    </div>
  </header>
  <div class="workspace">
    <section class="canvas-pane" aria-label="资金流画布">
      <div class="filters toolbar">
        <div style="position:relative"><input id="search" type="search" aria-label="地址、名称或交易哈希" placeholder="搜索地址、名称或哈希"><div id="results" hidden></div></div>
        <select id="asset" aria-label="代币"></select><select id="scope" aria-label="案件视图" hidden><option value="core">核心视图</option><option value="all">全量视图</option></select>
        <label>从 <input type="date" id="from" aria-label="起始日期 UTC"></label>
        <label>至 <input type="date" id="to" aria-label="结束日期 UTC"></label>
        <button id="grouped" aria-pressed="false">实体视图</button><button id="reset">清除筛选</button>
      </div>
      <div id="stage">
        <div id="graph"></div><div id="empty" hidden>当前筛选没有匹配的交易</div>
        <aside id="selection" aria-label="选中对象详情" hidden></aside>
        <button id="handle" aria-label="拖动交易线" hidden></button>
        <div id="footer"><div class="actions"><button id="zoom-in" aria-label="放大">＋</button><button id="zoom-out" aria-label="缩小">−</button><button id="fit">适配</button></div><output id="status" aria-live="polite"></output></div>
        <section id="agent-panel" aria-label="Agent 对话" hidden></section>
        <button id="agent-toggle" aria-label="Agent 对话" aria-expanded="false">✦</button>
      </div>
    </section>
    <aside id="report" aria-label="案件报告"><div class="section-heading"><h2>案件报告</h2><button id="draft">起草</button></div><div id="report-content"></div></aside>
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
let history = new History(readEdits(demo.id))
let view = project(data, history.value)
let drawing = layout(view)
let queue: Promise<void> = Promise.resolve()
let draftOpen = false
let openedByUser = false
const graph = makeGraph($('graph'), setSelection, (id, point) => edit(edits => { edits.positions[id] = point }), () => selection)
const status = (text: string) => { $('status').textContent = text }

function readEdits(id: string): Edits | undefined {
  try {
    const value = localStorage.getItem('flow-edits:' + id)
    return value ? JSON.parse(value) as Edits : undefined
  } catch {
    return undefined
  }
}

function persist() {
  try {
    localStorage.setItem('flow-edits:' + data.id, JSON.stringify(history.value))
  } catch {
    status('本地存储空间不足')
  }
}

function edit(change: (edits: Edits) => void) {
  history.change(change)
  persist()
  void render()
}

function setSelection(item?: Selection) {
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
  handle.dataset.axis = route.handle[0] === route.points[1]?.[0] ? 'x' : 'y'
}

function render(fit = false, focus?: string): Promise<void> {
  queue = queue.catch(() => {}).then(async () => {
    view = project(data, history.value, filters, grouped, hidden, revealed)
    if (selection && ![...view.nodes, ...view.edges].some(item => item.id === selection?.id)) selection = undefined
    drawing = layout(view, history.value.positions, history.value.bends)
    graph.setData(graphData(view, drawing, history.value, selection))
    await graph.render()
    if (fit && view.nodes.length) await graph.fitView()
    if (focus) {
      if (graph.getZoom() < .62) await graph.zoomTo(.62)
      await graph.focusElement(focus)
    }
    $('empty').hidden = !!view.nodes.length
    $('graph').dataset.nodes = String(view.nodes.length)
    $('graph').dataset.edges = String(view.edges.length)
    status(`${view.nodes.length.toLocaleString()} 个节点 · ${view.edges.length.toLocaleString()} 条边 · ${view.count.toLocaleString()} 笔转账`)
    renderSelection()
    renderAgentContext()
    updateHandle()
  }).catch(error => status(error instanceof Error ? error.message : String(error)))
  return queue
}

function openCase(next: CaseData) {
  data = next
  selection = undefined
  filters = { core: !!next.core }
  grouped = false
  hidden = new Set()
  revealed = undefined
  draftOpen = false
  history = new History(readEdits(next.id))
  $<HTMLInputElement>('case-title').value = history.value.title ?? next.title
  $('scope').hidden = !next.core
  $<HTMLSelectElement>('scope').value = next.core ? 'core' : 'all'
  $('grouped').setAttribute('aria-pressed', 'false')
  const assets = new Map(next.transfers.map(item => [item.assetId, item.asset]))
  $('asset').innerHTML = '<option value="">全部代币</option>' + [...assets].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, asset]) => `<option value="${esc(id)}">${esc(asset)}${[...assets.values()].filter(name => name === asset).length > 1 ? ' · ' + esc(id.slice(-8)) : ''}</option>`).join('')
  for (const id of ['from', 'to', 'search']) $<HTMLInputElement>(id).value = ''
  $('results').hidden = true
  renderReport()
  void render(true)
}

function eventRows(edge: FlowEdge): string {
  const entries = edge.events.slice(page * 8, (page + 1) * 8).map(item => `
    <div class="transfer stack">
      <strong>${esc(item.amount)} ${esc(item.asset)}</strong>
      <div class="subtle">${esc(item.time)}${item.usd ? ' · $' + esc(item.usd) : ''}</div>
      <code class="mono">${esc(item.hash)}</code>
      <div class="subtle">${esc(item.sources?.join(' · '))}${item.verification ? ' · ' + esc(item.verification) : ''}</div>
      ${item.evidence ? `<button class="ref" data-report="${esc(item.evidence)}">证据 ${esc(item.evidence)}</button>` : ''}
      <label>交易备注<textarea data-note="${esc(item.id)}">${esc(history.value.notes[item.id] ?? item.note)}</textarea></label>
    </div>`).join('')
  return entries + (edge.events.length > 8
    ? `<div class="actions"><button data-page="-1" ${page === 0 ? 'disabled' : ''}>上页</button><small>${page + 1} / ${Math.ceil(edge.events.length / 8)}</small><button data-page="1" ${(page + 1) * 8 >= edge.events.length ? 'disabled' : ''}>下页</button></div>` : '')
}

function renderSelection() {
  const panel = $('selection')
  const node = selection?.type === 'node' ? view.nodes.find(item => item.id === selection?.id) : undefined
  const edge = selection?.type === 'edge' ? view.edges.find(item => item.id === selection?.id) : undefined
  panel.hidden = !node && !edge
  const close = '<button data-close aria-label="关闭详情">×</button>'
  if (node) {
    const totals = (direction: 'source' | 'target') => {
      const rows = new Map<string, { asset: string; amounts: string[] }>()
      for (const item of view.edges) if (item[direction] === node.id && item.asset) {
        const assetId = item.events[0].assetId
        const row = rows.get(assetId) ?? { asset: item.asset, amounts: [] }
        row.amounts.push(item.amount!)
        rows.set(assetId, row)
      }
      return [...rows.values()].map(row => esc(sumDecimal(row.amounts) + ' ' + row.asset)).join(' · ') || '—'
    }
    const balances = latestBalances(data, node.members ?? [node.id], filters.to)
    panel.innerHTML = `<div class="section-heading"><h3>${esc(node.name)}</h3>${close}</div><div class="stack">
      <code class="mono">${esc(node.address)}</code>
      ${node.members ? `<details><summary>成员地址</summary><p class="mono">${node.members.map(id => esc(data.addresses.find(item => item.id === id)?.address)).join('<br>')}</p></details>` : ''}
      <div class="subtle">流入 ${totals('target')}<br>流出 ${totals('source')}</div>
      <div class="subtle">余额 ${balances.length ? balances.map(item => `${esc(item.amount)} ${esc(item.asset)} · ${item.usd ? '$' + esc(item.usd) : 'USD 未提供'}<br>${esc(item.time)} · ${esc(item.source)}`).join('<br>') : '暂无快照'}</div>
      <label>名称<input data-name="${esc(node.id)}" value="${esc(node.name)}"></label>
      <label>节点备注<textarea data-note="${esc(node.id)}">${esc(history.value.notes[node.id])}</textarea></label>
      <div class="actions"><button data-direction="in">${hidden.has(node.id + ':in') ? '展开' : '收起'}流入</button><button data-direction="out">${hidden.has(node.id + ':out') ? '展开' : '收起'}流出</button></div>
      <div class="actions"><button data-neighbors>仅看关联</button>${node.members ? '<button data-ungroup>解除分组</button>'
        : '<button data-group>归入实体</button><button data-link>添加关系线</button>'}</div>
    </div>`
  }
  if (edge) {
    const priced = edge.events.flatMap(item => item.usd === undefined ? [] : [item.usd])
    const usd = priced.length ? '$' + sumDecimal(priced) + ' · ' + priced.length + '/' + edge.events.length + ' 笔' : '暂无估值'
    panel.innerHTML = `<div class="section-heading"><h3>${edge.asset ? '交易明细' : '画布关系'}</h3>${close}</div><div class="stack">
      <div>${esc(view.nodes.find(node => node.id === edge.source)?.name)} → ${esc(view.nodes.find(node => node.id === edge.target)?.name)}</div>
      ${edge.asset ? `<div class="subtle">${esc(edge.amount)} ${esc(edge.asset)} · ${edge.events.length} 笔<br>USD ${esc(usd)}</div>` : ''}
      <label>连线备注<textarea data-note="${esc(edge.id)}">${esc(history.value.notes[edge.id] ?? edge.note)}</textarea></label>
      ${eventRows(edge)}</div>`
  }
}

function findReference(reference: string) {
  return data.transfers.find(item => item.id === reference || item.evidence === reference)
}

async function locate(reference: string) {
  revealed = reference
  await render()
  const item = findReference(reference)
  const edge = item && view.edges.find(edge => edge.events.some(event => event.id === item.id))
  const node = view.nodes.find(node => node.id === reference || node.members?.includes(reference))
  if (!edge && !node) {
    status('当前案件没有对应对象')
    return
  }
  selection = edge ? { type: 'edge', id: edge.id } : { type: 'node', id: node!.id }
  page = edge && item ? Math.floor(edge.events.indexOf(item) / 8) : 0
  await render(false, selection.id)
}

const refsMarkup = (refs: string[]) => refs.map(ref => `<button class="ref" data-focus="${esc(ref)}">${esc(ref)}</button>`).join(' ')

function renderReport() {
  const chapters = (data.chapters ?? []).map(chapter =>
    `<article><h3>${esc(chapter.title)}</h3><p>${esc(chapter.text)}</p><div class="actions">${refsMarkup(chapter.refs.slice(0, 20))}</div></article>`).join('')
  const drafts = history.value.drafts.map(draft => `<article><h3>调查草稿</h3><p>${esc(draft.text)}</p><div class="actions">${refsMarkup(draft.refs)}</div></article>`).join('')
  $('report-content').innerHTML = (chapters || '<p class="subtle">暂无报告章节</p>') + drafts
    + (draftOpen ? '<form id="draft-form" class="stack"><label>草稿<textarea id="draft-text" required></textarea></label><button>保存草稿</button></form>' : '')
}

function reportEvidence(reference: string) {
  const panel = $('report')
  document.querySelector('.workspace')!.setAttribute('data-report', 'open')
  $('report-toggle').setAttribute('aria-pressed', 'true')
  panel.querySelector('#report-evidence')?.remove()
  const item = findReference(reference)
  if (!item) return
  $('report-content').insertAdjacentHTML('afterbegin',
    `<article id="report-evidence" class="flash"><h3>证据 ${esc(reference)}</h3><p>${esc(item.amount)} ${esc(item.asset)} · ${esc(item.time)}</p><code class="mono">${esc(item.hash)}</code><p>${esc(item.sources?.join(' · '))}</p>${refsMarkup([reference])}</article>`)
  panel.querySelector('#report-evidence')?.scrollIntoView({ block: 'nearest' })
}

function renderAgentContext() {
  const context = $('agent-context')
  if (!context) return
  context.textContent = selection ? (view.nodes.find(item => item.id === selection?.id)?.name
    ?? view.edges.find(item => item.id === selection?.id)?.events[0]?.evidence ?? '所选交易') : '未选择图元素'
}

function applyFilters(fit = true) {
  filters = { asset: value('asset') || undefined, from: value('from') || undefined, to: value('to') || undefined, core: value('scope') === 'core' }
  revealed = undefined
  void render(fit)
}

for (const id of ['asset', 'scope', 'from', 'to']) $(id).addEventListener('change', () => applyFilters())
$('reset').onclick = () => {
  for (const id of ['asset', 'from', 'to', 'search']) $<HTMLInputElement>(id).value = ''
  $('results').hidden = true
  hidden.clear()
  applyFilters()
}
$('demo').onclick = () => {
  openedByUser = true
  openCase(demo)
  void saveCase().catch(() => status('无法清除已保存的案件'))
}
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
    const chapters = report?.chapters.map((chapter: { id: string; title: string; lede?: string; blocks?: { html?: string }[] }) => {
      const html = (chapter.blocks ?? []).map(block => block.html ?? '').join(' ')
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const refs = [...doc.querySelectorAll('a[href^="#ex-"]')].map(link => link.getAttribute('href')!.slice(4))
      const lede = new DOMParser().parseFromString(chapter.lede ?? '', 'text/html').body.textContent ?? ''
      return { id: chapter.id, title: chapter.title, text: lede, refs: [...new Set(refs)] }
    })
    const next = importCase(raw, chapters)
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
    || '<span class="subtle">没有匹配结果</span>'
})
$('selection').addEventListener('change', event => {
  const input = event.target as HTMLInputElement
  if (input.dataset.name) edit(edits => { edits.names[input.dataset.name!] = input.value.trim() })
  if (input.dataset.note) {
    // Keep other fields editable if the user tabs directly to a second field.
    history.change(edits => { edits.notes[input.dataset.note!] = input.value })
    persist()
  }
})

document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button')
  if (!button) return
  if (button.dataset.focus) {
    $('results').hidden = true
    void locate(button.dataset.focus)
  }
  if (button.dataset.report) reportEvidence(button.dataset.report)
  if (button.hasAttribute('data-close')) setSelection()
  if (button.dataset.page) {
    page += Number(button.dataset.page)
    renderSelection()
  }
  if (button.dataset.direction && selection) {
    const key = selection.id + ':' + button.dataset.direction
    if (hidden.has(key)) hidden.delete(key)
    else hidden.add(key)
    revealed = undefined
    void render()
  }
  if (button.hasAttribute('data-neighbors') && selection) {
    filters.address = selection.id
    revealed = undefined
    void render(true)
  }
  if (button.hasAttribute('data-group') && selection) {
    const name = prompt('实体名称')?.trim()
    if (!name) return
    const member = selection.id
    edit(edits => {
      for (const entity of edits.entities) entity.members = entity.members.filter(id => id !== member)
      let entity = edits.entities.find(item => item.name === name)
      if (!entity) {
        entity = { id: 'entity:' + crypto.randomUUID(), name, members: [] }
        edits.entities.push(entity)
      }
      entity.members.push(member)
      edits.entities = edits.entities.filter(item => item.members.length)
    })
  }
  if (button.hasAttribute('data-ungroup') && selection) {
    const entityId = selection.id
    edit(edits => { edits.entities = edits.entities.filter(item => item.id !== entityId) })
  }
  if (button.hasAttribute('data-link') && selection) {
    const source = selection.id
    const address = prompt('目标地址')?.trim().toLowerCase()
    if (!address) return
    const target = data.addresses.find(item => item.address.toLowerCase() === address)
    if (!target) {
      status('目标地址不在案件数据中')
      return
    }
    const note = prompt('关系说明')?.trim()
    if (!note) return
    edit(edits => { edits.relations.push({ id: 'relation:' + crypto.randomUUID(), source, target: target.id, note }) })
  }
})

$('draft').onclick = () => { draftOpen = !draftOpen; renderReport() }
$('report').addEventListener('submit', event => {
  event.preventDefault()
  const text = value('draft-text').trim()
  if (!text) return
  const edge = view.edges.find(item => item.id === selection?.id)
  const refs = edge?.events.map(item => item.evidence ?? item.id) ?? (selection ? [selection.id] : [])
  edit(edits => { edits.drafts.push({ id: crypto.randomUUID(), text, refs }) })
  draftOpen = false
  renderReport()
})

$('agent-panel').innerHTML = '<div class="stack"><h3>Agent</h3><p id="agent-context" class="subtle"></p><p class="subtle">Agent 运行时待接入</p></div>'
$('agent-toggle').onclick = () => {
  $('agent-panel').hidden = !$('agent-panel').hidden
  $('agent-toggle').setAttribute('aria-expanded', String(!$('agent-panel').hidden))
  renderAgentContext()
}

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

if (import.meta.env.DEV) Object.assign(window, { flowCanvas: { canvasCoordinates, inspectDrawing } })
