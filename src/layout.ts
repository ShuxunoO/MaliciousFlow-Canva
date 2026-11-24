import type { FlowView, LayoutSettings, Point } from './case'
import { parallelPath, parallelTracks } from './parallel-routing'
import { placeSummaries, type SummaryPosition } from './transaction-summaries'
import { BoxIndex, centeredBox, type Box } from './spatial'

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
  parallel?: { compact: boolean } }
export interface Drawing { positions: Record<string, Point>; routes: Record<string, Route>; summaries: Record<string, SummaryPosition> }

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
  const plannedColumns = new Map<string, number>()
  const plannedRows = new Map<string, number>()
  for (const [, column] of [...columns].sort(([a], [b]) => a - b)) {
    column.sort((a, b) => (first.get(a) ?? Infinity) - (first.get(b) ?? Infinity) || a.localeCompare(b))
    const lanes = Math.ceil(column.length / maxRows)
    const rows = Math.ceil(column.length / lanes)
    const slot = (index: number) => index + Math.floor(index / 8)
    const center = Math.floor(slot(rows - 1) / 2)
    for (const [index, id] of column.entries()) {
      plannedColumns.set(id, columnIndex + Math.floor(index / rows))
      plannedRows.set(id, (slot(index % rows) - center) * row)
    }
    columnIndex += lanes
  }
  const adjacent = new Map<number, number>()
  for (const { source, target } of view.edges) {
    const left = plannedColumns.get(source)!
    if (plannedColumns.get(target) === left + 1) adjacent.set(left, (adjacent.get(left) ?? 0) + 1)
  }
  const columnX = [0]
  for (let index = 0; index < columnIndex; index++) {
    const gap = !parallelDetail && (adjacent.get(index) ?? 0) > 32 ? Math.max(pitch, NODE_WIDTH + 1060) : pitch
    columnX.push(columnX[index] + gap)
  }
  for (const [id, column] of plannedColumns) {
    if (positions[id]) continue
    const point: Point = [columnX[column], plannedRows.get(id)!]
    while (occupied.some(other => hits(point, point, other, NODE_WIDTH + clearance, NODE_HEIGHT + clearance))) point[1] += row
    positions[id] = point
    occupied.push(point)
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
  const horizontalUse = new Map<number, number>()
  const parallelRails: { y: number; left: number; right: number; gap: number }[] = []
  const laneDistance = (ids: string[], id: string) => 32 + (ids.indexOf(id) / Math.max(1, ids.length - 1)) * 96
  const obstacles = new BoxIndex<Box & { center: Point }>()
  for (const center of occupied) obstacles.add({
    ...centeredBox(center, NODE_WIDTH + clearance * 2, NODE_HEIGHT + clearance * 2), center,
  })
  const blocked = (p: Point, q: Point, exclude?: Point, second?: Point) => obstacles.some({
    left: Math.min(p[0], q[0]), right: Math.max(p[0], q[0]),
    top: Math.min(p[1], q[1]), bottom: Math.max(p[1], q[1]),
  }, obstacle => obstacle.center !== exclude && obstacle.center !== second)
  const nearbyChannels = (a: number, b: number, offset = 0) => {
    const low = Math.min(a, b) + offset
    const high = Math.max(a, b) + offset
    const middle = (low + high) / 2
    const spacing = Math.max(1, Math.ceil((high - low) / (row * 14)))
    const result = [middle, low, high]
    for (let y = (Math.floor((low - row) / row) + .5) * row; y <= high + row; y += row * spacing) {
      result.push(y, y - 12, y + 12, y - 24, y + 24)
    }
    return result.sort((left, right) => {
      const detour = (y: number) => Math.max(0, low - y, y - high)
      return detour(left) - detour(right) || Math.abs(left - middle) - Math.abs(right - middle)
    })
  }
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
        return !blocked(points[0], points[1], start, end)
      }
      return points.slice(2, -1).every((point, index) => !blocked(points[index + 1], point))
        && !blocked(points[0], points[1], start)
        && !blocked(points.at(-2)!, points.at(-1)!, end)
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
      const long = Math.abs(plannedColumns.get(edge.source)! - plannedColumns.get(edge.target)!) > 1
      if (long) {
        const nearby = nearbyChannels(exit[1], entry[1], manualOffset)
        base.unshift(...nearby.flatMap(y => [y, y - parallel.gap, y + parallel.gap]))
      }
      const extern = NODE_HEIGHT / 2 + 28
      const above = Math.min(expected, minY - extern)
      const below = Math.max(expected, maxY + extern)
      for (let slot = 0; slot < parallel.count + 2; slot++) {
        base.push(above - slot * parallel.gap, below + slot * parallel.gap)
      }
      const detour = (y: number) => Math.max(0, Math.min(exit[1], entry[1]) - y, y - Math.max(exit[1], entry[1]))
      const near = [...new Set(base)].filter(y => detour(y) <= 900 || !!manualOffset || parallelDetail)
      const rest = [...new Set(base)].filter(y => !near.includes(y))
      const localCandidates = long && !manualOffset ? nearbyChannels(exit[1], entry[1])
        .flatMap(y => [y, y - 2, y + 2, y - 4, y + 4]) : []
      const candidates = [
        ...near.map(y => ({ y, spacing: long ? 7 : parallel.gap })),
        ...localCandidates.map(y => ({ y, spacing: 2 })),
        ...rest.map(y => ({ y, spacing: parallel.gap })),
      ]
      for (const { y, spacing } of candidates) {
        const forward: [Point, Point, Point, Point, Point, Point] = [exit,
          [exit[0] + 18, exit[1]], [exit[0] + inset, y], [entry[0] - inset, y],
          [entry[0] - 18, entry[1]], entry]
        const smooth = span >= 230 && avoids(forward)
        const lane: Point[] = smooth ? forward : [exit, [startLane, exit[1]], [startLane, y], [endLane, y], [endLane, entry[1]], entry]
        const left = Math.min(lane[2][0], lane[3][0])
        const right = Math.max(lane[2][0], lane[3][0])
        if ((!smooth && !avoids(lane)) || parallelRails.some(rail =>
          rail.left < right && rail.right > left && Math.abs(y - rail.y) < Math.min(spacing, rail.gap) - .01)) continue
        const center: Point = [(left + right) / 2, y]
        const label: Point = [center[0], y - 12]
        const points = compact(lane)
        routes[edge.id] = { points, label, handle: center, handleAxis: 'y', offset: manualOffset,
          path: smooth ? parallelPath(forward) : rounded(points), blocked: false,
          parallel: { compact: parallel.compact } }
        parallelRails.push({ y, left, right, gap: spacing })
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
      const channels = [...new Set([...local, ...nearbyChannels(exit[1], entry[1]), ...perimeter])].sort((a, b) => {
        const cost = (lane: number) => 3 * Math.max(0, Math.min(exit[1], entry[1]) - lane, lane - Math.max(exit[1], entry[1]))
          + Math.abs(exit[1] + entry[1] - lane * 2) * .12
          + (horizontalUse.get(lane + offset) ?? 0) * 5
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
    const fallbackSegment = horizontal[0]
    const label: Point = fallbackSegment ? placeAbove(fallbackSegment) : [start[0], start[1] - 13]
    const handle: Point = retained?.handle ?? (selected === simple ? [bend, (exit[1] + entry[1]) / 2] : [(startLane + endLane) / 2, obstruction ? fallbackY : track])
    routes[edge.id] = { points, label, handle, handleAxis: retained?.handleAxis ?? (selected === simple && !flat ? 'x' : 'y'),
      offset: manualOffset, path: rounded(points), blocked: obstruction }
  }
  const summaries = placeSummaries(view, routes, occupied.map(point => centeredBox(point, NODE_WIDTH, NODE_HEIGHT)))
  return { positions, routes, summaries }
}
