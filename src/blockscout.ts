import type { Address, Balance, Transfer } from './case'

interface Participant { hash: string; name?: string | null }
interface Transaction { hash: string; status: string | null; timestamp: string | null; value: string; from: Participant;
  to?: Participant | null; created_contract?: Participant | null; historic_exchange_rate?: string | null }
interface TokenEvent { transaction_hash: string; log_index: number | string; timestamp: string; from: Participant; to: Participant;
  total: { value?: string; decimals?: string | number }; token: { address_hash: string; symbol: string; type: string } }
interface Page<T> { items: T[]; next_page_params?: Record<string, string | number | null> | null }
interface Account extends Participant { coin_balance?: string; exchange_rate?: string | null; has_token_transfers?: boolean }
export interface Collected { addresses: Address[]; transfers: Transfer[]; balances?: Balance[] }
type Publish = (batch: Collected) => Promise<void>
type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export function toDecimal(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid on-chain amount or precision')
  const integer = BigInt(raw).toString()
  if (!decimals) return integer
  const digits = integer.padStart(decimals + 1, '0')
  return (digits.slice(0, -decimals) + '.' + digits.slice(-decimals)).replace(/\.?0+$/, '')
}

function estimatedUsd(raw: string, rate?: string | null) {
  if (typeof rate !== 'string' || !/^\d+(\.\d+)?$/.test(rate)) return undefined
  const scale = rate.split('.')[1]?.length ?? 0
  return toDecimal(String(BigInt(raw) * BigInt(rate.replace('.', ''))), 18 + scale)
}

const toAddress = (party: Participant): Address => ({
  id: 'eth:' + party.hash.toLowerCase(), address: party.hash.toLowerCase(),
  name: party.name || party.hash.slice(0, 10) + '…' + party.hash.slice(-6),
})

function collect(transfers: (Transfer | undefined)[], parties: (Participant | null | undefined)[]): Collected {
  const events = transfers.filter((item): item is Transfer => !!item)
  const addresses = new Map(parties.filter((party): party is Participant => !!party?.hash)
    .map(party => { const address = toAddress(party); return [address.id, address] }))
  const used = new Set(events.flatMap(event => [event.source, event.target]))
  return { addresses: [...addresses.values()].filter(address => used.has(address.id)), transfers: events }
}

export function blockscout(baseUrl = 'https://eth.blockscout.com/api/v2', request: Fetch = fetch) {
  const base = baseUrl.replace(/\/$/, '')
  const get = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const timeout = AbortSignal.timeout(20_000)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const init = { signal: requestSignal, headers: { Accept: 'application/json' } }
    let response = await request(base + path, init)
    if (response.status === 502 || response.status === 503 || response.status === 504 || response.status === 500) {
      await response.body?.cancel()
      await new Promise<void>(resolve => setTimeout(resolve, 500))
      requestSignal.throwIfAborted()
      response = await request(base + path, init)
    }
    if (!response.ok) throw new Error('Blockscout request failed (HTTP ' + response.status + ')')
    return response.json()
  }
  const external = (item: Transaction): Transfer | undefined => {
    const target = item.to ?? item.created_contract
    if (item.status !== 'ok' || !item.timestamp || !item.from?.hash || !target?.hash || !/^\d+$/.test(item.value)
      || BigInt(item.value) === 0n) return undefined
    const hash = item.hash.toLowerCase()
    return { id: '1:' + hash + ':external', source: toAddress(item.from).id, target: toAddress(target).id,
      hash, time: item.timestamp, asset: 'ETH', assetId: '1:native', amount: toDecimal(item.value, 18),
      rawAmount: item.value, sources: [base + '/transactions/' + hash], verification: 'blockscout_confirmed',
      usd: estimatedUsd(item.value, item.historic_exchange_rate) }
  }
  const token = (item: TokenEvent): Transfer | undefined => {
    if (item.token?.type !== 'ERC-20' || !item.timestamp || !item.from?.hash || !item.to?.hash || !item.transaction_hash
      || item.total?.decimals == null || !item.total.value || !/^\d+$/.test(item.total.value)
      || BigInt(item.total.value) === 0n || !/^\d+$/.test(String(item.log_index))) return undefined
    const hash = item.transaction_hash.toLowerCase()
    return { id: '1:' + hash + ':log:' + item.log_index, source: toAddress(item.from).id, target: toAddress(item.to).id,
      hash, time: item.timestamp, asset: item.token.symbol || item.token.address_hash,
      assetId: '1:' + item.token.address_hash.toLowerCase(), amount: toDecimal(item.total.value, Number(item.total.decimals)),
      rawAmount: item.total.value, sources: [base + '/transactions/' + hash + '/token-transfers'], verification: 'blockscout_log' }
  }
  async function pages<T>(path: string, handle: (items: T[]) => Promise<void>, signal?: AbortSignal) {
    const cursor = new URLSearchParams()
    for (let index = 0; index < 2; index++) {
      const suffix = cursor.size ? '?' + cursor.toString() : ''
      const page = await get<Page<T>>(path + suffix, signal)
      if (!Array.isArray(page.items)) throw new Error('Invalid Blockscout page response')
      await handle(page.items)
      if (!page.next_page_params) return false
      for (const [key, value] of Object.entries(page.next_page_params)) if (value != null) cursor.set(key, String(value))
    }
    return true
  }
  async function investigate(input: string, publish: Publish, status: (message: string) => void, signal?: AbortSignal) {
    const seed = input.trim().toLowerCase()
    if (!/^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(seed)) throw new Error('Enter an Ethereum address or transaction hash')
    if (seed.length === 66) {
      const endpoint = '/transactions/' + seed
      status('Fetching the transaction')
      const transaction = await get<Transaction>(endpoint, signal)
      if (transaction.status !== 'ok' || !transaction.timestamp) throw new Error('The transaction is pending or failed')
      await publish(collect([external(transaction)], [transaction.from, transaction.to, transaction.created_contract]))
      status('Fetching ERC-20 transfer logs')
      const partial = await pages<TokenEvent>(endpoint + '/token-transfers', async rows =>
        publish(collect(rows.map(token), rows.flatMap(item => [item.from, item.to]))), signal)
      return partial ? 'Fetched the first two pages of ERC-20 logs. More records are available.' : 'Fetched the native transfer and ERC-20 logs.'
    }
    const endpoint = '/addresses/' + seed
    status('Fetching the address and balance snapshot')
    const account = await get<Account>(endpoint, signal)
    const address = toAddress(account)
    const balance = account.coin_balance
    const balances: Balance[] = balance && /^\d+$/.test(balance) ? [{
      addressId: address.id, assetId: '1:native', asset: 'ETH', amount: toDecimal(balance, 18),
      time: new Date().toISOString(), source: base + endpoint, usd: estimatedUsd(balance, account.exchange_rate),
    }] : []
    await publish({ addresses: [address], transfers: [], balances })
    status('Fetching recent native ETH transfers')
    const partialNative = await pages<Transaction>(endpoint + '/transactions', async rows =>
      publish(collect(rows.map(external), rows.flatMap(item => [item.from, item.to, item.created_contract]))), signal)
    const partialToken = account.has_token_transfers !== false && await (async () => {
      status('Fetching recent ERC-20 transfers')
      return pages<TokenEvent>(endpoint + '/token-transfers', async rows =>
        publish(collect(rows.map(token), rows.flatMap(item => [item.from, item.to]))), signal)
    })()
    return partialNative || partialToken ? 'Fetched up to two recent pages. More records are available.' : 'Fetched the native ETH and ERC-20 transfers returned by the provider.'
  }
  return { investigate }
}
