import { expect, test } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const legacyHtml = process.env.KUCOIN_BASELINE_HTML

test('captures actual AML-Canva KuCoin geometry for the layout baseline', async ({ page }) => {
  test.skip(!legacyHtml || !existsSync(legacyHtml), 'Set KUCOIN_BASELINE_HTML to the original offline canvas')
  await page.goto(pathToFileURL(legacyHtml!).href)
  await page.waitForFunction(() => (window as any).fundFlow?.ready)
  for (const [view, nodes, edges, events] of [
    ['core', 182, 285, 1307], ['return', 5, 6, 6], ['batch-D8', 248, 249, 473],
  ] as const) {
    const snapshot = await page.evaluate(async name => {
      const app = (window as any).fundFlow
      await app.changeView(name)
      if (!app.ready || app.view !== name) throw new Error(app.error || 'The original view did not render')
      const get = (id: string, shape: string) => app.graph.context.element.getElement(id).getShape(shape)
      const box = (shape: any) => {
        const { min, max } = shape.getBounds()
        return [min[0], min[1], max[0] - min[0], max[1] - min[1]]
      }
      type Point = [number, number]
      const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      function flatten(points: Point[], a: Point, b: Point, c: Point, d: Point) {
        const gap = Math.max(Math.hypot(b[0] - (2 * a[0] + d[0]) / 3, b[1] - (2 * a[1] + d[1]) / 3),
          Math.hypot(c[0] - (a[0] + 2 * d[0]) / 3, c[1] - (a[1] + 2 * d[1]) / 3))
        if (gap <= .5) {
          points.push(d)
          return
        }
        const ab = mid(a, b)
        const bc = mid(b, c)
        const cd = mid(c, d)
        const left = mid(ab, bc)
        const right = mid(bc, cd)
        const center = mid(left, right)
        flatten(points, a, ab, left, center)
        flatten(points, center, right, cd, d)
      }
      return {
        geometry: 'rendered', view: name, tolerance: .5,
        nodes: app.active.nodes.map((node: any) => ({ id: node.id, shape: 'ellipse', box: box(get(node.id, 'key')) })),
        edges: app.active.edges.map((edge: any) => {
          const path = get(edge.id, 'key').attributes.d
          const points: Point[] = []
          for (const [command, x, y, cx, cy, endX, endY] of path) {
            if (command === 'C') flatten(points, points.at(-1)!, [x, y], [cx, cy], [endX, endY])
            else if (command === 'M' || command === 'L') points.push([x, y])
            else throw new Error('Unexpected original path command ' + command)
          }
          return { id: edge.id, source: edge.source, target: edge.target, points,
            data: { amount: edge.data.amount, asset: edge.data.asset, events: edge.data.events.map((index: number) => {
              const item = app.data.events[index]
              return [item.id, item.amountRaw, item.exhibit]
            }) } }
        }),
        labels: app.active.edges.flatMap((edge: any) => {
          const shape = get(edge.id, 'label')
          return shape ? [{ id: 'label:' + edge.id, edge: edge.id, box: box(shape) }] : []
        }),
      }
    }, view)
    expect(snapshot.nodes).toHaveLength(nodes)
    expect(snapshot.edges).toHaveLength(edges)
    expect(snapshot.labels.length).toBeGreaterThan(0)
    expect(new Set(snapshot.edges.flatMap((edge: any) => edge.data.events.map((event: any) => event[0]))).size).toBe(events)
    writeFileSync(test.info().outputPath(view + '.legacy.geometry.json'), JSON.stringify(snapshot))
  }
})
