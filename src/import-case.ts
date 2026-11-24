import { transact, type CaseData, type Chapter } from './case'

interface SourceView {
  nodes?: { id: string; data?: { layoutColumn?: number } }[]
  edges: { data: { events: number[] } }[]
}

interface KuCoinPayload {
  nodes: { id: string; address: string; code: string; label?: string; roleName?: string; role?: string; color?: string }[]
  events: { id: string; source: string; target: string; hash: string; timestamp: string; asset: string;
    amount: string; amountRaw?: string; verification?: string; token?: string; exhibit?: string; sources?: string[];
    note?: string; section?: string }[]
  views: Record<string, SourceView>
}

export function isKuCoin(raw: unknown): raw is KuCoinPayload {
  if (!raw || typeof raw !== 'object') return false
  const data = raw as Partial<KuCoinPayload>
  return Array.isArray(data.nodes) && Array.isArray(data.events)
    && Array.isArray(data.views?.all?.nodes) && Array.isArray(data.views?.core?.edges)
}

const kucoinRoles: Record<string, string> = {
  endpoint: 'Public endpoint', recipient: 'Withdrawal recipient', distributor: 'Collection / distribution',
  intermediary: 'Upstream intermediary', depositor: 'Deposit initiator', service: 'Service execution',
  pool: 'Privacy protocol pool', caller: 'Withdrawal execution', funder: 'Funding / return',
  hot_wallet: 'Historical hot wallet', source: 'Incident recipient', contract: 'Contract',
}

function kucoinIcon(node: KuCoinPayload['nodes'][number]) {
  if (node.role === 'hot_wallet' && /^kucoin\b/i.test(node.label ?? '')) return 'kucoin'
  if (node.role === 'pool') return 'tornado-cash'
  if (node.code === 'UNI1' || /^uniswap v\d+: router\b/i.test(node.label ?? '')) return 'uniswap'
  return node.role
}

export function importCase(raw: unknown, chapters?: Chapter[]): CaseData {
  let data: CaseData
  if (isKuCoin(raw)) {
    const views: Record<string, string[]> = {}
    const viewColumns: NonNullable<CaseData['viewColumns']> = {}
    const returnEvents = new Set(raw.views.return?.edges.flatMap(edge => edge.data.events))
    const returnHashes = new Set([...returnEvents].map(index => raw.events[index]?.hash))
    const events = raw.events.map(event => ({
      id: event.id, source: event.source, target: event.target, hash: event.hash,
      time: event.timestamp, asset: event.asset, assetId: '1:' + (event.token?.toLowerCase() || 'native'),
      amount: event.amount, rawAmount: event.amountRaw, verification: event.verification, evidence: event.exhibit || undefined, sources: event.sources, note: event.note,
      context: !returnHashes.has(event.hash) && (event.section === '6.1' || /历史活动|筛选对照/.test(event.note ?? '')),
    }))
    for (const [name, view] of Object.entries(raw.views)) {
      viewColumns[name] = Object.fromEntries((view.nodes ?? []).flatMap(item =>
        Number.isFinite(item.data?.layoutColumn) ? [[item.id, item.data!.layoutColumn!]] : []))
      if (name === 'all' || !('edges' in view)) continue
      const members = new Set(view.edges.flatMap(edge => edge.data.events))
      for (const index of members) if (!Number.isInteger(index) || !events[index]) throw new Error('Invalid KuCoin view reference')
      views[name] = [...members].map(index => events[index].id)
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
      title: 'KuCoin 2020 · Fund Flow Investigation',
      addresses: raw.nodes.map(node => ({
        id: node.id, address: node.address, name: node.label || node.code || node.address,
        role: kucoinRoles[node.role ?? ''] ?? node.roleName,
        column: viewColumns.all[node.id], color: node.color, icon: kucoinIcon(node),
      })),
      transfers: events,
      core: views.core,
      views,
      viewColumns,
      chapters: chapters ?? [...sections].map(([id, refs]) => ({
        id, title: 'Ledger ' + id, text: refs.length + ' transaction records', refs,
      })),
    }
  } else {
    const item = raw as Partial<CaseData> | undefined
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string'
      || !Array.isArray(item.addresses) || !Array.isArray(item.transfers)) throw new Error('Invalid case format')
    data = item as CaseData
    if (chapters) data = { ...data, chapters }
  }
  return transact({ ...data, addresses: [], transfers: [], balances: [] }, data)
}
