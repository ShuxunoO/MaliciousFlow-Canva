import type { FlowView, Point } from './case'
import { flattenPath } from './geometry'
import { NODE_HEIGHT, NODE_WIDTH, type Drawing } from './layout'
import { BoxIndex, centeredBox, type Box } from './spatial'

export interface LayoutValidation {
  transactions: number
  summaries: number
  missing: string[]
  invalidAnchors: string[]
  blockedRoutes: string[]
  overlappingSummaries: string[]
  detours: { id: string; distance: number }[]
}

function crossesBox(a: Point, b: Point, box: Box) {
  let start = 0
  let end = 1
  for (const [origin, delta, low, high] of [
    [a[0], b[0] - a[0], box.left, box.right], [a[1], b[1] - a[1], box.top, box.bottom],
  ]) {
    if (!delta) {
      if (origin <= low || origin >= high) return false
      continue
    }
    const limits = [(low - origin) / delta, (high - origin) / delta].sort((x, y) => x - y)
    start = Math.max(start, limits[0])
    end = Math.min(end, limits[1])
    if (start >= end) return false
  }
  return true
}

export function validateDrawing(view: FlowView, drawing: Drawing): LayoutValidation {
  const nodes = new BoxIndex<Box>()
  for (const node of view.nodes) nodes.add(centeredBox(drawing.positions[node.id], NODE_WIDTH, NODE_HEIGHT))
  const summaries = new BoxIndex<Box>()
  const report: LayoutValidation = {
    transactions: 0, summaries: 0, missing: [], invalidAnchors: [], blockedRoutes: [], overlappingSummaries: [], detours: [],
  }
  for (const edge of view.edges) {
    const route = drawing.routes[edge.id]
    const points = flattenPath(route.path)
    const start = points[0]
    const end = points.at(-1)
    const source = drawing.positions[edge.source]
    const target = drawing.positions[edge.target]
    if (points.length < 2 || !points.every(point => point.every(Number.isFinite)) ||
      start[0] !== source[0] + NODE_WIDTH / 2 || Math.abs(start[1] - source[1]) > NODE_HEIGHT / 2 ||
      end![0] !== target[0] - NODE_WIDTH / 2 || Math.abs(end![1] - target[1]) > NODE_HEIGHT / 2) {
      report.invalidAnchors.push(edge.id)
    }
    const entersNode = points.slice(1).some((b, index) => {
      const a = points[index]
      const bounds = { left: Math.min(a[0], b[0]) - .1, right: Math.max(a[0], b[0]) + .1,
        top: Math.min(a[1], b[1]) - .1, bottom: Math.max(a[1], b[1]) + .1 }
      return nodes.query(bounds).some(box => crossesBox(a, b, box))
    })
    if (route.blocked || entersNode) report.blockedRoutes.push(edge.id)
    const ys = points.map(point => point[1])
    const distance = Math.max(Math.min(start[1], end![1]) - Math.min(...ys), Math.max(...ys) - Math.max(start[1], end![1]))
    if (distance > 900 && !route.offset) report.detours.push({ id: edge.id, distance: Math.round(distance) })
    if (!edge.events.length) continue
    report.transactions++
    const summary = drawing.summaries[edge.id]
    if (!summary) {
      report.missing.push(edge.id)
      continue
    }
    report.summaries++
    if (nodes.query(summary.box).length || summaries.query(summary.box).length) report.overlappingSummaries.push(edge.id)
    summaries.add(summary.box)
  }
  return report
}
