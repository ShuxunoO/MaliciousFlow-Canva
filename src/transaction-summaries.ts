import type { FlowEdge, FlowView, Point } from './case'
import type { Route } from './layout'
import { flattenPath } from './geometry'
import { compactQuantity } from './node-summary'
import { BoxIndex, centeredBox, type Box } from './spatial'

export const SUMMARY_WIDTH = 204
export const SUMMARY_HEIGHT = 20
export interface SummaryPosition { point: Point; anchor: Point; box: Box; callout: boolean }

export function transactionSummary(edge: FlowEdge) {
  const first = edge.events[0]
  const last = edge.events.at(-1)
  if (!first || !last) return 'Relationship'
  const from = new Date(first.time).toISOString()
  const to = new Date(last.time).toISOString()
  const start = from.slice(0, 10)
  const stamp = (iso: string) => iso.slice(11, 19)
  const period = first === last ? start + ' ' + stamp(from)
    : start === to.slice(0, 10) ? from.slice(5, 16).replace('T', ' ') + '–' + to.slice(11, 16)
      : start + '–' + to.slice(5, 10)
  const raw = edge.amount ?? first.amount
  const amount = raw.length <= 10 ? raw : compactQuantity([raw])
  return [amount + ' ' + edge.asset, period, ...(edge.events.length > 1 ? ['×' + edge.events.length] : [])].join(' · ')
}

type Segment = { a: Point; b: Point; length: number }

export function placeSummaries(view: FlowView, routes: Record<string, Route>, nodeBoxes: Box[]) {
  const reservations = new BoxIndex<Box>()
  for (const box of nodeBoxes) reservations.add(box)
  const summaries: Record<string, SummaryPosition> = Object.create(null)
  const drafts: { id: string; segments: Segment[]; anchor: Point }[] = []
  const reserve = (id: string, point: Point, anchor: Point, callout: boolean) => {
    const box = centeredBox(point, SUMMARY_WIDTH, SUMMARY_HEIGHT)
    if (reservations.query(centeredBox(point, SUMMARY_WIDTH + 8, SUMMARY_HEIGHT + 4)).length) return false
    reservations.add(box)
    summaries[id] = { point, anchor, box, callout }
    return true
  }
  for (const edge of view.edges) {
    if (!edge.events.length) continue
    const route = routes[edge.id]
    const segments = route.points.slice(1).map((b, index) => {
      const a = route.points[index]
      return { a, b, length: Math.abs(b[0] - a[0]) }
    }).filter(({ a, b, length }) => a[1] === b[1] && length > SUMMARY_WIDTH + 16)
      .sort((a, b) => b.length - a.length)
    const vertices = flattenPath(route.path)
    let anchor = vertices[0]
    let distance = Infinity
    for (const [index, b] of vertices.slice(1).entries()) {
      const a = vertices[index]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((route.handle[0] - a[0]) * dx + (route.handle[1] - a[1]) * dy) / (dx * dx + dy * dy)))
      const point: Point = [a[0] + t * dx, a[1] + t * dy]
      const gap = Math.hypot(route.handle[0] - point[0], route.handle[1] - point[1])
      if (gap < distance) {
        anchor = point
        distance = gap
      }
    }
    drafts.push({ id: edge.id, segments, anchor })
  }
  const deferred: typeof drafts = []
  for (const item of drafts) {
    const assigned = item.segments.some(({ a, b, length }) => {
      const middle = (a[0] + b[0]) / 2
      const slots = Math.min(12, Math.floor((length - SUMMARY_WIDTH - 16) / 110))
      for (let slot = 0; slot <= slots; slot++) {
        const x = middle + (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 55
        if (reserve(item.id, [x, a[1] - 12], [x, a[1]], false)) return true
        if (reserve(item.id, [x, a[1] + 12], [x, a[1]], false)) return true
      }
      return false
    })
    if (!assigned) deferred.push(item)
  }
  const rowStep = SUMMARY_HEIGHT + 6
  for (const { id, anchor } of deferred) {
    // Search around a particular point on the edge. The grid expands only when nearby labels are occupied.
    for (let radius = 0; !summaries[id]; radius++) {
      for (let column = -radius; column <= radius && !summaries[id]; column++) {
        const row = radius - Math.abs(column)
        const x = anchor[0] + column * (SUMMARY_WIDTH + 12)
        const y = anchor[1] + row * rowStep
        if (!reserve(id, [x, y - 13], anchor, true) && row) {
          reserve(id, [x, anchor[1] - row * rowStep - 13], anchor, true)
        }
      }
    }
  }
  return summaries
}
