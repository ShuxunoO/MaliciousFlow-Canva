import { describe, expect, it } from 'vitest'
import { emptyEdits, History, latestBalances, project, sumDecimal, transact } from '../src/case'
import { demo } from '../src/demo'
import { layout, NODE_WIDTH } from '../src/layout'

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
})
