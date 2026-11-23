import { expect, it, vi } from 'vitest'
import { traceTransfers } from '../src/trace'
import type { Collected } from '../src/blockscout'
import type { Transfer } from '../src/case'

const addresses = Array.from({ length: 12 }, (_, index) => {
  const address = '0x' + (index + 1).toString(16).padStart(40, '0')
  return { id: 'eth:' + address, address, name: 'Address ' + index }
})
const hash = '0x' + 'f'.repeat(64)

function transfer(id: string, source: number, target: number, day: number, assetId = '1:native'): Transfer {
  return { id, source: addresses[source].id, target: addresses[target].id, hash,
    time: '2026-01-' + String(day).padStart(2, '0') + 'T00:00:00Z',
    asset: assetId === '1:native' ? 'ETH' : 'USDC', amount: '1', assetId, sources: ['provider'] }
}

function mockProvider(feeds: Record<string, Transfer[]>) {
  return vi.fn(async (seed: string, publish: (batch: Collected) => Promise<void>) => {
    if (!(seed in feeds)) throw new Error('Provider unavailable')
    await publish({ addresses, transfers: feeds[seed] })
    return 'Fixture provider'
  })
}

it('expands a hash downstream in asset and time order and emits each event once', async () => {
  const first = transfer('first', 0, 1, 3)
  const second = transfer('second', 1, 2, 4)
  const third = transfer('third', 2, 0, 5)
  const query = mockProvider({ [hash]: [first], [addresses[1].address]: [
    first, second, second, transfer('wrong time', 1, 3, 2),
    transfer('same time', 1, 3, 3), transfer('wrong token', 1, 3, 5, '1:usdc'),
    transfer('wrong direction', 3, 1, 6),
  ], [addresses[2].address]: [third, second] })
  const emitted: string[][] = []
  const result = await traceTransfers(query, hash, { direction: 'downstream', hops: 3 },
    async batch => { emitted.push(batch.transfers.map(event => event.id)) }, () => {})
  expect(emitted).toEqual([['first'], ['second'], ['third']])
  expect(result.hops).toEqual(emitted)
  expect(result.followedAddresses).toBe(2)
  expect(result.coverage).toContain('candidate connections')
})

it('traces an address upstream using earlier transfers', async () => {
  const query = mockProvider({ [addresses[1].address]: [
    transfer('in', 0, 1, 3), transfer('out', 1, 2, 4),
  ], [addresses[0].address]: [transfer('previous', 2, 0, 2), transfer('later', 3, 0, 4)] })
  const result = await traceTransfers(query, addresses[1].address, { direction: 'upstream', hops: 2 }, async () => {}, () => {})
  expect(result.hops).toEqual([['in'], ['previous']])
})

it('bounds follow-up requests and reports provider failures', async () => {
  const root = addresses.slice(1).map((_, index) => transfer('root-' + index, 0, index + 1, 3))
  const query = mockProvider({ [hash]: root })
  const result = await traceTransfers(query, hash, { direction: 'downstream', hops: 2 }, async () => {}, () => {})
  expect(query).toHaveBeenCalledTimes(9)
  expect(result).toMatchObject({ followedAddresses: 8, limited: true, failed: 8 })
})

it('preserves a published seed batch when a later provider request fails or is cancelled', async () => {
  const first = transfer('first', 0, 1, 3)
  const failing = async (_: string, publish: (batch: Collected) => Promise<void>) => {
    await publish({ addresses, transfers: [first] })
    throw new Error('Provider unavailable')
  }
  const publish = vi.fn(async () => {})
  await expect(traceTransfers(failing, hash, { direction: 'downstream', hops: 2 }, publish, () => {}))
    .rejects.toThrow('Provider unavailable')
  expect(publish).toHaveBeenCalledTimes(1)
  const signal = new AbortController()
  const query = mockProvider({ [hash]: [first] })
  await expect(traceTransfers(query, hash, { direction: 'downstream', hops: 2 },
    async () => { signal.abort() }, () => {}, signal.signal)).rejects.toThrow()
  expect(query).toHaveBeenCalledTimes(1)
})
