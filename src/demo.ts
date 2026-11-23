import type { CaseData } from './case'

export const demo: CaseData = {
  id: 'canvas-workshop',
  title: '资金流工作台示例',
  addresses: [
    { id: 'origin', address: '0xa146a09b6e9ece00000000000000000000000001', name: '资金起点', role: '源地址', column: 0, color: '#73a8fa' },
    { id: 'relay', address: '0xba3d42cb00000000000000000000000000000002', name: '中转钱包', role: '中转', column: 1, color: '#6cdbba' },
    { id: 'alpha', address: '0x2da6c30000000000000000000000000000000003', name: '收款钱包 A', role: '收款', column: 2, color: '#ba9afa' },
    { id: 'beta', address: '0x78cd8b0000000000000000000000000000000004', name: '收款钱包 B', role: '收款', column: 2, color: '#ba9afa' },
    { id: 'gamma', address: '0x7f2c2a0000000000000000000000000000000005', name: '收款钱包 C', role: '收款', column: 2, color: '#ba9afa' },
  ],
  transfers: [
    ['origin', 'relay', '18.5', 'ETH'],
    ['origin', 'relay', '6.25', 'ETH'],
    ['relay', 'alpha', '12.75', 'ETH'],
    ['relay', 'beta', '8', 'ETH'],
    ['relay', 'gamma', '3.5', 'ETH'],
    ['gamma', 'origin', '0.5', 'ETH'],
  ].map(([source, target, amount, asset], index) => ({
    id: 'demo-' + index, hash: '0x' + String(index + 1).padStart(64, '0'),
    evidence: 'D-' + (index + 1), time: '2020-09-' + (25 + Math.floor(index / 3)) + 'T0' + index + ':00:00Z',
    source, target, amount, asset, assetId: '1:native', sources: ['示例数据'],
  })),
  balances: [{ addressId: 'relay', assetId: '1:native', asset: 'ETH', amount: '19', time: '2020-09-27T00:00:00Z', usd: '6800', source: '示例快照' }],
  chapters: [
    { id: 'entry', title: '资金进入中转钱包', text: '两笔 ETH 转入同一中转地址。查看交易明细核对金额及发生时间。', refs: ['D-1', 'D-2'] },
    { id: 'distribution', title: '中转后的分流', text: '资金随后转向三个收款钱包。末笔记录为从收款地址回到起点的转账。', refs: ['D-3', 'D-4', 'D-5', 'D-6'] },
  ],
}
