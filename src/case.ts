import type { AnalysisState } from './investigation'
import type { Conclusion } from './report'

export type Point = [number, number]

export interface Address {
  id: string
  address: string
  name: string
  role?: string
  icon?: string
  column?: number
  color?: string
}

export interface Transfer {
  id: string
  source: string
  target: string
  hash: string
  time: string
  asset: string
  assetId: string
  amount: string
  evidence?: string
  verification?: string
  rawAmount?: string
  sources?: string[]
  note?: string
  usd?: string
  context?: boolean
}

export interface Balance {
  addressId: string
  assetId: string
  asset: string
  amount: string
  time: string
  source: string
  usd?: string
}

export interface Chapter {
  id: string
  title: string
  text: string
  refs: string[]
  paragraphs?: string[]
  tables?: string[][][]
}

export interface CaseData {
  id: string
  title: string
  addresses: Address[]
  transfers: Transfer[]
  balances?: Balance[]
  chapters?: Chapter[]
  analysis?: AnalysisState
  reportSources?: [string, string[]][]
  core?: string[]
  views?: Record<string, string[]>
  viewColumns?: Record<string, Record<string, number>>
}

export interface Entity { id: string; name: string; members: string[] }
export interface Relation { id: string; source: string; target: string; note: string }
export interface Draft { id: string; text: string; refs: string[]; chapter?: string }
export interface CanvasLayer { id: string; name: string; visible: boolean; refs: string[] }
export interface LayoutSettings { rowGap: number; columnGap: number; maxRows: number }
export interface Edits {
  title?: string
  names: Record<string, string>
  notes: Record<string, string>
  positions: Record<string, Point>
  bends: Record<string, number>
  nodeColors?: Record<string, string>
  edgeColors?: Record<string, string>
  entities: Entity[]
  relations: Relation[]
  drafts: Draft[]
  included?: string[]
  conclusions?: Record<string, Conclusion>
  layers?: CanvasLayer[]
  showUnassigned?: boolean
  layout?: LayoutSettings
}

export interface Filters { asset?: string; from?: string; to?: string; address?: string; core?: boolean; viewId?: string; includeContext?: boolean; pair?: [string, string] }
export interface FlowNode extends Address { members?: string[] }
export interface FlowEdge {
  id: string
  source: string
  target: string
  asset?: string
  amount?: string
  events: Transfer[]
  note?: string
}
export interface FlowView { nodes: FlowNode[]; edges: FlowEdge[]; count: number }

export function emptyEdits(): Edits {
  return { names: {}, notes: {}, positions: {}, bends: {}, entities: [], relations: [], drafts: [] }
}

export function sumDecimal(values: string[]): string {
  const scale = values.reduce((max, value) => Math.max(max, value.split('.')[1]?.length ?? 0), 0)
  const sum = values.reduce((total, value) => {
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
    const units = BigInt(whole + fraction.padEnd(scale, '0'))
    return value.startsWith('-') ? total - units : total + units
  }, 0n)
  if (!scale) return String(sum)
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0')
  return (sum < 0n ? '-' : '') + (digits.slice(0, -scale) + '.' + digits.slice(-scale)).replace(/\.?0+$/, '')
}

export function transact(previous: CaseData, incoming: Pick<CaseData, 'addresses' | 'transfers' | 'balances'>): CaseData {
  const addresses = new Map(previous.addresses.map(item => [item.id, item]))
  const transfers = new Map(previous.transfers.map(item => [item.id, item]))
  for (const item of incoming.addresses) {
    if (!item.id || typeof item.address !== 'string' || typeof item.name !== 'string') throw new Error('Invalid address')
    addresses.set(item.id, item)
  }
  for (const item of incoming.transfers) {
    if (!item.id || !item.hash || !item.assetId || !addresses.has(item.source) || !addresses.has(item.target)
      || typeof item.asset !== 'string' || (item.usd !== undefined && (typeof item.usd !== 'string' || !/^\d+(\.\d+)?$/.test(item.usd)))
      || !Number.isFinite(Date.parse(item.time)) || typeof item.amount !== 'string' || !/^\d+(\.\d+)?$/.test(item.amount)) {
      throw new Error('Invalid transfer ' + item.id)
    }
    const existing = transfers.get(item.id)
    if (existing && (existing.source !== item.source || existing.target !== item.target || existing.hash !== item.hash
      || existing.assetId !== item.assetId || Date.parse(existing.time) !== Date.parse(item.time)
      || sumDecimal([existing.amount]) !== sumDecimal([item.amount]))) throw new Error('Event ID conflict ' + item.id)
    transfers.set(item.id, { ...existing, ...item, sources: [...new Set([...(existing?.sources ?? []), ...(item.sources ?? [])])] })
  }
  const balances = new Map((previous.balances ?? []).map(item => [JSON.stringify([item.addressId, item.assetId, item.time]), item]))
  for (const item of incoming.balances ?? []) {
    if (!addresses.has(item.addressId) || !item.assetId || !item.source || !Number.isFinite(Date.parse(item.time))
      || !/^\d+(\.\d+)?$/.test(item.amount) || (item.usd !== undefined && !/^\d+(\.\d+)?$/.test(item.usd))) {
      throw new Error('Invalid balance snapshot ' + item.addressId)
    }
    balances.set(JSON.stringify([item.addressId, item.assetId, item.time]), item)
  }
  return { ...previous, addresses: [...addresses.values()], transfers: [...transfers.values()], balances: [...balances.values()] }
}

export function project(data: CaseData, edits: Edits, filters: Filters = {}, grouped = false,
  hidden = new Set<string>(), reveal?: string, soloLayer?: string): FlowView {
  const viewId = filters.viewId ?? (filters.core ? 'core' : 'all')
  const scope = viewId === 'core' ? data.views?.core ?? data.core : data.views?.[viewId]
  const core = scope ? new Set(scope) : undefined
  const columns = data.viewColumns?.[viewId]
  const mapping = new Map<string, string>()
  const nodes = new Map<string, FlowNode>(data.addresses.map(item => [item.id,
    { ...item, column: columns?.[item.id] ?? item.column, name: edits.names[item.id] ?? item.name }]))
  if (grouped) for (const entity of edits.entities) {
    const members = entity.members.filter(id => nodes.has(id))
    if (!members.length) continue
    for (const id of members) mapping.set(id, entity.id)
    nodes.set(entity.id, { id: entity.id, name: edits.names[entity.id] ?? entity.name,
      address: members.length + ' addresses', role: 'Entity', members,
      column: Math.min(...members.map(id => nodes.get(id)?.column ?? 0)) })
  }
  const filterAddresses = filters.address ? new Set([filters.address,
    ...(edits.entities.find(entity => entity.id === filters.address)?.members ?? [])]) : undefined
  const pair = filters.pair?.map(id => mapping.get(id) ?? id)
  const matchesPair = (source: string, target: string) => !pair ||
    source === pair[0] && target === pair[1] || source === pair[1] && target === pair[0]
  const included = new Set(edits.included ?? [])
  const layers = edits.layers ?? []
  const solo = layers.find(layer => layer.id === soloLayer)
  const assigned = new Set(layers.flatMap(layer => layer.refs))
  const allowed = new Set((solo ? [solo] : layers.filter(layer => layer.visible)).flatMap(layer => layer.refs))
  const layerShows = (id: string) => allowed.has(id) || !solo && edits.showUnassigned !== false && !assigned.has(id)
  const groups = new Map<string, FlowEdge>()
  const visible = new Set<string>()
  const scopedNodes = new Set<string>()
  const from = filters.from ? Date.parse(filters.from) : -Infinity
  const to = filters.to ? Date.parse(filters.to) : Infinity
  let count = 0
  for (const event of data.transfers) {
    if (core?.has(event.id) || included.has(event.id)) {
      scopedNodes.add(event.source)
      scopedNodes.add(event.target)
    }
    const source = mapping.get(event.source) ?? event.source
    const target = mapping.get(event.target) ?? event.target
    const forced = event.id === reveal || event.evidence === reveal && !!reveal
    const time = Date.parse(event.time)
    if (!forced && (!matchesPair(source, target) || !layerShows(event.id) || (core && !core.has(event.id) && !included.has(event.id)) || (filters.asset && event.assetId !== filters.asset)
      || (filters.includeContext === false && event.context)
      || time < from || time >= to || (filterAddresses && ![event.source, event.target, source, target].some(id => filterAddresses.has(id)))
      || hidden.has(source + ':out') || hidden.has(target + ':in'))) continue
    count++
    visible.add(source)
    visible.add(target)
    if (!forced && source === target && event.source !== event.target) continue
    const id = 'flow:' + JSON.stringify([source, target, event.assetId])
    let edge = groups.get(id)
    if (!edge) {
      edge = { id, source, target, asset: event.asset, events: [] }
      groups.set(id, edge)
    }
    edge.events.push(event)
  }
  for (const edge of groups.values()) {
    edge.events.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id))
    edge.amount = sumDecimal(edge.events.map(event => event.amount))
  }
  for (const relation of edits.relations) {
    if (!layerShows(relation.id) && relation.id !== reveal) continue
    const source = mapping.get(relation.source) ?? relation.source
    const target = mapping.get(relation.target) ?? relation.target
    if (!nodes.has(source) || !nodes.has(target)) continue
    if (!matchesPair(source, target) && relation.id !== reveal) continue
    if (filterAddresses && ![relation.source, relation.target, source, target].some(id => filterAddresses.has(id))) continue
    visible.add(source)
    visible.add(target)
    groups.set(relation.id, { ...relation, source, target, events: [] })
  }
  const connected = new Set(data.transfers.flatMap(item => [item.source, item.target]))
  if (!filters.asset && !filters.from && !filters.to && !filters.address) {
    for (const node of data.addresses) {
      const standalone = !connected.has(node.id)
      const inLayer = allowed.has(node.id) && (!core || scopedNodes.has(node.id))
      if (layerShows(node.id) && (inLayer || standalone)) visible.add(mapping.get(node.id) ?? node.id)
    }
  }
  if (filters.address && nodes.has(filters.address) &&
    (layerShows(filters.address) || nodes.get(filters.address)?.members?.some(layerShows))) {
    visible.add(mapping.get(filters.address) ?? filters.address)
  }
  for (const key of hidden) {
    const id = key.slice(0, key.lastIndexOf(':'))
    if (nodes.has(id) && (layerShows(id) || nodes.get(id)?.members?.some(layerShows))) visible.add(id)
  }
  for (const id of included) {
    if (nodes.has(id) && layerShows(id) && (!filterAddresses || filterAddresses.has(id))) visible.add(mapping.get(id) ?? id)
  }
  if (reveal && nodes.has(reveal)) visible.add(mapping.get(reveal) ?? reveal)
  if (pair) {
    const pairVisible = new Set([...pair, ...Array.from(groups.values()).flatMap(edge => [edge.source, edge.target])])
    for (const id of visible) if (id !== reveal && !pairVisible.has(id)) visible.delete(id)
  }
  return { nodes: [...visible].map(id => nodes.get(id)).filter((node): node is FlowNode => !!node), edges: [...groups.values()], count }
}

export function latestBalances(data: CaseData, members: string[], until?: string): Balance[] {
  const balances = new Map<string, Balance>()
  const ids = new Set(members)
  const cutoff = until ? Date.parse(until) : Infinity
  for (const item of data.balances ?? []) {
    if (!ids.has(item.addressId) || Date.parse(item.time) >= cutoff) continue
    const key = JSON.stringify([item.addressId, item.assetId])
    const previous = balances.get(key)
    if (!previous || Date.parse(previous.time) < Date.parse(item.time)) balances.set(key, item)
  }
  return [...balances.values()]
}

export interface HistorySnapshot { value: Edits; past: Edits[]; future: Edits[] }

export class History {
  private past: Edits[] = []
  private future: Edits[] = []

  constructor(public value = emptyEdits()) {}

  static restore(saved?: Edits | HistorySnapshot): History {
    if (!saved || !('value' in saved)) return new History(saved)
    const history = new History(saved.value)
    history.past = saved.past
    history.future = saved.future
    return history
  }

  snapshot(): HistorySnapshot {
    return { value: this.value, past: this.past, future: this.future }
  }

  change(apply: (draft: Edits) => void) {
    const next = structuredClone(this.value)
    apply(next)
    this.past.push(this.value)
    if (this.past.length > 100) this.past.shift()
    this.value = next
    this.future = []
  }

  undo() {
    const previous = this.past.pop()
    if (previous) {
      this.future.push(this.value)
      this.value = previous
    }
  }

  redo() {
    const next = this.future.pop()
    if (next) {
      this.past.push(this.value)
      this.value = next
    }
  }
}
