import type { AnalysisState } from './investigation'
import type { Conclusion } from './report'

export type Point = [number, number]

export interface Address {
  id: string
  address: string
  name: string
  role?: string
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
}

export interface Entity { id: string; name: string; members: string[] }
export interface Relation { id: string; source: string; target: string; note: string }
export interface Draft { id: string; text: string; refs: string[]; chapter?: string }
export interface Edits {
  title?: string
  names: Record<string, string>
  notes: Record<string, string>
  positions: Record<string, Point>
  bends: Record<string, number>
  entities: Entity[]
  relations: Relation[]
  drafts: Draft[]
  conclusions?: Record<string, Conclusion>
}

export interface Filters { asset?: string; from?: string; to?: string; address?: string; core?: boolean }
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
    if (!item.id || typeof item.address !== 'string' || typeof item.name !== 'string') throw new Error('地址数据无效')
    addresses.set(item.id, item)
  }
  for (const item of incoming.transfers) {
    if (!item.id || !item.hash || !item.assetId || !addresses.has(item.source) || !addresses.has(item.target)
      || typeof item.asset !== 'string' || (item.usd !== undefined && (typeof item.usd !== 'string' || !/^\d+(\.\d+)?$/.test(item.usd)))
      || !Number.isFinite(Date.parse(item.time)) || typeof item.amount !== 'string' || !/^\d+(\.\d+)?$/.test(item.amount)) {
      throw new Error('交易记录无效 ' + item.id)
    }
    const existing = transfers.get(item.id)
    if (existing && (existing.source !== item.source || existing.target !== item.target || existing.hash !== item.hash
      || existing.assetId !== item.assetId || Date.parse(existing.time) !== Date.parse(item.time)
      || sumDecimal([existing.amount]) !== sumDecimal([item.amount]))) throw new Error('事件 ID 冲突 ' + item.id)
    transfers.set(item.id, { ...existing, ...item, sources: [...new Set([...(existing?.sources ?? []), ...(item.sources ?? [])])] })
  }
  const balances = new Map((previous.balances ?? []).map(item => [JSON.stringify([item.addressId, item.assetId, item.time]), item]))
  for (const item of incoming.balances ?? []) {
    if (!addresses.has(item.addressId) || !item.assetId || !item.source || !Number.isFinite(Date.parse(item.time))
      || !/^\d+(\.\d+)?$/.test(item.amount) || (item.usd !== undefined && !/^\d+(\.\d+)?$/.test(item.usd))) {
      throw new Error('余额快照无效 ' + item.addressId)
    }
    balances.set(JSON.stringify([item.addressId, item.assetId, item.time]), item)
  }
  return { ...previous, addresses: [...addresses.values()], transfers: [...transfers.values()], balances: [...balances.values()] }
}

export function project(data: CaseData, edits: Edits, filters: Filters = {}, grouped = false,
  hidden = new Set<string>(), reveal?: string): FlowView {
  const core = filters.core && data.core ? new Set(data.core) : undefined
  const mapping = new Map<string, string>()
  const nodes = new Map<string, FlowNode>(data.addresses.map(item => [item.id, { ...item, name: edits.names[item.id] ?? item.name }]))
  if (grouped) for (const entity of edits.entities) {
    const members = entity.members.filter(id => nodes.has(id))
    if (!members.length) continue
    for (const id of members) mapping.set(id, entity.id)
    nodes.set(entity.id, { id: entity.id, name: edits.names[entity.id] ?? entity.name,
      address: members.length + ' 个地址', role: '实体', members,
      column: Math.min(...members.map(id => nodes.get(id)?.column ?? 0)) })
  }
  const groups = new Map<string, FlowEdge>()
  const visible = new Set<string>()
  const from = filters.from ? Date.parse(filters.from) : -Infinity
  const to = filters.to ? Date.parse(filters.to) : Infinity
  let count = 0
  for (const event of data.transfers) {
    const source = mapping.get(event.source) ?? event.source
    const target = mapping.get(event.target) ?? event.target
    const forced = event.id === reveal || event.evidence === reveal && !!reveal
    const time = Date.parse(event.time)
    if (!forced && ((core && !core.has(event.id)) || (filters.asset && event.assetId !== filters.asset)
      || time < from || time >= to || (filters.address && ![event.source, event.target, source, target].includes(filters.address))
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
    const source = mapping.get(relation.source) ?? relation.source
    const target = mapping.get(relation.target) ?? relation.target
    if (!nodes.has(source) || !nodes.has(target)) continue
    if (filters.address && filters.address !== source && filters.address !== target) continue
    visible.add(source)
    visible.add(target)
    groups.set(relation.id, { ...relation, source, target, events: [] })
  }
  const connected = new Set(data.transfers.flatMap(item => [item.source, item.target]))
  if (!filters.asset && !filters.from && !filters.to && !filters.address) {
    for (const node of data.addresses) if (!connected.has(node.id)) visible.add(mapping.get(node.id) ?? node.id)
  }
  if (filters.address && nodes.has(filters.address)) visible.add(mapping.get(filters.address) ?? filters.address)
  for (const key of hidden) {
    const id = key.slice(0, key.lastIndexOf(':'))
    if (nodes.has(id)) visible.add(id)
  }
  if (reveal && nodes.has(reveal)) visible.add(mapping.get(reveal) ?? reveal)
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

export class History {
  private past: Edits[] = []
  private future: Edits[] = []

  constructor(public value = emptyEdits()) {}

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
