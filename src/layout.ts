import type { FlowView, Point } from './case'

export const NODE_WIDTH = 224
export const NODE_HEIGHT = 96
const COLUMN = 520
const ROW = 162
const clearance = 10

export type PathCommand = ['M' | 'L', number, number] | ['Q', number, number, number, number]
export interface Route { points: Point[]; label: Point; handle: Point; handleAxis: 'x' | 'y'; offset: number; path: [['M', number, number], ...PathCommand[]]; blocked: boolean }
export interface Drawing { positions: Record<string, Point>; routes: Record<string, Route>; labels: Set<string> }

export function rounded(points: Point[], radius = 24): Route['path'] {
  const path: Route['path'] = [['M', ...points[0]]]
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]
    const corner = points[index]
    const next = points[index + 1]
    const trim = Math.min(radius, Math.hypot(previous[0] - corner[0], previous[1] - corner[1]) / 2,
      Math.hypot(next[0] - corner[0], next[1] - corner[1]) / 2)
    const offset = (point: Point): Point => {
      const length = Math.hypot(point[0] - corner[0], point[1] - corner[1])
      return length ? [corner[0] + (point[0] - corner[0]) * trim / length, corner[1] + (point[1] - corner[1]) * trim / length] : corner
    }
    path.push(['L', ...offset(previous)], ['Q', ...corner, ...offset(next)])
  }
  path.push(['L', ...points[points.length - 1]])
  return path
}

function compact(points: Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result.at(-1)
    const previous = result.at(-2)
    if (last?.[0] === point[0] && last[1] === point[1]) continue
    if (previous && last && ((previous[0] === last[0] && last[0] === point[0]
      && (last[1] - previous[1]) * (point[1] - last[1]) >= 0)
      || (previous[1] === last[1] && last[1] === point[1]
      && (last[0] - previous[0]) * (point[0] - last[0]) >= 0))) result.pop()
    result.push(point)
  }
  return result
}

export function layout(view: FlowView, fixed: Record<string, Point> = {}, bends: Record<string, number> = {}, previous?: Drawing): Drawing {
  const positions: Record<string, Point> = Object.create(null)
  const routes: Record<string, Route> = Object.create(null)
  const labels = new Set<string>()
  const incoming = new Map<string, number>()
  const connections = new Map<string, string[]>()
  const first = new Map<string, number>()
  for (const edge of view.edges) {
    if (edge.source !== edge.target) {
      const list = connections.get(edge.source) ?? []
      list.push(edge.target)
      connections.set(edge.source, list)
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    }
    const event = edge.events[0]
    if (event) {
      const time = Date.parse(event.time)
      first.set(edge.target, Math.min(first.get(edge.target) ?? Infinity, time))
    }
  }
  const ranks = new Map<string, number>()
  for (const node of view.nodes) if (node.column !== undefined) ranks.set(node.id, node.column)
  const roots = view.nodes.filter(node => ranks.has(node.id) || !incoming.has(node.id))
  const queue = [...roots, ...view.nodes.filter(node => !roots.includes(node))]
  const expanded = new Set<string>()
  for (const node of queue) {
    if (expanded.has(node.id)) continue
    const next = [node.id]
    if (!ranks.has(node.id)) ranks.set(node.id, 0)
    for (const id of next) {
      if (expanded.has(id)) continue
      expanded.add(id)
      for (const target of connections.get(id) ?? []) {
        if (!ranks.has(target)) ranks.set(target, (ranks.get(id) ?? 0) + 1)
        if (!expanded.has(target)) next.push(target)
      }
    }
  }
  const columns = new Map<number, string[]>()
  for (const node of view.nodes) {
    const rank = ranks.get(node.id) ?? 0
    const column = columns.get(rank) ?? []
    column.push(node.id)
    columns.set(rank, column)
    if (fixed[node.id]) positions[node.id] = fixed[node.id]
  }
  const occupied = Object.values(positions)
  const hits = (p: Point, q: Point, center: Point, x: number, y: number) =>
    Math.min(p[0], q[0]) < center[0] + x && Math.max(p[0], q[0]) > center[0] - x
    && Math.min(p[1], q[1]) < center[1] + y && Math.max(p[1], q[1]) > center[1] - y
  for (const [rank, column] of columns) {
    column.sort((a, b) => (first.get(a) ?? Infinity) - (first.get(b) ?? Infinity) || a.localeCompare(b))
    for (const [index, id] of column.entries()) {
      if (positions[id]) continue
      const point: Point = [rank * COLUMN, (index - (column.length - 1) / 2) * ROW]
      while (occupied.some(other => hits(point, point, other, NODE_WIDTH + clearance, NODE_HEIGHT + clearance))) point[1] += ROW
      positions[id] = point
      occupied.push(point)
    }
  }
  const maxY = occupied.reduce((max, point) => Math.max(max, point[1]), 0)
  const minY = occupied.reduce((min, point) => Math.min(min, point[1]), 0)
  const outgoing = new Map<string, string[]>()
  const entering = new Map<string, string[]>()
  const edges = [...view.edges].sort((a, b) => Date.parse(a.events[0]?.time ?? '') - Date.parse(b.events[0]?.time ?? '') || a.id.localeCompare(b.id))
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, [])
    if (!entering.has(edge.target)) entering.set(edge.target, [])
    outgoing.get(edge.source)!.push(edge.id)
    entering.get(edge.target)!.push(edge.id)
  }
  const portOffset = (ids: string[], id: string) => ids.length < 2 ? 0 : (ids.indexOf(id) / (ids.length - 1) - .5) * 64
  const labelBoxes: Point[] = []
  const horizontalUse = new Map<number, number>()
  const laneDistance = (ids: string[], id: string) => 32 + (ids.indexOf(id) / Math.max(1, ids.length - 1)) * 96
  const blocked = (p: Point, q: Point) => occupied.some(point => hits(p, q, point, NODE_WIDTH / 2 + clearance, NODE_HEIGHT / 2 + clearance))
  for (const edge of edges) {
    const start = positions[edge.source]
    const end = positions[edge.target]
    const exit: Point = [start[0] + NODE_WIDTH / 2, start[1] + portOffset(outgoing.get(edge.source)!, edge.id)]
    const entry: Point = [end[0] - NODE_WIDTH / 2, end[1] + portOffset(entering.get(edge.target)!, edge.id)]
    const startLane = exit[0] + laneDistance(outgoing.get(edge.source)!, edge.id)
    const endLane = entry[0] - laneDistance(entering.get(edge.target)!, edge.id)
    const direct = entry[0] > exit[0] + 70
    const bend = Math.min(entry[0] - 28, Math.max(exit[0] + 28, startLane + (bends[edge.id] ?? 0)))
    const simple: Point[] = [exit, [bend, exit[1]], [bend, entry[1]], entry]
    const avoids = (points: Point[]) => {
      if (points.length === 2) {
        return !occupied.some(point => point !== start && point !== end
          && hits(points[0], points[1], point, NODE_WIDTH / 2 + clearance, NODE_HEIGHT / 2 + clearance))
      }
      return points.slice(2, -1).every((point, index) => !blocked(points[index + 1], point))
        && !occupied.some(point => point !== start && hits(points[0], points[1], point, NODE_WIDTH / 2 + clearance, NODE_HEIGHT / 2 + clearance))
        && !occupied.some(point => point !== end && hits(points.at(-2)!, points.at(-1)!, point, NODE_WIDTH / 2 + clearance, NODE_HEIGHT / 2 + clearance))
    }
    const manualOffset = bends[edge.id] ?? 0
    const flat = exit[1] === entry[1]
    const prior = previous?.routes[edge.id]
    const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1]
    const retained = prior && !prior.blocked && prior.offset === manualOffset
      && same(prior.points[0], exit) && same(prior.points.at(-1)!, entry) && avoids(prior.points) ? prior : undefined
    let selected = retained?.points ?? (direct && (!flat || manualOffset === 0) && avoids(simple) ? simple : undefined)
    if (retained && retained.handleAxis === 'y' && retained.points.length > 2) {
      const lane = retained.handle[1]
      horizontalUse.set(lane, (horizontalUse.get(lane) ?? 0) + 1)
    }
    let track: number = bend
    if (!selected) {
      const topFirst = exit[1] + entry[1] < minY + maxY
      const preferred = Math.round((exit[1] + entry[1]) / (2 * ROW)) * ROW + ROW / 2
      const local = [preferred, preferred - 8, preferred + 8, preferred - 16, preferred + 16]
      const perimeter = Array.from({ length: 24 }, (_, slot) => {
        const offset = 72 + slot * 12
        return topFirst ? [minY - offset, maxY + offset] : [maxY + offset, minY - offset]
      }).flat()
      if (flat && direct && manualOffset) local.unshift(exit[1])
      const offset = manualOffset
      const channels = [...new Set([...local, ...perimeter])].sort((a, b) => {
        const cost = (lane: number) => Math.abs(exit[1] - lane - offset) + Math.abs(entry[1] - lane - offset)
          + (horizontalUse.get(lane + offset) ?? 0) * 180
        return cost(a) - cost(b)
      })
      for (const base of channels) {
        const lane = base + (bends[edge.id] ?? 0)
        const candidate: Point[] = [exit, [startLane, exit[1]], [startLane, lane], [endLane, lane], [endLane, entry[1]], entry]
        if (avoids(candidate)) {
          selected = candidate
          track = lane
          horizontalUse.set(lane, (horizontalUse.get(lane) ?? 0) + 1)
          break
        }
      }
    }
    const obstruction = !selected
    const fallbackY = (exit[1] + entry[1] < 0 ? minY - 72 : maxY + 72) + (bends[edge.id] ?? 0)
    const points = compact(selected ?? (direct ? simple : [exit, [startLane, exit[1]], [startLane, fallbackY], [endLane, fallbackY], [endLane, entry[1]], entry]))
    const horizontal = points.slice(1).map((point, index) => ({ start: points[index], end: point }))
      .filter(segment => segment.start[1] === segment.end[1])
      .sort((a, b) => Math.abs(b.end[0] - b.start[0]) - Math.abs(a.end[0] - a.start[0]))
    const placeAbove = (segment: { start: Point; end: Point }): Point =>
      [(segment.start[0] + segment.end[0]) / 2, segment.start[1] - 13]
    const halfWidth = 145 + Math.max(0, (edge.amount?.length ?? 0) - 12) * 4
    const segment = horizontal.find(candidate => {
      if (Math.abs(candidate.start[0] - candidate.end[0]) < halfWidth * 1.5) return false
      const point = placeAbove(candidate)
      return !labelBoxes.some(other => hits(point, point, other, halfWidth + 180, 22))
        && !occupied.some(other => hits(point, point, other, NODE_WIDTH / 2 + halfWidth, NODE_HEIGHT / 2 + 11))
    })
    const fallbackSegment = segment ?? horizontal[0]
    const label: Point = fallbackSegment ? placeAbove(fallbackSegment) : [start[0], start[1] - 13]
    if (segment) {
      labelBoxes.push(label)
      labels.add(edge.id)
    }
    const handle: Point = retained?.handle ?? (selected === simple ? [bend, (exit[1] + entry[1]) / 2] : [(startLane + endLane) / 2, obstruction ? fallbackY : track])
    routes[edge.id] = { points, label, handle, handleAxis: retained?.handleAxis ?? (selected === simple && !flat ? 'x' : 'y'),
      offset: manualOffset, path: rounded(points), blocked: obstruction }
  }
  return { positions, routes, labels }
}
