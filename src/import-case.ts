import { transact, type CaseData, type Chapter } from './case'

interface KuCoinPayload {
  nodes: { id: string; address: string; code: string; label?: string; roleName?: string; color?: string }[]
  events: { id: string; source: string; target: string; hash: string; timestamp: string; asset: string;
    amount: string; amountRaw?: string; verification?: string; token?: string; exhibit?: string; sources?: string[]; note?: string }[]
  views: {
    all: { nodes: { id: string; data?: { layoutColumn?: number; layoutBatch?: string } }[] }
    core: { edges: { data: { events: number[] } }[] }
  }
}

export function isKuCoin(raw: unknown): raw is KuCoinPayload {
  if (!raw || typeof raw !== 'object') return false
  const data = raw as Partial<KuCoinPayload>
  return Array.isArray(data.nodes) && Array.isArray(data.events)
    && Array.isArray(data.views?.all?.nodes) && Array.isArray(data.views?.core?.edges)
}

export function importCase(raw: unknown, chapters?: Chapter[]): CaseData {
  let data: CaseData
  if (isKuCoin(raw)) {
    const columns = new Map(raw.views.all.nodes.map(item => [item.id, item.data?.layoutColumn]))
    const core = new Set(raw.views.core.edges.flatMap(edge => edge.data.events))
    const events = raw.events.map(event => ({
      id: event.id, source: event.source, target: event.target, hash: event.hash,
      time: event.timestamp, asset: event.asset, assetId: '1:' + (event.token?.toLowerCase() || 'native'),
      amount: event.amount, rawAmount: event.amountRaw, verification: event.verification, evidence: event.exhibit || undefined, sources: event.sources, note: event.note,
    }))
    for (const index of core) {
      if (!Number.isInteger(index) || !events[index]) throw new Error('KuCoin 核心视图引用无效')
    }
    const sections = new Map<string, string[]>()
    for (const event of events) {
      if (!event.evidence) continue
      const section = event.evidence.split('-').slice(1, -1).join('.')
      if (!sections.has(section)) sections.set(section, [])
      sections.get(section)!.push(event.evidence)
    }
    data = {
      id: 'kucoin-2020',
      title: 'KuCoin 2020 · 资金流调查',
      addresses: raw.nodes.map(node => ({
        id: node.id, address: node.address, name: node.label || node.code || node.address,
        role: node.roleName, column: columns.get(node.id), color: node.color,
      })),
      transfers: events,
      core: [...core].map(index => events[index].id),
      chapters: chapters ?? [...sections].map(([id, refs]) => ({
        id, title: '账本 ' + id, text: refs.length + ' 条交易证据', refs,
      })),
    }
  } else {
    const item = raw as Partial<CaseData> | undefined
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string'
      || !Array.isArray(item.addresses) || !Array.isArray(item.transfers)) throw new Error('案件格式无效')
    data = item as CaseData
    if (chapters) data = { ...data, chapters }
  }
  return transact({ ...data, addresses: [], transfers: [], balances: [] }, data)
}
