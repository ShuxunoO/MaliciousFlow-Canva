import { History, latestBalances, project, sumDecimal } from './case'
import type { CaseData, Draft, Edits, Filters, FlowEdge, Point } from './case'
import { applyAnalysis, entityMembers, investigationSummary, type AnalysisBatch, type Receipt } from './investigation'
import { blockscout } from './blockscout'
import { importCase } from './import-case'
import { indexEvidence, conclusionFor, validateDraft, publishConclusion } from './report'
import { importLocalReport } from './report-import'
import { loadCase, saveCase } from './storage'
import { demo } from './demo'
import { layout, NODE_HEIGHT, NODE_WIDTH } from './layout'
import { graphData, makeGraph, renderedSnapshot, type Selection } from './renderer'
import './style.css'

const app = document.querySelector<HTMLElement>('#app')!
app.innerHTML = `
  <header class="top">
    <div class="identity"><span class="mark" aria-hidden="true">M</span><div>
      <div class="brand">MALICIOUSFLOW</div><input id="case-title" aria-label="画布名称">
    </div></div>
    <div class="toolbar">
      <button id="demo">示例</button><button id="new-case">新建调查</button><button id="import">导入案件</button>
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
let draftEditor: Draft | undefined
let review: { draft: Draft; revision: number } | undefined
let evidence = indexEvidence(data)
let reportMode: 'chapters' | 'timeline' = 'chapters'
let timelinePage = 0
let openedByUser = false
let investigation: AbortController | undefined
let analysisQueue: Promise<unknown> = Promise.resolve()
let keepPositions = false
type AgentMessage = { text: string; refs: string[] }
let conversation: AgentMessage[] = []
let entityPreview: { caseId: string; state: Edits; name: string; members: string[] } | undefined
const provider = blockscout(import.meta.env.VITE_BLOCKSCOUT_URL || undefined)
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
    drawing = layout(view, keepPositions ? { ...drawing.positions, ...history.value.positions } : history.value.positions, history.value.bends)
    keepPositions = false
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
  investigation?.abort()
  investigation = undefined
  data = next
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
  history = new History(readEdits(next.id))
  $<HTMLInputElement>('case-title').value = history.value.title ?? next.title
  $('scope').hidden = !next.core
  const scopes = Object.keys(next.views ?? {}).filter(id => id !== 'core')
  $('scope').innerHTML = '<option value="core">核心视图</option><option value="all">全量视图</option>' + scopes
    .map(id => `<option value="${esc(id)}">${id === 'return' ? '回流视图' : id === 'original' ? '原图视图'
      : '批次 ' + esc(id.replace(/^batch-/, ''))}</option>`).join('')
  $<HTMLSelectElement>('scope').value = next.core ? 'core' : 'all'
  $('grouped').setAttribute('aria-pressed', 'false')
  updateAssets()
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
  select.innerHTML = '<option value="">全部代币</option>' + [...assets].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, asset]) => `<option value="${esc(id)}">${esc(asset)}${(counts.get(asset) ?? 0) > 1 ? ' · ' + esc(id.slice(-8)) : ''}</option>`).join('')
  select.value = filters.asset ?? ''
}

function eventRows(edge: FlowEdge): string {
  const entries = edge.events.slice(page * 8, (page + 1) * 8).map(item => `
    <div class="transfer stack">
      <strong>${esc(item.amount)} ${esc(item.asset)}</strong>
      <div class="subtle">${esc(item.time)}${item.usd ? ' · $' + esc(item.usd) : ''}</div>
      <code class="mono">${esc(item.hash)}</code>
      <div class="subtle">${esc(item.sources?.join(' · '))}${item.verification ? ' · ' + esc(item.verification) : ''}</div>
      <button class="ref" data-report="${esc(item.id)}">${item.evidence ? '证据 ' + esc(item.evidence) : '交易来源'}</button>
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
  const close = (revealed ? '<button data-return-view>返回原视图</button>' : '') + '<button data-close aria-label="关闭详情">×</button>'
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
  return evidence.get(reference)
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
  const chapters = (data.chapters ?? []).map(chapter => {
    const conclusion = conclusionFor(chapter, history.value)
    return `<article>
      <h3>${esc(chapter.title)}</h3><p>${esc(conclusion.text)}</p>
      ${conclusion.revision ? `<small>结论版本 ${conclusion.revision}</small>` : ''}
      ${chapter.paragraphs?.length || chapter.tables?.length ? `<details data-chapter="${esc(chapter.id)}"><summary>正文与表格</summary><div></div></details>` : ''}
      <div class="actions">${refsMarkup(conclusion.refs.slice(0, 8))}</div>
      ${conclusion.refs.length > 8 ? `<details data-chapter-refs="${esc(chapter.id)}"><summary>其余引用（${conclusion.refs.length - 8}）</summary><div class="actions"></div></details>` : ''}
    </article>`
  }).join('')
  const rows = evidence.timeline.slice(timelinePage * 25, (timelinePage + 1) * 25).map(item =>
    `<tr><td>${esc(item.time.slice(0, 19).replace('T', ' '))}</td><td>${esc(item.amount + ' ' + item.asset)}</td><td>${refsMarkup([item.evidence ?? item.id])}</td></tr>`).join('')
  const timeline = rows
    ? `<div class="report-table"><table><thead><tr><th>时间 UTC</th><th>金额</th><th>证据</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="actions"><button data-timeline="-1" ${timelinePage ? '' : 'disabled'}>上页</button>
      <small>${timelinePage + 1} / ${Math.ceil(evidence.timeline.length / 25)}</small>
      <button data-timeline="1" ${(timelinePage + 1) * 25 >= evidence.timeline.length ? 'disabled' : ''}>下页</button></div>`
    : '<p class="subtle">暂无交易</p>'
  const sources = data.reportSources?.map(([title, items]) =>
    `<h3>${esc(title)}</h3><ul>${items.map(item => `<li>${/^https?:\/\//.test(item)
      ? `<a href="${esc(item)}" target="_blank" rel="noreferrer">${esc(item)}</a>` : esc(item)}</li>`).join('')}</ul>`).join('')
  const drafts = history.value.drafts.map(draft => `<article><h3>调查草稿</h3><p>${esc(draft.text)}</p>
    <div class="actions">${refsMarkup(draft.refs)}<button data-edit-draft="${esc(draft.id)}">编辑草稿</button>
    ${draft.chapter ? `<button data-review-draft="${esc(draft.id)}">预览结论</button>` : ''}</div></article>`).join('')
  const editor = draftEditor ? `<form id="draft-form" class="stack">
    <label>目标章节<select id="draft-chapter"><option value="">调查草稿</option>${(data.chapters ?? [])
      .map(item => `<option value="${esc(item.id)}" ${item.id === draftEditor?.chapter ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select></label>
    <label>草稿<textarea id="draft-text" aria-label="草稿" required>${esc(draftEditor.text)}</textarea></label>
    <label>引用（每行一个）<textarea id="draft-refs" aria-label="引用（每行一个）">${esc(draftEditor.refs.join('\n'))}</textarea></label>
    <button>保存草稿</button><output id="draft-error" role="alert"></output></form>` : ''
  const current = review ? conclusionFor(data.chapters?.find(item => item.id === review?.draft.chapter), history.value) : undefined
  const comparison = review && current ? `<article class="review stack"><h3>结论变更预览</h3>
    <div><small>当前 · 版本 ${review.revision}</small><p>${esc(current.text)}</p><div class="actions">${refsMarkup(current.refs.slice(0, 8))}</div></div>
    <div><small>拟更新</small><p>${esc(review.draft.text)}</p><div class="actions">${refsMarkup(review.draft.refs)}</div></div>
    <div class="actions"><button data-publish>确认更新</button><button data-cancel-review>取消</button></div></article>` : ''
  const panel = $('report-content')
  panel.innerHTML = `<nav class="actions report-tabs" aria-label="报告视图">
    <button data-report-mode="chapters" aria-pressed="${reportMode === 'chapters'}">章节</button>
    <button data-report-mode="timeline" aria-pressed="${reportMode === 'timeline'}">交易时间线</button></nav>`
    + comparison + editor + (reportMode === 'chapters'
      ? drafts + (chapters || '<p class="subtle">暂无报告章节</p>') + (sources ? `<details><summary>报告来源</summary>${sources}</details>` : '')
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
    `<article id="report-evidence" class="flash"><h3>${item.evidence ? '证据 ' + esc(item.evidence) : '交易来源'}</h3>
      <p>${esc(item.amount)} ${esc(item.asset)} · ${esc(item.time)}</p><code class="mono">${esc(item.hash)}</code>
      <p>${esc(item.sources?.join(' · ') || '来源未提供')}${item.verification ? ' · ' + esc(item.verification) : ''}</p>
      ${refsMarkup([item.evidence ?? item.id])}</article>`)
  panel.querySelector('#report-evidence')?.scrollIntoView({ block: 'nearest' })
}

function renderAgentContext() {
  const context = $('agent-context')
  if (!context) return
  context.textContent = selection ? (view.nodes.find(item => item.id === selection?.id)?.name
    ?? view.edges.find(item => item.id === selection?.id)?.events[0]?.evidence ?? '所选交易') : '未选择图元素'
}

function applyFilters(fit = true) {
  const scope = value('scope')
  filters = { asset: value('asset') || undefined, from: value('from') || undefined, to: value('to') || undefined,
    core: scope === 'core', viewId: scope === 'all' || scope === 'core' ? undefined : scope }
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
$('new-case').onclick = () => {
  openedByUser = true
  const blank: CaseData = { id: crypto.randomUUID(), title: 'Ethereum 调查', addresses: [], transfers: [],
    chapters: [{ id: 'findings', title: '调查结论', text: '', refs: [] }] }
  openCase(blank)
  void saveCase(blank).catch(() => status('无法保存新案件'))
  $('agent-panel').hidden = false
  $('agent-toggle').setAttribute('aria-expanded', 'true')
  $('agent-seed').focus()
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
  <form id="agent-form" class="stack"><label>调查起点<input id="agent-seed" placeholder="Ethereum 地址或交易哈希"></label>
    <div class="actions"><button id="agent-start">采集并上图</button><button id="agent-stop" type="button" hidden>停止</button>
      <button id="agent-analyze" type="button">分析当前对象</button><button id="agent-draft" type="button">起草</button></div>
  </form><div id="entity-preview"></div><output id="agent-progress" aria-live="polite"></output><div id="agent-messages" class="stack"></div></div>`
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
  messages.innerHTML = conversation.slice(-8).map(item => `<div class="agent-message"><p>${esc(item.text)}</p>
    <div class="actions">${refsMarkup(item.refs.slice(0, 8))}</div></div>`).join('')
  if (!entityPreview) $('entity-preview').replaceChildren()
  updateAgentControls()
}

function message(text: string, refs: string[] = []) {
  conversation = [...conversation, { text, refs }].slice(-20)
  try { localStorage.setItem('flow-agent:' + data.id, JSON.stringify(conversation)) } catch { status('无法保存调查记录') }
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
    if (data !== current) throw new Error('当前案件已切换')
    data = result.data
    evidence = indexEvidence(data)
    updateAssets()
    renderReport()
    keepPositions = true
    await render(!view.nodes.length)
    app.dispatchEvent(new CustomEvent('flow:analysis', { detail: result.receipt }))
    return result.receipt
  })
  analysisQueue = write.catch(() => {})
  return write
}

function selectedTransfers() {
  const edge = view.edges.find(item => item.id === selection?.id)
  if (edge) return edge.events
  if (!selection) return view.edges.flatMap(item => item.events)
  return view.edges.filter(item => item.source === selection?.id || item.target === selection?.id).flatMap(item => item.events)
}

$('agent-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (investigation) return
  const seed = value('agent-seed').trim()
  if (!seed) {
    updateAgentControls('请输入地址或交易哈希')
    return
  }
  const controller = new AbortController()
  const caseId = data.id
  investigation = controller
  const found = new Map<string, CaseData['transfers'][number]>()
  try {
    const coverage = await provider.investigate(seed, async batch => {
      controller.signal.throwIfAborted()
      if (caseId !== data.id) throw new Error('当前案件已切换')
      if (!batch.transfers.length && !batch.addresses.length && !batch.balances?.length) return
      const receipt = await applyBatch({ schemaVersion: 1, caseId, expectedRevision: data.analysis?.revision ?? 0,
        requestId: crypto.randomUUID(), ...batch })
      for (const transfer of batch.transfers) found.set(transfer.id, transfer)
      updateAgentControls(`已同步版本 ${receipt.revision} · 新增 ${receipt.added} 笔`)
    }, updateAgentControls, controller.signal)
    if (data.id === caseId) message(investigationSummary([...found.values()]) + ' ' + coverage, [...found.keys()])
  } catch (error) {
    if (data.id === caseId) message(controller.signal.aborted ? '调查已停止，已同步的记录保留。'
      : error instanceof Error ? error.message : String(error), [...found.keys()])
  } finally {
    if (investigation === controller) {
      investigation = undefined
      updateAgentControls()
    }
  }
})
$('agent-stop').onclick = () => investigation?.abort()
$('agent-analyze').onclick = () => {
  const transfers = selectedTransfers()
  message(investigationSummary(transfers), transfers.map(item => item.evidence ?? item.id))
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
  | { action: 'undo' | 'redo' }

function previewEntity(name: string, members: string[]) {
  const entries = entityMembers(data, history.value, name, members)
  entityPreview = { caseId: data.id, state: history.value, name: name.trim(), members: entries.map(entry => entry.id) }
  $('agent-panel').hidden = false
  $('agent-toggle').setAttribute('aria-expanded', 'true')
  $('entity-preview').innerHTML = `<div class="stack"><h3>实体归属预览</h3><p>${esc(name)}</p><ul>${entries
    .map(item => `<li>${esc(item.id)} · ${esc(item.previous ?? '未分组')} → ${esc(name)}</li>`).join('')}</ul>
    <div class="actions"><button id="entity-confirm">确认归组</button><button id="entity-cancel">取消</button></div></div>`
  $('entity-confirm').onclick = confirmEntity
  $('entity-cancel').onclick = () => { entityPreview = undefined; $('entity-preview').replaceChildren() }
  return entries
}

function confirmEntity() {
  const proposal = entityPreview
  entityPreview = undefined
  $('entity-preview').replaceChildren()
  if (!proposal || proposal.caseId !== data.id || proposal.state !== history.value) {
    message('画布编辑状态已改变，请重新预览实体归属。')
    return
  }
  edit(edits => {
    for (const entity of edits.entities) entity.members = entity.members.filter(id => !proposal.members.includes(id))
    let entity = edits.entities.find(item => item.name === proposal.name)
    if (!entity) {
      entity = { id: 'entity:' + crypto.randomUUID(), name: proposal.name, members: [] }
      edits.entities.push(entity)
    }
    entity.members.push(...proposal.members)
    edits.entities = edits.entities.filter(item => item.members.length)
  })
  message('已更新实体归属 · ' + proposal.name, proposal.members)
}

Object.assign(window, {
  maliciousFlow: Object.freeze({
    apply_analysis: applyBatch,
    set_view: async (input?: string | { ref?: string; filters?: Filters }) => {
      const ref = typeof input === 'string' ? input : input?.ref
      if (typeof input === 'object' && input.filters) {
        filters = { ...input.filters }
        updateAssets()
        $<HTMLInputElement>('from').value = filters.from?.slice(0, 10) ?? ''
        $<HTMLInputElement>('to').value = filters.to?.slice(0, 10) ?? ''
        $<HTMLSelectElement>('scope').value = filters.viewId ?? (filters.core ? 'core' : 'all')
        revealed = undefined
        await render()
      }
      if (ref) await locate(ref)
      return { caseId: data.id, revision: data.analysis?.revision ?? 0, selection: selection && { ...selection }, filters: { ...filters },
        visibleNodes: view.nodes.length, visibleTransfers: view.count }
    },
    edit_canvas: (command: CanvasCommand) => {
      if (command.action === 'undo' || command.action === 'redo') {
        history[command.action]()
        restore()
        return
      }
      if (!('id' in command)) throw new Error('当前命令无效')
      const node = view.nodes.find(item => item.id === command.id)
      const edge = view.edges.find(item => item.id === command.id)
      const event = evidence.get(command.id)
      if (command.action === 'rename' && node) edit(edits => { edits.names[node.id] = command.text.trim() })
      else if (command.action === 'note' && (node || edge || event)) edit(edits => { edits.notes[event?.id ?? command.id] = command.text })
      else if (command.action === 'move' && node && command.position?.length === 2 && command.position.every(Number.isFinite)) {
        edit(edits => { edits.positions[node.id] = [...command.position] })
      } else if (command.action === 'bend' && edge && Number.isFinite(command.offset)) edit(edits => { edits.bends[edge.id] = command.offset })
      else throw new Error('当前命令或目标对象无效')
    },
    edit_entity: (input: { name: string; members: string[] }) => previewEntity(input.name, input.members),
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
