import { describe, expect, it } from 'vitest'
import { importCase } from '../src/import-case'
import { emptyEdits, project } from '../src/case'
import { demo } from '../src/demo'

const kucoin = {
  nodes: [{ id: 'eth:a', code: 'A', address: '0xa' }, { id: 'eth:b', code: 'B', address: '0xb' }],
  events: [{
    id: '1:one', source: 'eth:a', target: 'eth:b', hash: '0x1', timestamp: '2020-02-01T00:00:00Z',
    asset: 'USDC', token: '0xCA', amount: '1.000001', exhibit: 'E-1-1', sources: ['v4'],
  }, {
    id: 'case-csv:two', source: 'eth:a', target: 'eth:b', hash: '0x1', timestamp: '2020-02-01T00:00:00Z',
    asset: 'USDC', token: '0xCB', amount: '2', sources: ['case-csv'], section: '6.1',
  }],
  views: {
    all: { nodes: [{ id: 'eth:a', data: { layoutColumn: 3 } }] },
    core: { nodes: [{ id: 'eth:a', data: { layoutColumn: 1 } }], edges: [{ data: { events: [0] } }] },
  },
}

describe('case import', () => {
  it('directly imports KuCoin without losing amounts, UTC time, distinct assets or evidence', () => {
    const data = importCase(kucoin)
    expect(data.addresses[0].column).toBe(3)
    expect(data.transfers[0]).toMatchObject({ id: '1:one', assetId: '1:0xca', amount: '1.000001', time: '2020-02-01T00:00:00Z' })
    expect(data.transfers[1]).toMatchObject({ id: 'case-csv:two', assetId: '1:0xcb', sources: ['case-csv'] })
    expect(data.transfers[1].evidence).toBeUndefined()
    expect(data.chapters?.[0].refs).toEqual(['E-1-1'])
    expect(project(data, emptyEdits(), { core: true }).count).toBe(1)
    expect(project(data, emptyEdits()).count).toBe(2)
  })

  it('rejects an invalid core index and missing endpoints before replacing the case', () => {
    const invalid = structuredClone(kucoin)
    invalid.views.core.edges[0].data.events = [2]
    expect(() => importCase(invalid)).toThrow('Invalid KuCoin view reference')
    const missing = structuredClone(kucoin)
    missing.nodes.pop()
    expect(() => importCase(missing)).toThrow('Invalid transfer')
  })

  it('supports the normal case model and optional chapters', () => {
    expect(importCase(demo, []).chapters).toEqual([])
    expect(() => importCase(null)).toThrow('Invalid case format')
  })

  it('projects scope-specific columns and filters historical events before aggregation', () => {
    const data = importCase(kucoin)
    expect(project(data, emptyEdits(), { core: true }).nodes.find(node => node.id === 'eth:a')?.column).toBe(1)
    expect(project(data, emptyEdits(), { includeContext: false }).edges.map(edge => edge.amount)).toEqual(['1.000001'])
    expect(project(data, emptyEdits(), { includeContext: false }, false, undefined, 'case-csv:two').count).toBe(2)
  })
})
