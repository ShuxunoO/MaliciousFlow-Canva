import { describe, expect, it, vi } from 'vitest'
import { blockscout, toDecimal, type Collected } from '../src/blockscout'
import { applyAnalysis, investigationSummary, type AnalysisBatch } from '../src/investigation'
import { demo } from '../src/demo'

const sender = { hash: '0x' + '1'.repeat(40) }
const receiver = { hash: '0x' + '2'.repeat(40) }
const hash = '0x' + '3'.repeat(64)
const timestamp = '2020-11-23T12:00:00Z'
const transfer = { hash, status: 'ok', timestamp, from: sender, to: receiver, value: '1250000000000000000', historic_exchange_rate: '10.01' }
const token = { transaction_hash: hash, log_index: 4, timestamp, from: sender, to: receiver,
  token: { address_hash: '0x' + 'a'.repeat(40), symbol: 'USD', type: 'ERC-20' }, total: { value: '1234567', decimals: '6' } }

describe('Agent collection', () => {
  it('converts fixed-unit amounts with full precision', () => {
    expect(toDecimal('0000', 18)).toBe('0')
    expect(toDecimal('9007199254740993000000000000000001', 18)).toBe('9007199254740993.000000000000000001')
    expect(() => toDecimal('1.4', 6)).toThrow()
  })

  it('emits separately verifiable native and ERC-20 batches with stable event IDs', async () => {
    const request = vi.fn(async (url: string) => Response.json(url.endsWith(hash) ? transfer : { items: [token] }))
    const provider = blockscout('https://provider.example/api/v2', request)
    const batches: Collected[] = []
    await provider.investigate(hash, async batch => { batches.push(batch) }, () => {})
    expect(batches.map(batch => batch.transfers.map(event => [event.id, event.amount, event.usd]))).toEqual([
      [['1:' + hash + ':external', '1.25', '12.5125']],
      [['1:' + hash + ':log:4', '1.234567', undefined]],
    ])
    expect(investigationSummary(batches.flatMap(batch => batch.transfers))).toContain('1.25 ETH, 1.234567 USD')
  })

  it('uses address cursors without treating pending transfers as confirmed', async () => {
    const request = vi.fn(async (url: string) => {
      if (url.endsWith(sender.hash)) return Response.json({ ...sender, coin_balance: '42', has_token_transfers: false })
      return url.includes('?block_number=4')
        ? Response.json({ items: [transfer] })
        : Response.json({ items: [{ ...transfer, status: null }], next_page_params: { block_number: 4 } })
    })
    const seen: Collected[] = []
    await blockscout('https://provider.example', request).investigate(sender.hash, async batch => { seen.push(batch) }, () => {})
    expect(seen.map(batch => batch.transfers.length)).toEqual([0, 0, 1])
    expect(seen[0].balances?.[0].amount).toBe('0.000000000000000042')
    expect(request).toHaveBeenCalledTimes(3)
  })
})

describe('analysis synchronization', () => {
  const batch: AnalysisBatch = { schemaVersion: 1, caseId: demo.id, expectedRevision: 0, requestId: 'req-1',
    addresses: [], transfers: [{ ...demo.transfers[0], id: 'new' }] }

  it('replays the original receipt across persisted versions and deduplicates events', () => {
    const first = applyAnalysis(demo, batch)
    expect(first.receipt).toMatchObject({ revision: 1, added: 1, duplicates: 0 })
    const restored = JSON.parse(JSON.stringify(first.data))
    expect(applyAnalysis(restored, batch)).toEqual({ data: restored, receipt: first.receipt })
    const next = applyAnalysis(restored, { ...batch, expectedRevision: 1, requestId: 'req-2' })
    expect(next.receipt).toMatchObject({ added: 0, duplicates: 1 })
    expect(next.data.transfers).toHaveLength(demo.transfers.length + 1)
  })

  it('rejects stale, mixed-case, changed and unattributed requests', () => {
    const first = applyAnalysis(demo, batch)
    expect(() => applyAnalysis(first.data, { ...batch, requestId: 'req-2' })).toThrow('revision conflict')
    expect(() => applyAnalysis(first.data, { ...batch, transfers: [] })).toThrow('a different batch')
    expect(() => applyAnalysis(first.data, { ...batch, caseId: 'another' })).toThrow('case ID')
    expect(() => applyAnalysis(demo, { ...batch, transfers: batch.transfers.map(event => ({ ...event, sources: [] })) })).toThrow('require a source')
  })
})

it('replaces entity members and removes memberships from previous entities exactly once', async () => {
  const { applyEntityMembership } = await import('../src/investigation')
  const { emptyEdits } = await import('../src/case')
  const state = emptyEdits()
  state.entities = [{ id: 'a', name: 'A', members: ['origin', 'alpha'] }, { id: 'b', name: 'B', members: ['beta'] }]
  applyEntityMembership(state, 'A', ['beta', 'beta'], 'a', true)
  expect(state.entities).toEqual([{ id: 'a', name: 'A', members: ['beta'] }])
  applyEntityMembership(state, 'A', [], 'a', true)
  expect(state.entities).toEqual([])
})

it('replays receipts after a saved revision without exposing mutable case state', async () => {
  const { analysisUpdates } = await import('../src/investigation')
  const seed = { schemaVersion: 1 as const, caseId: demo.id, expectedRevision: 0, requestId: 'first',
    addresses: [], transfers: [demo.transfers[0]] }
  let data = applyAnalysis(demo, seed).data
  data = applyAnalysis(data, { ...seed, expectedRevision: 1, requestId: 'second' }).data
  const response = analysisUpdates(data, demo.id, 1)
  expect(response.receipts.map(item => item.revision)).toEqual([2])
  response.receipts[0].refs.length = 0
  expect(analysisUpdates(data, demo.id, 0).receipts.map(item => item.refs.length)).toEqual([1, 1])
  expect(() => analysisUpdates(data, demo.id, 3)).toThrow('Invalid analysis revision')
})
