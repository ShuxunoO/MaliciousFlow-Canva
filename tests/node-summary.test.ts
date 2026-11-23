import { expect, it } from 'vitest'
import { emptyEdits, project } from '../src/case'
import { demo } from '../src/demo'
import { nodeAssets } from '../src/node-summary'
import { answerQuestion } from '../src/agent-context'

it('calculates exact displayed flows and snapshot valuation for the relay', () => {
  const view = project(demo, emptyEdits())
  const assets = nodeAssets(demo, view).get('relay')!
  const relay = view.nodes.find(node => node.id === 'relay')!
  expect(assets[0]).toMatchObject({ incoming: ['24.75'], outgoing: ['12.75', '8', '3.5'], balances: ['19'], prices: ['6800'] })
  expect(answerQuestion('What is the balance?', { caseId: demo.id, node: relay, filters: {}, transfers: [], assets }))
    .toEqual({ text: 'Relay wallet · 19 ETH · $6800', refs: ['relay'] })
  expect(nodeAssets(demo, view, '2020-09-26').get('relay')![0].balances).toEqual([])
})
