import { History, type CaseData, type Edits, type HistorySnapshot } from './case'

export interface SavedChart {
  id: string
  title: string
  createdAt: string
  savedAt?: string
  seed?: string
  addresses: string[]
  hashes: string[]
}

export function readDraft(id: string): Edits | HistorySnapshot | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem('flow-edits:' + id) ?? 'null') as Edits | HistorySnapshot | null
    if (raw && 'value' in raw && raw.value && Array.isArray(raw.past) && Array.isArray(raw.future)) return raw
    if (raw && 'notes' in raw && raw.notes && raw.names && raw.positions) return raw
  } catch {
    return undefined
  }
}

function chartMetadata(data: CaseData, previous?: SavedChart, seed?: string): SavedChart {
  return {
    id: data.id,
    title: previous?.title ?? data.title,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    savedAt: previous?.savedAt,
    seed: previous?.seed ?? seed,
    addresses: [...new Set(data.addresses.map(item => item.address.toLowerCase()))],
    hashes: [...new Set(data.transfers.map(item => item.hash.toLowerCase()))],
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('maliciousflow', 2)
    request.onupgradeneeded = event => {
      const database = request.result
      const workspace = event.oldVersion ? request.transaction!.objectStore('workspace') : database.createObjectStore('workspace')
      const charts = database.createObjectStore('charts', { keyPath: 'id' })
      if (event.oldVersion === 1) {
        const legacy = workspace.get('active')
        legacy.onsuccess = () => {
          const data = legacy.result as CaseData | undefined
          if (!data) return
          const edits = History.restore(readDraft(data.id)).snapshot()
          charts.put({ ...chartMetadata(data), title: edits.value.title ?? data.title })
          workspace.put(data, ['case', data.id])
          workspace.put(edits, ['edits', data.id])
          workspace.delete('active')
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close other MaliciousFlow tabs to upgrade the workspace'))
  })
}

function resultOf<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<Result>(mode: IDBTransactionMode,
  operation: (charts: IDBObjectStore, workspace: IDBObjectStore) => Promise<Result>): Promise<Result> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(['charts', 'workspace'], mode)
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('The workspace transaction was cancelled'))
    })
    const [result] = await Promise.all([operation(transaction.objectStore('charts'), transaction.objectStore('workspace'))
      .catch(error => {
        try { transaction.abort() } catch {}
        throw error
      }), committed])
    return result
  } finally {
    database.close()
  }
}

let pendingWrite: Promise<unknown> = Promise.resolve()

function write<Result>(operation: (charts: IDBObjectStore, workspace: IDBObjectStore) => Promise<Result>) {
  const next = pendingWrite.then(() => transact('readwrite', operation))
  pendingWrite = next.catch(() => {})
  return next
}

export async function listCharts(): Promise<SavedChart[]> {
  await pendingWrite
  return transact('readonly', charts => resultOf(charts.getAll()))
}

export async function loadChart(id: string): Promise<{ chart: SavedChart; data: CaseData; edits?: HistorySnapshot } | undefined> {
  await pendingWrite
  return transact('readonly', async (charts, workspace) => {
    const [chart, data, edits] = await Promise.all([
      resultOf(charts.get(id)), resultOf(workspace.get(['case', id])), resultOf(workspace.get(['edits', id])),
    ])
    return chart && data ? { chart, data, edits } : undefined
  })
}

async function canRestore(charts: IDBObjectStore, workspace: IDBObjectStore, id: string) {
  const [existing, deleted] = await Promise.all([
    resultOf(charts.getKey(id)), resultOf(workspace.getKey(['deleted-case', id])),
  ])
  return existing === undefined && deleted === undefined
}

export async function canRestoreCase(id: string) {
  await pendingWrite
  return transact('readonly', (charts, workspace) => canRestore(charts, workspace, id))
}

export function restoreCase(data: CaseData) {
  return write(async (charts, workspace) => {
    if (!await canRestore(charts, workspace, data.id)) return false
    const draft = readDraft(data.id)
    const checkpoint = draft && History.restore(draft).snapshot()
    charts.put({ ...chartMetadata(data), title: checkpoint?.value.title ?? data.title })
    workspace.put(data, ['case', data.id])
    if (checkpoint) workspace.put(checkpoint, ['edits', data.id])
    return true
  })
}

function writeCase(data: CaseData, existingOnly: boolean, seed?: string) {
  return write(async (charts, workspace) => {
    const previous = await resultOf(charts.get(data.id)) as SavedChart | undefined
    if (existingOnly && !previous) throw new Error('The chart no longer exists')
    charts.put(chartMetadata(data, previous, seed))
    workspace.put(data, ['case', data.id])
    if (!existingOnly) workspace.delete(['deleted-case', data.id])
  })
}

export function saveCase(data: CaseData) {
  return writeCase(data, false)
}

export function updateCase(data: CaseData, seed?: string) {
  return writeCase(data, true, seed)
}

export function saveChartEdits(id: string, title: string, edits: HistorySnapshot) {
  return write(async (charts, workspace) => {
    const chart = await resultOf(charts.get(id)) as SavedChart | undefined
    if (!chart) throw new Error('The chart no longer exists')
    charts.put({ ...chart, title, savedAt: new Date().toISOString() })
    workspace.put(edits, ['edits', id])
  })
}

export async function renameChart(id: string, title: string) {
  const key = 'flow-edits:' + id
  let previousDraft: string | null = null
  let renamedDraft: string | undefined
  const renamed = (edits?: Edits | HistorySnapshot) => {
    const history = History.restore(edits)
    history.change(value => { value.title = title })
    return history.snapshot()
  }
  try {
    await write(async (charts, workspace) => {
      const [chart, edits] = await Promise.all([resultOf(charts.get(id)), resultOf(workspace.get(['edits', id]))])
      if (!chart) throw new Error('The chart no longer exists')
      if (chart.title === title) return
      const draft = readDraft(id)
      if (draft) {
        previousDraft = localStorage.getItem(key)
        renamedDraft = JSON.stringify(renamed(draft))
        localStorage.setItem(key, renamedDraft)
      }
      charts.put({ ...chart, title })
      workspace.put(renamed(edits), ['edits', id])
    })
  } catch (error) {
    if (renamedDraft && previousDraft !== null) {
      try {
        if (localStorage.getItem(key) === renamedDraft) localStorage.setItem(key, previousDraft)
      } catch {}
    }
    throw error
  }
}

export async function deleteChart(id: string) {
  await write(async (charts, workspace) => {
    charts.delete(id)
    workspace.delete(['case', id])
    workspace.delete(['edits', id])
    workspace.put(true, ['deleted-case', id])
  })
  for (const key of ['flow-edits:', 'flow-agent:', 'flow-agent-draft:']) {
    try { localStorage.removeItem(key + id) } catch {}
  }
}
