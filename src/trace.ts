import type { Collected } from './blockscout'
import type { Address, Transfer } from './case'

export interface TraceOptions {
  direction: 'upstream' | 'downstream'
  hops: number
}

type Publish = (batch: Collected) => Promise<void>
type Query = (seed: string, publish: Publish, status: (message: string) => void, signal?: AbortSignal) => Promise<string>

interface Frontier {
  id: string
  asset: string
  time: number
}

const addressBudget = 8

export async function traceTransfers(query: Query, seed: string, options: TraceOptions, publish: Publish,
  status: (message: string) => void, signal?: AbortSignal) {
  if (!Number.isInteger(options.hops) || options.hops < 1 || options.hops > 3) throw new Error('Choose between 1 and 3 hops')
  if (options.direction !== 'upstream' && options.direction !== 'downstream') throw new Error('Choose a trace direction')
  seed = seed.trim().toLowerCase()
  const byHash = /^0x[0-9a-f]{64}$/.test(seed)
  if (!byHash && !/^0x[0-9a-f]{40}$/.test(seed)) throw new Error('Enter an Ethereum address or transaction hash')

  const downstream = options.direction === 'downstream'
  const start = downstream ? 'source' : 'target'
  const end = downstream ? 'target' : 'source'
  const after = (left: number, right: number) => downstream ? left > right : left < right
  const addresses = new Map<string, Address>()
  const seen = new Set<string>()
  const matchesByHop: string[][] = []
  const cached = new Map<string, Transfer[]>()
  let failed = 0
  let limited = false

  function remember(batch: Collected) {
    for (const address of batch.addresses) addresses.set(address.id, address)
  }

  async function emit(events: Transfer[]) {
    const fresh = new Map(events.filter(event => !seen.has(event.id)).map(event => [event.id, event]))
    if (!fresh.size) return []
    const endpoints = new Set([...fresh.values()].flatMap(event => [event.source, event.target]))
    const batch = [...endpoints].map(id => addresses.get(id))
    if (batch.some(address => !address)) throw new Error('Missing transfer endpoints')
    await publish({ addresses: batch as Address[], transfers: [...fresh.values()] })
    for (const id of fresh.keys()) seen.add(id)
    return [...fresh.values()]
  }

  let layer: Transfer[] = []
  const seedId = 'eth:' + seed
  const coverage = await query(seed, async batch => {
    remember(batch)
    if (!byHash && batch.balances?.length) await publish({ addresses: batch.addresses, transfers: [], balances: batch.balances })
    signal?.throwIfAborted()
    layer.push(...await emit(batch.transfers.filter(event => byHash || event[start] === seedId)))
  }, status, signal)
  signal?.throwIfAborted()
  matchesByHop.push(layer.map(event => event.id))

  for (let hop = 2; hop <= options.hops && layer.length; hop++) {
    const frontier = new Map<string, Map<string, Frontier>>()
    for (const event of layer) {
      const addressId = event[end]
      const timestamp = Date.parse(event.time)
      const assets = frontier.get(addressId) ?? new Map<string, Frontier>()
      const current = assets.get(event.assetId)
      if (!current || after(current.time, timestamp)) assets.set(event.assetId, { id: addressId, asset: event.assetId, time: timestamp })
      frontier.set(addressId, assets)
    }

    status(`Searching hop ${hop} of ${options.hops}`)
    layer = []
    for (const [addressId, assets] of frontier) {
      signal?.throwIfAborted()
      const address = addresses.get(addressId)
      if (!address) continue
      let events = cached.get(addressId)
      if (!events) {
        if (cached.size >= addressBudget) {
          limited = true
          continue
        }
        events = []
        const fetched = events
        cached.set(addressId, events)
        try {
          await query(address.address, async batch => {
            remember(batch)
            fetched.push(...batch.transfers)
          }, () => {}, signal)
        } catch {
          signal?.throwIfAborted()
          failed++
        }
      }
      signal?.throwIfAborted()
      const candidates = events.filter(event => {
        const previous = assets.get(event.assetId)
        return previous && event[start] === previous.id && after(Date.parse(event.time), previous.time)
      })
      layer.push(...await emit(candidates))
    }
    matchesByHop.push(layer.map(event => event.id))
  }

  const summary = [
    `${options.direction === 'upstream' ? 'Upstream' : 'Downstream'} search, up to ${options.hops} hops.`,
    coverage,
    'Follow-up searches use the same asset and strictly ordered UTC timestamps within the provider’s recent pages. Matches show candidate connections.',
    limited ? 'The follow-up address limit was reached.' : '',
    failed ? `${failed} follow-up address queries had provider errors.` : '',
  ].filter(Boolean).join(' ')
  return { coverage: summary, hops: matchesByHop, followedAddresses: cached.size, limited, failed }
}
