import type { FlowEdge, Point } from './case'
import type { Route } from './layout'

export const PARALLEL_TRACK_GAP = 34
const COMPACT_TRACK_GAP = 7
const DENSE_CORRIDOR_SIZE = 32

export interface ParallelTrack { y: number; count: number; gap: number; compact: boolean }

/** Ordinal within a pair follows ledger time. Pairs sharing a corridor are packed in port order. */
export function parallelTracks(edges: FlowEdge[], positions: Record<string, Point>, detail: boolean): Map<string, ParallelTrack> {
  const pairs = new Map<string, FlowEdge[]>()
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target])
    const pair = pairs.get(key) ?? []
    pair.push(edge)
    pairs.set(key, pair)
  }
  const corridors = new Map<string, FlowEdge[][]>()
  for (const pair of pairs.values()) {
    if (pair.length < 2) continue
    const { source, target } = pair[0]
    const key = JSON.stringify([positions[source][0], positions[target][0]])
    const corridor = corridors.get(key) ?? []
    corridor.push(pair)
    corridors.set(key, corridor)
  }
  const tracks = new Map<string, ParallelTrack>()
  for (const corridor of corridors.values()) {
    const compact = !detail && corridor.reduce((count, pair) => count + pair.length, 0) > DENSE_CORRIDOR_SIZE
    const gap = compact ? COMPACT_TRACK_GAP : PARALLEL_TRACK_GAP
    const center = (pair: FlowEdge[]) => (positions[pair[0].source][1] + positions[pair[0].target][1]) / 2
    corridor.sort((left, right) => center(left) - center(right) || left[0].id.localeCompare(right[0].id))
    // Pack upwards and downwards around each pair's closest natural center without overlapping neighboring pairs.
    const starts: number[] = []
    let cursor = -Infinity
    for (const pair of corridor) {
      const first = Math.max(cursor, center(pair) - (pair.length - 1) * gap / 2)
      starts.push(first)
      cursor = first + (pair.length + 1) * gap
    }
    const desired = center(corridor.at(-1)!) - (corridor.at(-1)!.length - 1) * gap / 2
    let shift = Math.max(0, (starts.at(-1)! - desired) / 2)
    for (const [pairIndex, pair] of corridor.entries()) {
      const start = starts[pairIndex] - shift
      for (const [index, edge] of pair.entries()) {
        tracks.set(edge.id, { y: start + index * gap, count: pair.length, gap, compact })
      }
      const following = corridor[pairIndex + 1]
      if (following) {
        const unused = starts[pairIndex + 1] - starts[pairIndex] - (pair.length + 1) * gap
        shift = Math.max(0, shift - unused)
      }
    }
  }
  return tracks
}

/** Two quadratic segments give each ramp horizontal tangents at both ends. */
export function parallelPath(points: [Point, Point, Point, Point, Point, Point]): Route['path'] {
  const [exit, start, left, right, finish, entry] = points
  const ramp = (from: Point, to: Point): [number, number] =>
    [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  const first = ramp(start, left)
  const last = ramp(right, finish)
  return [['M', ...exit], ['L', ...start],
    ['Q', first[0], start[1], ...first], ['Q', first[0], left[1], ...left],
    ['L', ...right],
    ['Q', last[0], right[1], ...last], ['Q', last[0], finish[1], ...finish],
    ['L', ...entry]]
}
