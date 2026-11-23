import { expect, it } from 'vitest'
import { flattenPath } from '../src/geometry'

it('flattens painted curves while preserving the transfer endpoints', () => {
  const points = flattenPath([['M', 0, 0], ['L', 9, 0], ['Q', 15, 0, 15, 6], ['L', 15, 20]], .25)
  expect(points[0]).toEqual([0, 0])
  expect(points.at(-1)).toEqual([15, 20])
  expect(points).toContainEqual([13.5, 1.5])
  expect(points.length).toBeGreaterThan(4)
})

it('removes consecutive coincident line points', () => {
  expect(flattenPath([['M', 0, 0], ['L', 0, 0], ['L', 1, 0]])).toEqual([[0, 0], [1, 0]])
})
