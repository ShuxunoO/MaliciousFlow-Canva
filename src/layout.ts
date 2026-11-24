import type { FlowView, LayoutSettings, Point } from './case'
import { parallelPath, parallelTracks } from './parallel-routing'

export const NODE_WIDTH = 320
export const NODE_HEIGHT = 128
export const LAYOUT_LIMITS = {
  rowGap: { min: 48, max: 360, default: 70 },
  columnGap: { min: 290, max: 1100, default: 340 },
  maxRows: { min: 2, max: 60, default: 24 },
}
export function layoutSettings(values: Partial<LayoutSettings> = {}): LayoutSettings {
  const normalize = (key: keyof LayoutSettings) => {
    const limit = LAYOUT_LIMITS[key]
    const value = values[key]
    return value !== undefined && Number.isFinite(value)
      ? Math.max(limit.min, Math.min(limit.max, Math.round(value))) : limit.default
  }
  return { rowGap: normalize('rowGap'), columnGap: normalize('columnGap'), maxRows: normalize('maxRows') }
}
const clearance = 10

export type PathCommand = ['M' | 'L', number, number] | ['Q', number, number, number, number]
export interface Route { points: Point[]; label: Point; handle: Point; handleAxis: 'x' | 'y'; offset: number; path: [['M', number, number], ...PathCommand[]]; blocked: boolean;
  parallel?: { labelWidth: number; compact: boolean } }
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

export function layout(view: FlowView, fixed: Record<string, Point> = {}, bends: Record<string, number> = {},
  previous?: Drawing, settings?: LayoutSettings, parallelDetail = false): Drawing {
  const { rowGap, columnGap, maxRows } = layoutSettings(settings)
  const row = NODE_HEIGHT + rowGap
  const pitch = NODE_WIDTH + columnGap
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
  let columnIndex = 0
  for (const [, column] of [...columns].sort(([a], [b]) => a - b)) {
    column.sort((a, b) => (first.get(a) ?? Infinity) - (first.get(b) ?? Infinity) || a.localeCompare(b))
    const lanes = Math.ceil(column.length / maxRows)
    const rows = Math.ceil(column.length / lanes)
    const slot = (index: number) => index + Math.floor(index / 8)
    const center = Math.floor(slot(rows - 1) / 2)
    for (const [index, id] of column.entries()) {
      if (positions[id]) continue
      const point: Point = [(columnIndex + Math.floor(index / rows)) * pitch, (slot(index % rows) - center) * row]
      while (occupied.some(other => hits(point, point, other, NODE_WIDTH + clearance, NODE_HEIGHT + clearance))) point[1] += row
      positions[id] = point
      occupied.push(point)
    }
    columnIndex += lanes
  }
  const maxY = occupied.reduce((max, point) => Math.max(max, point[1]), 0)
  const minY = occupied.reduce((min, point) => Math.min(min, point[1]), 0)
  const outgoing = new Map<string, string[]>()
  const entering = new Map<string, string[]>()
  const chronological = (a: FlowView['edges'][number], b: FlowView['edges'][number]) =>
    (a.events[0] ? Date.parse(a.events[0].time) : Infinity) - (b.events[0] ? Date.parse(b.events[0].time) : Infinity) ||
    a.id.localeCompare(b.id)
  const edges = [...view.edges].sort(chronological)
  const tracks = parallelTracks(edges, positions, parallelDetail)
  const edgeById = new Map(edges.map(edge => [edge.id, edge]))
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, [])
    if (!entering.has(edge.target)) entering.set(edge.target, [])
    outgoing.get(edge.source)!.push(edge.id)
    entering.get(edge.target)!.push(edge.id)
  }
  for (const ids of outgoing.values()) ids.sort((a, b) =>
    positions[edgeById.get(a)!.target][1] - positions[edgeById.get(b)!.target][1] ||
    edgeById.get(a)!.target.localeCompare(edgeById.get(b)!.target) || chronological(edgeById.get(a)!, edgeById.get(b)!))
  for (const ids of entering.values()) ids.sort((a, b) =>
    positions[edgeById.get(a)!.source][1] - positions[edgeById.get(b)!.source][1] ||
    edgeById.get(a)!.source.localeCompare(edgeById.get(b)!.source) || chronological(edgeById.get(a)!, edgeById.get(b)!))
  const portOffset = (ids: string[], id: string) => ids.length < 2 ? 0 : (ids.indexOf(id) / (ids.length - 1) - .5) * 64
  const labelBoxes: { point: Point; halfWidth: number }[] = []
  const horizontalUse = new Map<number, number>()
  const parallelRails: { y: number; left: number; right: number; gap: number }[] = []
  const laneDistance = (ids: string[], id: string) => 32 + (ids.indexOf(id) / Math.max(1, ids.length - 1)) * 96
  const blocked = (p: Point, q: Point) => occupied.some(point => hits(p, q, point, NODE_WIDTH / 2 + clearance, NODE_HEIGHT / 2 + clearance))
  for (const edge of [...edges.filter(item => tracks.has(item.id)), ...edges.filter(item => !tracks.has(item.id))]) {
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
    const parallel = tracks.get(edge.id)
    if (parallel) {
      const span = entry[0] - exit[0]
      const inset = Math.min(66, span * .25)
      const expected = parallel.y + manualOffset
      const base = [expected]
      for (let slot = 1; slot <= Math.ceil(row * 2 / parallel.gap); slot++) {
        base.push(expected - slot * parallel.gap, expected + slot * parallel.gap)
      }
      const extern = NODE_HEIGHT / 2 + 28
      const above = Math.min(expected, minY - extern)
      const below = Math.max(expected, maxY + extern)
      for (let slot = 0; slot < parallel.count + 2; slot++) {
        base.push(above - slot * parallel.gap, below + slot * parallel.gap)
      }
      for (const y of base) {
        const forward: [Point, Point, Point, Point, Point, Point] = [exit,
          [exit[0] + 18, exit[1]], [exit[0] + inset, y], [entry[0] - inset, y],
          [entry[0] - 18, entry[1]], entry]
        const smooth = span >= 230 && avoids(forward)
        const lane: Point[] = smooth ? forward : [exit, [startLane, exit[1]], [startLane, y], [endLane, y], [endLane, entry[1]], entry]
        const left = Math.min(lane[2][0], lane[3][0])
        const right = Math.max(lane[2][0], lane[3][0])
        if ((!smooth && !avoids(lane)) || parallelRails.some(rail =>
          rail.left < right && rail.right > left && Math.abs(y - rail.y) < Math.max(rail.gap, parallel.gap) - .01)) continue
        const center: Point = [(left + right) / 2, y]
        const label: Point = [center[0], y - 12]
        const labelWidth = Math.min(280, right - left - (smooth ? 12 : 50))
        if (!parallel.compact && labelWidth >= 76 && !occupied.some(other =>
          hits(label, label, other, NODE_WIDTH / 2 + labelWidth / 2, NODE_HEIGHT / 2 + 11)) &&
          !labelBoxes.some(other => hits(label, label, other.point, labelWidth / 2 + other.halfWidth + 4, 22))) {
          labelBoxes.push({ point: label, halfWidth: labelWidth / 2 })
          labels.add(edge.id)
        }
        const points = compact(lane)
        routes[edge.id] = { points, label, handle: center, handleAxis: 'y', offset: manualOffset,
          path: smooth ? parallelPath(forward) : rounded(points), blocked: false,
          parallel: { labelWidth: Math.max(76, labelWidth), compact: parallel.compact } }
        parallelRails.push({ y, left, right, gap: parallel.gap })
        horizontalUse.set(y, (horizontalUse.get(y) ?? 0) + 1)
        break
      }
      if (routes[edge.id]) continue
    }
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
      const preferred = Math.round((exit[1] + entry[1]) / (2 * row) - .5) * row + row / 2
      const local = [preferred, preferred - 8, preferred + 8, preferred - 16, preferred + 16]
      const perimeter = Array.from({ length: 24 }, (_, slot) => {
        const offset = NODE_HEIGHT / 2 + 22 + slot * 12
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
    const perimeterOffset = NODE_HEIGHT / 2 + 22
    const fallbackY = (exit[1] + entry[1] < 0 ? minY - perimeterOffset : maxY + perimeterOffset) + (bends[edge.id] ?? 0)
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
      return !labelBoxes.some(other => hits(point, point, other.point, halfWidth + other.halfWidth + 4, 22))
        && !occupied.some(other => hits(point, point, other, NODE_WIDTH / 2 + halfWidth, NODE_HEIGHT / 2 + 11))
    })
    const fallbackSegment = segment ?? horizontal[0]
    const label: Point = fallbackSegment ? placeAbove(fallbackSegment) : [start[0], start[1] - 13]
    if (segment) {
      labelBoxes.push({ point: label, halfWidth: Math.max(180, halfWidth) })
      labels.add(edge.id)
    }
    const handle: Point = retained?.handle ?? (selected === simple ? [bend, (exit[1] + entry[1]) / 2] : [(startLane + endLane) / 2, obstruction ? fallbackY : track])
    routes[edge.id] = { points, label, handle, handleAxis: retained?.handleAxis ?? (selected === simple && !flat ? 'x' : 'y'),
      offset: manualOffset, path: rounded(points), blocked: obstruction }
  }
  return { positions, routes, labels }
}
