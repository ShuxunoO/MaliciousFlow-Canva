import { describe, expect, it } from 'vitest'
import { emptyEdits, History, latestBalances, project, sumDecimal, transact } from '../src/case'
import { demo } from '../src/demo'
import { layout, layoutSettings, NODE_WIDTH, NODE_HEIGHT } from '../src/layout'

describe('case', () => {
  it('adds decimal strings without floating point conversion', () => {
    expect(sumDecimal(['9007199254740993.000000000000000001', '0.000000000000000002'])).toBe('9007199254740993.000000000000000003')
    expect(sumDecimal(['100.000'])).toBe('100')
  })

  it('filters by an exclusive UTC endpoint and derives the aggregate from matching events', () => {
    const graph = project(demo, emptyEdits(), { to: '2020-09-25T01:00:00Z' })
    expect(graph.edges[0].amount).toBe('18.5')
    expect(graph.count).toBe(1)
    expect(project(demo, emptyEdits(), { core: true }).count).toBe(6)
  })

  it('retains event IDs with shared hashes and rejects conflicting batches atomically', () => {
    const existing = demo.transfers[0]
    const added = { ...existing, id: 'another' }
    expect(transact(demo, { addresses: [], transfers: [added, added] }).transfers).toHaveLength(7)
    expect(() => transact(demo, { addresses: [], transfers: [{ ...existing, amount: '900' }] })).toThrow('Event ID conflict')
    expect(demo.transfers[0].amount).toBe('18.5')
  })

  it('keeps internal transfers out of exterior totals and allows evidence to reveal a filtered event', () => {
    const edits = emptyEdits()
    edits.entities.push({ id: 'entity', name: '分组', members: ['origin', 'relay'] })
    const graph = project(demo, edits, {}, true)
    expect(graph.edges.every(edge => edge.source !== edge.target)).toBe(true)
    expect(graph.count).toBe(6)
    expect(project(demo, edits, { asset: 'unknown' }, true, new Set(), 'D-1').edges[0].events[0].id).toBe('demo-0')
  })

  it('records edits and undo/redo without mutating previous states and reads dated balances', () => {
    const history = new History()
    history.change(edits => { edits.notes['relay'] = 'check' })
    history.undo()
    expect(history.value.notes['relay']).toBeUndefined()
    history.redo()
    expect(history.value.notes['relay']).toBe('check')
    expect(latestBalances(demo, ['relay'], '2020-09-27')).toEqual([])
    expect(latestBalances(demo, ['relay'])[0].usd).toBe('6800')
  })

  it('applies layers before aggregation and keeps the endpoints of visible and revealed events', () => {
    const edits = emptyEdits()
    edits.layers = [{ id: 'focus', name: 'Focus', visible: false, refs: ['relay', 'demo-0'] }]
    const hidden = project(demo, edits)
    expect(hidden.count).toBe(5)
    expect(hidden.edges.find(edge => edge.source === 'origin' && edge.target === 'relay')?.amount).toBe('6.25')
    expect(hidden.nodes.some(node => node.id === 'relay')).toBe(true)
    const solo = project(demo, edits, {}, false, undefined, undefined, 'focus')
    expect(solo.edges.map(edge => edge.amount)).toEqual(['18.5'])
    expect(solo.nodes.map(node => node.id).sort()).toEqual(['origin', 'relay'])
    expect(project(demo, edits, {}, false, undefined, 'D-1').count).toBe(6)
  })
})

describe('layout', () => {
  it('produces rounded orthogonal geometry and keeps the feedback edge pointed at its true target', () => {
    const view = project(demo, emptyEdits())
    const drawing = layout(view)
    for (const edge of view.edges) {
      const route = drawing.routes[edge.id]
      expect(route.points[0][0]).toBe(drawing.positions[edge.source][0] + NODE_WIDTH / 2)
      expect(route.points.at(-1)?.[0]).toBe(drawing.positions[edge.target][0] - NODE_WIDTH / 2)
      expect(route.points.every(([x, y], i) => i === 0 || route.points[i - 1][0] === x || route.points[i - 1][1] === y)).toBe(true)
      expect(route.blocked).toBe(false)
    }
    expect(Object.values(drawing.routes).some(route => route.path.some(segment => segment[0] === 'Q'))).toBe(true)
  })

  it('holds pinned nodes and uses separate slots for parallel routes', () => {
    const view = project(demo, emptyEdits())
    const edge = view.edges[0]
    view.edges.push({ ...edge, id: 'parallel' })
    const drawing = layout(view, { relay: [520, 500] })
    expect(drawing.positions.relay).toEqual([520, 500])
    expect(drawing.routes[edge.id].points).not.toEqual(drawing.routes.parallel.points)
  })

  it('splits dense ranks, leaves routing gaps and applies both spacing controls', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => ({
      id: String(index).padStart(2, '0'), address: 'addr-' + index, name: 'Wallet ' + index, column: 3,
    }))
    const settings = layoutSettings({ maxRows: 10, columnGap: 420, rowGap: 100 })
    const drawing = layout({ nodes, edges: [], count: 0 }, {}, {}, undefined, settings)
    const lanes = [...new Set(Object.values(drawing.positions).map(point => point[0]))].sort((a, b) => a - b)
    expect(lanes).toEqual([0, NODE_WIDTH + settings.columnGap])
    const pitch = NODE_HEIGHT + settings.rowGap
    expect(drawing.positions['01'][1] - drawing.positions['00'][1]).toBe(pitch)
    expect(drawing.positions['08'][1] - drawing.positions['07'][1]).toBe(2 * pitch)
  })

  it('gives both sets of parallel edges independent tracks in a shared corridor', () => {
    const nodes = [demo.addresses[0], demo.addresses[2], demo.addresses[1]]
    const edges = [nodes[0], nodes[1]].flatMap(node => Array.from({ length: 10 }, (_, index) => ({
      id: node.id + '-' + index, source: node.id, target: 'relay',
      events: [{ ...demo.transfers[0], time: new Date(Date.UTC(2020, 1, 1, 0, index)).toISOString() }],
    })))
    const fixed: Record<string, [number, number]> = { origin: [0, -140], alpha: [0, 140], relay: [660, 0] }
    const view = { nodes, edges, count: edges.length }
    const drawing = layout(view, fixed)
    const trackYs = edges.map(edge => drawing.routes[edge.id].handle[1])
    expect(trackYs.slice(1).every((y, index) => y - trackYs[index] >= 34)).toBe(true)
    expect(drawing.labels.size).toBe(20)
    for (const edge of edges) {
      const route = drawing.routes[edge.id]
      expect(route.blocked).toBe(false)
      expect(route.path.filter(command => command[0] === 'Q')).toHaveLength(4)
      expect(route.points[0][0]).toBe(160)
      expect(route.points.at(-1)?.[0]).toBe(500)
    }
    const moved = layout(view, fixed, { 'origin-0': -25 })
    expect(moved.routes['origin-0'].handle[1]).toBe(trackYs[0] - 25)
  })

  it('keeps dense corridors close to their endpoints and expands every line in a focused view', () => {
    const edges = Array.from({ length: 60 }, (_, index) => ({
      id: 'asset-' + index, source: 'origin', target: 'relay',
      events: [{ ...demo.transfers[0], time: new Date(Date.UTC(2020, 1, 1, 0, index)).toISOString() }],
    }))
    const view = { nodes: demo.addresses.slice(0, 2), edges, count: edges.length }
    const overview = layout(view)
    const detail = layout(view, {}, {}, undefined, undefined, true)
    const overviewTracks = edges.map(edge => overview.routes[edge.id].handle[1])
    expect(new Set(overviewTracks).size).toBe(60)
    expect(Math.max(...overviewTracks) - Math.min(...overviewTracks)).toBe(59 * 7)
    expect(overview.labels.size).toBe(0)
    expect(detail.labels.size).toBe(60)
    expect(detail.routes['asset-59'].handle[1] - detail.routes['asset-0'].handle[1]).toBe(59 * 34)
  })
})

it('restores both undo and redo history from a serialized case edit snapshot', () => {
  const history = new History()
  history.change(value => { value.title = 'First name' })
  history.change(value => { value.title = 'Second name' })
  history.undo()
  const restored = History.restore(JSON.parse(JSON.stringify(history.snapshot())))
  expect(restored.value.title).toBe('First name')
  restored.redo()
  expect(restored.value.title).toBe('Second name')
  restored.undo()
  restored.undo()
  expect(restored.value.title).toBeUndefined()
  expect(History.restore(history.value).value.title).toBe('First name')
})

it('lets an aligned edge bend vertically without moving either node', () => {
  const nodes = demo.addresses.slice(0, 2)
  const view = project({ ...demo, addresses: nodes, transfers: demo.transfers.slice(0, 2) }, emptyEdits())
  const id = view.edges[0].id
  const aligned = layout(view)
  expect(aligned.routes[id].handleAxis).toBe('y')
  const adjusted = layout(view, aligned.positions, { [id]: 36 })
  expect(adjusted.positions).toEqual(aligned.positions)
  expect(adjusted.routes[id].handleAxis).toBe('y')
  expect(adjusted.routes[id].points.some(point => point[1] === 36)).toBe(true)
})

it('keeps an unobstructed route on incremental layout and reroutes an invalidated endpoint', () => {
  const view = project(demo, emptyEdits())
  const initial = layout(view)
  const untouched = view.edges.find(edge => edge.source === 'relay' && edge.target === 'beta')!
  const moved = view.edges.find(edge => edge.target === 'alpha')!
  const updated = layout(view, { ...initial.positions, alpha: [1100, -240] }, {}, initial)
  expect(updated.routes[untouched.id].points).toEqual(initial.routes[untouched.id].points)
  expect(updated.routes[moved.id].points.at(-1)).not.toEqual(initial.routes[moved.id].points.at(-1))
  expect(updated.routes[moved.id].blocked).toBe(false)
})

it('includes a collected transaction outside the core view while respecting asset and time filters', () => {
  const edits = emptyEdits()
  const data = { ...demo, core: ['demo-0'] }
  expect(project(data, edits, { core: true }).count).toBe(1)
  edits.included = ['demo-5']
  expect(project(data, edits, { core: true }).count).toBe(2)
  expect(project(data, edits, { core: true, to: '2020-09-26' }).count).toBe(1)
  expect(project(data, edits, { core: true, asset: '2:token' }).count).toBe(0)
})
