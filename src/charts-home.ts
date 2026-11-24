import { deleteChart, listCharts, renameChart, type SavedChart } from './storage'

export function chartRoute(id: string) {
  return '#chart/' + encodeURIComponent(id)
}

export function createChartsHome(root: HTMLElement, actions: {
  open: (id: string) => void; openDemo: () => void; create: () => void; importCase: () => void
}) {
  root.innerHTML = `
    <aside class="charts-sidebar" aria-label="Workspace">
      <div class="identity"><span class="mark" aria-hidden="true">M</span><strong>MaliciousFlow</strong></div>
      <p class="workspace-label">Workspace</p>
      <a class="charts-nav" href="#charts" aria-current="page"><span aria-hidden="true">▤</span> Saved Charts</a>
    </aside>
    <section class="charts-main" aria-labelledby="charts-heading">
      <nav class="charts-breadcrumb" aria-label="Breadcrumb">Workspace <span aria-hidden="true">›</span> Saved Charts</nav>
      <div class="charts-heading"><h1 id="charts-heading" tabindex="-1">Saved Charts</h1><div class="actions">
        <button id="charts-demo">Open demo</button><button id="charts-import">Import case</button>
      </div></div>
      <div class="charts-card">
        <div class="charts-tools">
          <input id="charts-query" type="search" aria-label="Search charts by title, address or transaction hash" placeholder="Search title, address or transaction hash">
          <button id="charts-new" class="primary"><span aria-hidden="true">＋</span> New Chart</button>
        </div>
        <output id="charts-status" aria-live="polite"></output>
        <div class="charts-table-scroll"><table aria-label="Saved Charts">
          <thead><tr><th scope="col">Chart</th><th scope="col">Starting address</th><th id="charts-created" scope="col" aria-sort="descending">
            <button id="charts-sort">Created <span aria-hidden="true">↓</span></button></th><th scope="col">Actions</th></tr></thead>
          <tbody id="charts-rows"></tbody>
        </table></div>
        <footer class="charts-pagination">
          <div class="actions"><button id="charts-previous">Previous</button><span id="charts-page"></span><button id="charts-next">Next</button></div>
          <div class="actions"><span id="charts-total"></span><select id="charts-page-size" aria-label="Charts per page">
            <option value="10">10 / page</option><option value="25">25 / page</option><option value="50">50 / page</option>
          </select></div>
        </footer>
      </div>
    </section>
    <dialog id="charts-dialog" aria-labelledby="charts-dialog-title">
      <form class="stack" id="charts-dialog-form">
        <h2 id="charts-dialog-title"></h2>
        <label id="charts-title-field">Chart name<input id="charts-title-input" maxlength="120" required></label>
        <p id="charts-confirmation" hidden></p>
        <output id="charts-dialog-error" aria-live="polite"></output>
        <div class="actions"><button type="button" id="charts-dialog-cancel">Cancel</button><button id="charts-dialog-submit"></button></div>
      </form>
    </dialog>`
  const element = <Target extends HTMLElement = HTMLElement>(id: string) => root.querySelector<Target>('#' + id)!
  const query = element<HTMLInputElement>('charts-query')
  const rows = element<HTMLTableSectionElement>('charts-rows')
  const pageSize = element<HTMLSelectElement>('charts-page-size')
  const previous = element<HTMLButtonElement>('charts-previous')
  const next = element<HTMLButtonElement>('charts-next')
  const dialog = element<HTMLDialogElement>('charts-dialog')
  const titleField = element('charts-title-field')
  const titleInput = element<HTMLInputElement>('charts-title-input')
  const confirmation = element('charts-confirmation')
  const submit = element<HTMLButtonElement>('charts-dialog-submit')
  const status = element('charts-status')
  const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
  let charts: SavedChart[] = []
  let page = 0
  let newestFirst = true
  let pending: { chart: SavedChart; remove: boolean } | undefined
  let refreshId = 0

  function render() {
    const term = query.value.trim().toLowerCase()
    const matches = charts.filter(chart => !term || chart.title.toLowerCase().includes(term)
      || chart.seed?.toLowerCase().includes(term) || chart.addresses.some(address => address.includes(term))
      || chart.hashes.some(hash => hash.includes(term)))
      .sort((left, right) => (newestFirst ? -1 : 1) *
        (left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)))
    const size = Number(pageSize.value)
    const pages = Math.max(1, Math.ceil(matches.length / size))
    page = Math.min(page, pages - 1)
    rows.replaceChildren()
    for (const chart of matches.slice(page * size, (page + 1) * size)) {
      const row = rows.insertRow()
      const link = document.createElement('a')
      link.textContent = chart.title
      link.href = chartRoute(chart.id)
      link.onclick = event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        actions.open(chart.id)
      }
      row.insertCell().append(link)
      const address = row.insertCell()
      const seed = chart.seed
      address.textContent = seed && /^0x[\da-f]{40}$/i.test(seed) ? seed : '—'
      address.className = 'chart-address'
      const time = document.createElement('time')
      time.dateTime = chart.createdAt
      time.textContent = dateFormat.format(new Date(chart.createdAt))
      row.insertCell().append(time)
      const controls = row.insertCell()
      controls.className = 'chart-row-actions'
      for (const [label, remove] of [['Rename', false], ['Delete', true]] as const) {
        const button = document.createElement('button')
        button.textContent = label
        button.setAttribute('aria-label', label + ' ' + chart.title)
        button.onclick = () => openDialog(chart, remove)
        controls.append(button)
      }
    }
    if (!matches.length) {
      const cell = rows.insertRow().insertCell()
      cell.colSpan = 4
      cell.className = 'charts-empty'
      cell.textContent = term ? 'No charts match your search.' : 'No saved charts yet. Create or import a chart to get started.'
    }
    element('charts-page').textContent = `${page + 1} / ${pages}`
    element('charts-total').textContent = `${matches.length} ${matches.length === 1 ? 'chart' : 'charts'}`
    previous.disabled = page === 0
    next.disabled = page + 1 >= pages
    element('charts-created').setAttribute('aria-sort', newestFirst ? 'descending' : 'ascending')
    element('charts-sort').lastElementChild!.textContent = newestFirst ? '↓' : '↑'
  }

  async function refresh(recovery?: Promise<unknown>) {
    const current = ++refreshId
    status.textContent = 'Loading charts…'
    try {
      const recoveryError = await recovery?.then(() => undefined, error => error)
      const result = await listCharts()
      if (current !== refreshId) return
      charts = result
      status.textContent = ''
      render()
      if (recoveryError) showError(recoveryError)
    } catch (error) {
      if (current === refreshId) showError(error)
    }
  }

  function showError(error: unknown) {
    status.textContent = error instanceof Error ? error.message : String(error)
  }

  function openDialog(chart: SavedChart, remove: boolean) {
    pending = { chart, remove }
    element('charts-dialog-title').textContent = remove ? 'Delete chart?' : 'Rename chart'
    titleField.hidden = remove
    titleInput.disabled = remove
    titleInput.value = chart.title
    confirmation.hidden = !remove
    confirmation.textContent = `Delete “${chart.title}” and its saved edits from this workspace?`
    submit.textContent = remove ? 'Delete' : 'Rename'
    submit.className = remove ? 'danger' : 'primary'
    element('charts-dialog-error').textContent = ''
    dialog.showModal()
    if (remove) element('charts-dialog-cancel').focus()
    else titleInput.select()
  }

  element<HTMLFormElement>('charts-dialog-form').onsubmit = async event => {
    event.preventDefault()
    if (!pending || submit.disabled) return
    const { chart, remove } = pending
    const title = titleInput.value.trim()
    if (!remove && !title) {
      element('charts-dialog-error').textContent = 'Enter a chart name.'
      titleInput.focus()
      return
    }
    submit.disabled = true
    try {
      if (remove) await deleteChart(chart.id)
      else await renameChart(chart.id, title)
      dialog.close()
      await refresh()
    } catch (error) {
      element('charts-dialog-error').textContent = error instanceof Error ? error.message : String(error)
    } finally {
      submit.disabled = false
    }
  }
  element('charts-dialog-cancel').onclick = () => dialog.close()
  element('charts-demo').onclick = actions.openDemo
  element('charts-import').onclick = actions.importCase
  element('charts-new').onclick = actions.create
  query.oninput = pageSize.onchange = () => { page = 0; render() }
  element('charts-sort').onclick = () => { newestFirst = !newestFirst; page = 0; render() }
  previous.onclick = () => { page--; render() }
  next.onclick = () => { page++; render() }
  return { refresh, showError, focus: () => element('charts-heading').focus() }
}
