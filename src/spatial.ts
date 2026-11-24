import type { Point } from './case'

export interface Box { left: number; right: number; top: number; bottom: number }

export function centeredBox([x, y]: Point, width: number, height: number): Box {
  return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 }
}

export function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export class BoxIndex<T extends Box> {
  private cells = new Map<number, T[]>()

  add(box: T) {
    for (let cell = Math.floor(box.left / 512); cell <= Math.floor(box.right / 512); cell++) {
      const buckets = this.cells.get(cell) ?? []
      buckets.push(box)
      this.cells.set(cell, buckets)
    }
  }

  query(box: Box): T[] {
    const hits = new Set<T>()
    for (let cell = Math.floor(box.left / 512); cell <= Math.floor(box.right / 512); cell++) {
      for (const item of this.cells.get(cell) ?? []) if (overlaps(box, item)) hits.add(item)
    }
    return [...hits]
  }

  some(box: Box, accept: (item: T) => boolean = () => true): boolean {
    for (let cell = Math.floor(box.left / 512); cell <= Math.floor(box.right / 512); cell++) {
      for (const item of this.cells.get(cell) ?? []) {
        if (overlaps(box, item) && accept(item)) return true
      }
    }
    return false
  }
}
