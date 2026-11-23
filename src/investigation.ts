import { sumDecimal, transact, type Address, type Balance, type CaseData, type Transfer } from './case'

export interface AnalysisBatch {
  schemaVersion: 1
  caseId: string
  expectedRevision: number
  requestId: string
  addresses: Address[]
  transfers: Transfer[]
  balances?: Balance[]
}

export interface Receipt { revision: number; added: number; duplicates: number; refs: string[] }
export interface AnalysisState { revision: number; receipts: Record<string, { signature: string; receipt: Receipt }> }

export function applyAnalysis(data: CaseData, batch: AnalysisBatch): { data: CaseData; receipt: Receipt } {
  if (batch.schemaVersion !== 1 || batch.caseId !== data.id || typeof batch.requestId !== 'string'
    || !batch.requestId || !Array.isArray(batch.addresses) || !Array.isArray(batch.transfers)
    || (batch.balances !== undefined && !Array.isArray(batch.balances))) throw new Error('Invalid analysis batch or case ID')
  const state = data.analysis ?? { revision: 0, receipts: {} }
  const signature = JSON.stringify(batch)
  const saved = Object.hasOwn(state.receipts, batch.requestId) ? state.receipts[batch.requestId] : undefined
  if (saved) {
    if (signature !== saved.signature) throw new Error('The request ID was already used for a different batch')
    return { data, receipt: saved.receipt }
  }
  if (batch.expectedRevision !== state.revision) throw new Error('Case revision conflict. Read the current revision and try again.')
  if (batch.transfers.some(event => !event.sources?.length || event.sources.some(source => typeof source !== 'string' || !source))) {
    throw new Error('Analysis transfers require a source')
  }
  const next = transact(data, batch)
  const added = next.transfers.length - data.transfers.length
  const receipt: Receipt = { revision: state.revision + 1, added,
    duplicates: batch.transfers.length - added, refs: [...new Set(batch.transfers.map(event => event.id))] }
  return { data: { ...next, analysis: { revision: receipt.revision,
    receipts: { ...state.receipts, [batch.requestId]: { signature, receipt } } } }, receipt }
}

export function investigationSummary(events: Transfer[]): string {
  const groups = new Map<string, { asset: string; amounts: string[] }>()
  for (const event of events) {
    const group = groups.get(event.assetId) ?? { asset: event.asset, amounts: [] }
    group.amounts.push(event.amount)
    groups.set(event.assetId, group)
  }
  const totals = [...groups.values()].map(group => sumDecimal(group.amounts) + ' ' + group.asset)
  return events.length
    ? `${events.length} transfer${events.length === 1 ? '' : 's'} · ${totals.join(', ')}. Totals are grouped by asset and count each transfer separately.`
    : 'No confirmed transfers within the current scope.'
}

export function entityMembers(data: CaseData, edits: import('./case').Edits, name: string, members: string[]) {
  const addresses = new Set(data.addresses.map(item => item.id))
  const unique = [...new Set(members)]
  if (!name.trim() || !unique.length || unique.some(id => !addresses.has(id))) throw new Error('Invalid entity name or members')
  return unique.map(id => ({ id, previous: edits.entities.find(entity => entity.members.includes(id))?.name }))
}

export function applyEntityMembership(edits: import('./case').Edits, name: string, members: string[], id: string, replace = false) {
  const target = edits.entities.find(entity => entity.id === id)
  const moving = new Set(members)
  for (const entity of edits.entities) {
    if (entity.id !== id) entity.members = entity.members.filter(member => !moving.has(member))
  }
  if (target) {
    target.members = replace ? [...moving] : [...new Set([...target.members, ...moving])]
  } else {
    edits.entities.push({ id, name, members: [...moving] })
  }
  edits.entities = edits.entities.filter(entity => entity.members.length)
}

export function analysisUpdates(data: CaseData, caseId: string, afterRevision: number) {
  if (caseId !== data.id) throw new Error('The active case changed')
  const revision = data.analysis?.revision ?? 0
  if (!Number.isSafeInteger(afterRevision) || afterRevision < 0 || afterRevision > revision) {
    throw new Error('Invalid analysis revision')
  }
  const receipts = Object.values(data.analysis?.receipts ?? {}).map(entry => entry.receipt)
    .filter(receipt => receipt.revision > afterRevision).sort((a, b) => a.revision - b.revision)
  return structuredClone({ caseId, revision, receipts })
}
