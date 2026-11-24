import type { Filters, FlowNode, Transfer } from './case'
import { sumDecimal } from './case'
import type { NodeAsset } from './node-summary'
import { investigationSummary } from './investigation'

export interface AgentContext {
  caseId: string
  selection?: { type: 'node' | 'edge'; id: string }
  node?: FlowNode
  selectedNodes?: FlowNode[]
  filters: Filters
  transfers: Transfer[]
  assets: NodeAsset[]
}

export interface AgentReply { text: string; refs: string[] }
export type AgentHandler = (request: { question: string; context: AgentContext; history: AgentReply[] }) => AgentReply | Promise<AgentReply>

export function answerQuestion(question: string, context: AgentContext): AgentReply {
  const transfers = context.transfers
  const refs = transfers.slice(0, 30).map(item => item.evidence ?? item.id)
  const subject = context.node?.name ?? (context.selection?.type === 'edge' ? 'Selected edge'
    : context.selectedNodes?.length ? context.selectedNodes.length + ' selected nodes' : 'Visible canvas')
  if (/\b(balance|snapshot|usd|valuation)\b/i.test(question)) {
    if (context.node) {
      const balances = context.assets.filter(asset => asset.balances.length)
      const text = balances.map(asset => {
        const usd = asset.prices.length ? ' · $' + sumDecimal(asset.prices)
          + (asset.prices.length < asset.snapshots ? ' (partial coverage)' : '') : ' · USD unavailable'
        return sumDecimal(asset.balances) + ' ' + asset.symbol + usd
      }).join(', ')
      return { text: subject + ' · ' + (text || 'No balance snapshot available.'), refs: [context.node.id] }
    }
    const priced = transfers.flatMap(transfer => transfer.usd === undefined ? [] : [transfer.usd])
    return { text: priced.length ? subject + ' · $' + sumDecimal(priced)
      + ' across ' + priced.length + ' of ' + transfers.length + ' transfers.' : 'No USD valuations are available for these transfers.', refs }
  }
  if (context.node && /\b(inflow|outflow|incoming|outgoing|received|sent)\b/i.test(question)) {
    const outgoing = /\b(outflow|outgoing|sent)\b/i.test(question)
    const members = new Set(context.node.members ?? [context.node.id])
    const shown = transfers.filter(transfer => members.has(outgoing ? transfer.source : transfer.target))
    return { text: subject + ' · ' + investigationSummary(shown), refs: shown.slice(0, 30).map(item => item.evidence ?? item.id) }
  }
  if (/\b(source|sources|evidence|verify|hash)\b/i.test(question)) {
    const sources = [...new Set(transfers.flatMap(transfer => transfer.sources ?? []))].slice(0, 4)
    return { text: sources.length ? 'Sources for ' + subject + '\n' + sources.join('\n') : 'No transaction sources are available for this selection.', refs }
  }
  return { text: subject + ' · ' + investigationSummary(transfers), refs }
}
