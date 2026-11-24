import kucoin from '../assets/icons/brands/kucoin.svg?inline'
import tornadoCash from '../assets/icons/brands/tornado-cash.svg?inline'
import uniswap from '../assets/icons/brands/uniswap.svg?inline'
import caller from '../assets/icons/roles/caller.svg?inline'
import contract from '../assets/icons/roles/contract.svg?inline'
import depositor from '../assets/icons/roles/depositor.svg?inline'
import distributor from '../assets/icons/roles/distributor.svg?inline'
import endpoint from '../assets/icons/roles/endpoint.svg?inline'
import funder from '../assets/icons/roles/funder.svg?inline'
import hotWallet from '../assets/icons/roles/hot_wallet.svg?inline'
import intermediary from '../assets/icons/roles/intermediary.svg?inline'
import pool from '../assets/icons/roles/pool.svg?inline'
import recipient from '../assets/icons/roles/recipient.svg?inline'
import service from '../assets/icons/roles/service.svg?inline'
import source from '../assets/icons/roles/source.svg?inline'
import type { FlowNode } from './case'

const icons = new Map(Object.entries({
  kucoin, 'tornado-cash': tornadoCash, uniswap, caller, contract, depositor, distributor,
  endpoint, funder, hot_wallet: hotWallet, intermediary, pool, recipient, service, source,
}))

export function addressIcon(node: FlowNode): string | undefined {
  if (node.members) return
  const role = node.role === 'Exchange wallet' ? 'hot_wallet' : node.role === 'Protocol pool' ? 'pool' : 'endpoint'
  return icons.get(node.icon ?? role) ?? endpoint
}

export function addressAccent(color?: string) {
  return color && /^#[a-f\d]{6}$/i.test(color) ? color : '#93aafa'
}
