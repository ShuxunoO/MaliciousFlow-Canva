import type { CaseData } from './case'

export const demo: CaseData = {
  id: 'canvas-workshop',
  title: 'Fund Flow Investigation',
  addresses: [
    { id: 'origin', address: '0xa146a09b6e9ece00000000000000000000000001', name: 'Origin wallet', role: 'Source', column: 0, color: '#73a8fa' },
    { id: 'relay', address: '0xba3d42cb00000000000000000000000000000002', name: 'Relay wallet', role: 'Relay', column: 1, color: '#6cdbba' },
    { id: 'alpha', address: '0x2da6c30000000000000000000000000000000003', name: 'Recipient A', role: 'Recipient', column: 2, color: '#ba9afa' },
    { id: 'beta', address: '0x78cd8b0000000000000000000000000000000004', name: 'Recipient B', role: 'Recipient', column: 2, color: '#ba9afa' },
    { id: 'gamma', address: '0x7f2c2a0000000000000000000000000000000005', name: 'Recipient C', role: 'Recipient', column: 2, color: '#ba9afa' },
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
    source, target, amount, asset, assetId: '1:native', sources: ['Demo data'],
  })),
  balances: [{ addressId: 'relay', assetId: '1:native', asset: 'ETH', amount: '19', time: '2020-09-27T00:00:00Z', usd: '6800', source: 'Demo snapshot' }],
  chapters: [
    { id: 'entry', title: 'Funding the relay wallet', text: 'Two ETH transfers funded the same relay. Open the evidence to compare the amounts and timestamps.', refs: ['D-1', 'D-2'] },
    { id: 'distribution', title: 'Distribution from the relay', text: 'The relay distributed ETH to three recipient wallets. The final transfer returned funds to the origin.', refs: ['D-3', 'D-4', 'D-5', 'D-6'] },
  ],
}
