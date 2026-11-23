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
    || (batch.balances !== undefined && !Array.isArray(batch.balances))) throw new Error('分析批次格式或案件 ID 无效')
  const state = data.analysis ?? { revision: 0, receipts: {} }
  const signature = JSON.stringify(batch)
  const saved = Object.hasOwn(state.receipts, batch.requestId) ? state.receipts[batch.requestId] : undefined
  if (saved) {
    if (signature !== saved.signature) throw new Error('请求 ID 已用于不同批次')
    return { data, receipt: saved.receipt }
  }
  if (batch.expectedRevision !== state.revision) throw new Error('案件版本冲突，请读取最新版本后重试')
  if (batch.transfers.some(event => !event.sources?.length || event.sources.some(source => typeof source !== 'string' || !source))) {
    throw new Error('分析交易缺少来源')
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
  return events.length ? `采集到 ${events.length} 笔转账事件。逐笔金额合计为 ${totals.join('、')}。各资产分别汇总，重复经过同一资金的转账仍各计一笔。` : '本次查询没有找到支持范围内的已确认转账。'
}

export function entityMembers(data: CaseData, edits: import('./case').Edits, name: string, members: string[]) {
  const addresses = new Set(data.addresses.map(item => item.id))
  const unique = [...new Set(members)]
  if (!name.trim() || !unique.length || unique.some(id => !addresses.has(id))) throw new Error('实体名称或成员无效')
  return unique.map(id => ({ id, previous: edits.entities.find(entity => entity.members.includes(id))?.name }))
}
