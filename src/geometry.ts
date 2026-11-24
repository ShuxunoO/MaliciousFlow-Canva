import type { Point } from './case'
import type { PathCommand } from './layout'

/** Convert the renderer's quadratic segments to world-coordinate polylines. */
export function flattenPath(path: PathCommand[], tolerance = 0.5): Point[] {
  const points: Point[] = []
  const add = (point: Point) => {
    const last = points.at(-1)
    if (!last || Math.hypot(last[0] - point[0], last[1] - point[1]) > 1e-8) points.push(point)
  }
  const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const split = (start: Point, control: Point, end: Point) => {
    const chord = midpoint(start, end)
    if (Math.hypot(control[0] - chord[0], control[1] - chord[1]) / 2 <= tolerance) {
      add(end)
      return
    }
    const a = midpoint(start, control)
    const b = midpoint(control, end)
    const center = midpoint(a, b)
    split(start, a, center)
    split(center, b, end)
  }
  for (const [command, x, y, endX, endY] of path) {
    if (command === 'Q') split(points.at(-1)!, [x, y], [endX!, endY!])
    else add([x, y])
  }
  return points
}
