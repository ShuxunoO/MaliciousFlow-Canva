import { latestBalances, sumDecimal, type CaseData, type FlowView } from './case'

export interface NodeAsset {
  id: string
  symbol: string
  incoming: string[]
  outgoing: string[]
  balances: string[]
  prices: string[]
  snapshots: number
}

export function nodeAssets(data: CaseData, view: FlowView, until?: string) {
  const byNode = new Map(view.nodes.map(node => [node.id, new Map<string, NodeAsset>()]))
  const asset = (id: string, assetId: string, symbol: string) => {
    const assets = byNode.get(id)!
    let entry = assets.get(assetId)
    if (!entry) {
      entry = { id: assetId, symbol, incoming: [], outgoing: [], balances: [], prices: [], snapshots: 0 }
      assets.set(assetId, entry)
    }
    return entry
  }

  for (const edge of view.edges) {
    const transfer = edge.events[0]
    if (!transfer || !edge.amount) continue
    asset(edge.source, transfer.assetId, transfer.asset).outgoing.push(edge.amount)
    asset(edge.target, transfer.assetId, transfer.asset).incoming.push(edge.amount)
  }
  const snapshots = new Map<string, ReturnType<typeof latestBalances>>()
  for (const balance of latestBalances(data, [...new Set((data.balances ?? []).map(item => item.addressId))], until)) {
    const list = snapshots.get(balance.addressId) ?? []
    list.push(balance)
    snapshots.set(balance.addressId, list)
  }
  for (const node of view.nodes) {
    for (const member of node.members ?? [node.id]) {
      for (const balance of snapshots.get(member) ?? []) {
        const entry = asset(node.id, balance.assetId, balance.asset)
        entry.balances.push(balance.amount)
        if (balance.usd !== undefined) entry.prices.push(balance.usd)
        entry.snapshots++
      }
    }
  }

  return new Map([...byNode].map(([id, assets]) => [id, [...assets.values()].sort((a, b) => b.snapshots - a.snapshots)]))
}

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 3 })
const plainNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

export function compactQuantity(values: string[]) {
  const total = sumDecimal(values)
  if (!values.length) return '–'
  const number = Number(total)
  if (!Number.isFinite(number)) return total.slice(0, 7) + '…'
  if (number > 0 && number < .001) return '<0.001'
  return (number >= 1000 ? compactNumber : plainNumber).format(number)
}
