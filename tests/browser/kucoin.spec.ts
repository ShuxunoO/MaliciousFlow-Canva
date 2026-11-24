import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const casePath = process.env.KUCOIN_CASE
const reportPath = process.env.KUCOIN_REPORT
const offlinePath = process.env.KUCOIN_OFFLINE

test('imports and reconciles the local KuCoin case in core and full views', async ({ page }) => {
  test.skip(!casePath || !existsSync(casePath), 'Provide KUCOIN_CASE to exercise the workspace data')
  test.setTimeout(90_000)
  const original = JSON.parse(readFileSync(casePath!, 'utf8'))
  const timings: Record<string, number> = {}
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  const importStarted = performance.now()
  await page.locator('#case-file').setInputFiles([casePath!, ...(reportPath && existsSync(reportPath) ? [reportPath] : [])])
  await expect(page.getByLabel('Canvas name')).toHaveValue('KuCoin 2020 · Fund Flow Investigation', { timeout: 40_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '182', { timeout: 40_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '285')
  await expect(page.locator('#status')).toContainText('1,307 transfers')
  async function savePainted(view: string, elapsed: number) {
    const snapshot = await page.evaluate(() => (window as any).flowCanvas.renderedSnapshot())
    expect(snapshot.geometry).toBe('rendered')
    expect(snapshot.nodes.every((node: { box?: number[] }) => node.box?.every(Number.isFinite))).toBe(true)
    expect(snapshot.nodes.every((node: { hasIcon: boolean }) => node.hasIcon)).toBe(true)
    expect(snapshot.edges.every((edge: { points: unknown[] }) => edge.points.length >= 2)).toBe(true)
    if (view === 'return') expect(snapshot.labels.length).toBeGreaterThan(0)
    writeFileSync(test.info().outputPath(view + '.geometry.json'), JSON.stringify(snapshot))
    const expectedEvents = new Set<number>(original.views[view].edges.flatMap(
      (edge: { data: { events: number[] } }) => edge.data.events))
    const expectedLedger = [...expectedEvents].map(index => {
      const event = original.events[index]
      return JSON.stringify([event.id, event.amountRaw ?? null, event.exhibit || null])
    }).sort()
    const actualLedger = snapshot.edges.flatMap((edge: { data: { events: unknown[][] } }) =>
      edge.data.events.map(event => JSON.stringify(event))).sort()
    expect(actualLedger).toEqual(expectedLedger)
    timings[view] = Math.round(elapsed)
  }
  async function inspectPaths() {
    return page.evaluate(() => {
      const drawing = (window as any).flowCanvas.inspectDrawing() as {
        nodes: { id: string; box: number[] }[]
        edges: { id: string; source: string; target: string; points: number[][]; path: unknown[][]; blocked: boolean }[]
      }
      const nodes = new Map(drawing.nodes.map(item => [item.id, item.box]))
      let brokenAnchors = 0
      let blocked = 0
      let curves = 0
      for (const edge of drawing.edges) {
        const source = nodes.get(edge.source)!
        const target = nodes.get(edge.target)!
        const start = edge.points[0]
        const end = edge.points.at(-1)!
        if (start[0] !== source[0] + source[2] || start[1] < source[1] || start[1] > source[1] + source[3]
          || end[0] !== target[0] || end[1] < target[1] || end[1] > target[1] + target[3]) brokenAnchors++
        if (edge.blocked) blocked++
        if (edge.path.some(command => command[0] === 'Q')) curves++
      }
      return { brokenAnchors, blocked, curves }
    })
  }
  await savePainted('core', performance.now() - importStarted)
  const inbound = await page.evaluate(() => {
    const drawing = (window as any).flowCanvas.renderedSnapshot()
    const edges = drawing.edges.filter((edge: { source: string; target: string }) =>
      (edge.source.endsWith('e58258') || edge.source.endsWith('f9769c')) && edge.target.endsWith('b4b8c23'))
    const labels = new Set(drawing.labels.map((label: { edge: string }) => label.edge))
    return edges.map((edge: { id: string; data: { asset: string }; points: number[][] }) => ({
      label: labels.has(edge.id), id: edge.id, asset: edge.data.asset,
      y: edge.points.find(([x, y], index) => edge.points[index + 1]?.[0] - x > 130 && edge.points[index + 1]?.[1] === y)?.[1],
    }))
  })
  expect(inbound).toHaveLength(20)
  expect(inbound.every((item: { label: boolean; y?: number }) => item.label && item.y !== undefined)).toBe(true)
  expect(new Set(inbound.map((item: { y: number }) => item.y)).size).toBe(20)
  const core = await inspectPaths()
  expect(core).toMatchObject({ brokenAnchors: 0, blocked: 0 })
  expect(core.curves).toBeGreaterThan(0)
  await page.screenshot({ path: test.info().outputPath('kucoin-core.png') })
  await page.evaluate(id => (window as any).maliciousFlow.set_view(id), inbound[0].id)
  await page.getByRole('button', { name: 'Focus address pair' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '10')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '2')
  const clicked = inbound.find((item: { id: string }) => item.id !== inbound[0].id &&
    item.id.includes('e58258') === inbound[0].id.includes('e58258'))
  const rail = await page.evaluate(id => (window as any).flowCanvas.transactionHandlePoint(id), clicked.id)
  await page.mouse.click(rail[0], rail[1])
  await expect(page.locator('#selection')).toContainText(clicked.asset)
  await page.getByRole('button', { name: 'Exit pair view' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '285')
  await page.getByRole('button', { name: 'Close details' }).click()
  const scopes = page.getByRole('complementary', { name: 'Network scope' })
  await expect(scopes.getByRole('button', { name: /Core paths/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(scopes.locator('.scope-batches button')).toHaveCount(8)
  for (const id of ['return', 'original', ...Array.from({ length: 8 }, (_, index) => 'batch-D' + (index + 1))]) {
    const start = performance.now()
    await scopes.locator(`[data-scope="${id}"]`).click()
    await expect(page.locator('#graph')).toHaveAttribute('data-nodes', String(original.views[id].nodes.length))
    await expect(page.locator('#graph')).toHaveAttribute('data-edges', String(original.views[id].edges.length))
    await savePainted(id, performance.now() - start)
  }
  await scopes.getByRole('button', { name: /Public return flow/ }).click()
  await expect(page.locator('#status')).toContainText('6 transfers')
  await page.getByLabel('Transaction labels').selectOption('off')
  await expect.poll(() => page.evaluate(() => (window as any).flowCanvas.renderedSnapshot().labels.length)).toBe(0)
  await page.getByLabel('Transaction labels').selectOption('on')
  await expect.poll(() => page.evaluate(() => (window as any).flowCanvas.renderedSnapshot().labels.length)).toBeGreaterThan(0)
  await page.getByLabel('Include historical & comparison activity').uncheck()
  await expect(page.locator('#status')).toContainText('6 transfers')
  await scopes.getByRole('button', { name: /Core paths/ }).click()
  const contextualCount = new Set(original.views.core.edges.flatMap((edge: {data: {events: number[]}}) => edge.data.events))
  const returnHashes = new Set((original.views.return.edges as {data: {events: number[]}}[])
    .flatMap(edge => edge.data.events).map(index => original.events[index].hash))
  const coreCount = [...contextualCount].filter(index => {
    const event = original.events[index as number]
    return returnHashes.has(event.hash) || event.section !== '6.1' && !/历史活动|筛选对照/.test(event.note)
  }).length
  await expect(page.locator('#status')).toContainText(coreCount.toLocaleString('en-US') + ' transfers')
  await page.getByLabel('Include historical & comparison activity').check()
  await page.getByLabel('Transaction labels').selectOption('auto')
  const allStarted = performance.now()
  await scopes.getByRole('button', { name: /Full network/ }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '1748', { timeout: 45_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '2475')
  await expect(page.locator('#status')).toContainText('6,314 transfers')
  await savePainted('all', performance.now() - allStarted)
  const compact = await page.evaluate(() => {
    const drawing = (window as any).flowCanvas.renderedSnapshot()
    const edges = drawing.edges.filter((edge: { source: string; target: string }) =>
      edge.source.endsWith('e58258') && edge.target.endsWith('b4b8c23'))
    return edges.map(({ points }: { points: number[][] }) => {
      const ys = points.map(point => point[1])
      const ends = [ys[0], ys.at(-1)!]
      return Math.max(Math.min(...ends) - Math.min(...ys), Math.max(...ys) - Math.max(...ends))
    })
  })
  expect(compact).toHaveLength(123)
  expect(Math.max(...compact)).toBeLessThan(900)
  const full = await inspectPaths()
  expect(full).toMatchObject({ brokenAnchors: 0, blocked: 0 })
  const filterStarted = performance.now()
  await page.getByLabel('Start date UTC').fill('2099-01-01')
  await expect(page.locator('#status')).toContainText('0 transfers')
  timings.filter = Math.round(performance.now() - filterStarted)
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '2475', { timeout: 45_000 })
  writeFileSync(test.info().outputPath('kucoin-timings.json'), JSON.stringify(timings, null, 2))
  await page.evaluate(() => (window as any).maliciousFlow.set_view('E-1-1-0006'))
  await expect(page.getByRole('button', { name: 'Evidence E-1-1-0006' })).toBeVisible()
  await page.getByRole('button', { name: 'Focus address pair' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '123')
  await expect.poll(() => page.evaluate(() => (window as any).flowCanvas.renderedSnapshot().labels.length)).toBe(123)
  await page.getByRole('button', { name: 'Exit pair view' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '2475')
  await page.getByRole('searchbox').fill('E-6-1-0001')
  await page.locator('#results button').first().click()
  await expect(page.getByRole('heading', { name: 'Transaction details' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Evidence E-6-1-0001', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Evidence E-6-1-0001', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Canvas name')).toHaveValue('KuCoin 2020 · Fund Flow Investigation', { timeout: 40_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '182', { timeout: 40_000 })
  expect(errors).toEqual([])
})

test('opens the packaged KuCoin canvas directly from disk', async ({ page }) => {
  test.skip(!offlinePath || !existsSync(offlinePath), 'Provide KUCOIN_OFFLINE to exercise the portable case')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(new URL('file://' + offlinePath).href)
  await expect(page.locator('#status')).toContainText('1,307 transfers')
  await page.getByRole('button', { name: /Public return flow/ }).click()
  await expect(page.locator('#status')).toContainText('5 nodes · 6 edges · 6 transfers')
  await page.getByRole('button', { name: 'Collapse report' }).click()
  await expect(page.getByRole('complementary', { name: 'Case report' })).toBeHidden()
  await page.getByRole('searchbox').fill('G2')
  await page.locator('#results button').first().click()
  const inspector = page.getByRole('complementary', { name: 'Selection details' })
  await expect(inspector.getByRole('heading', { name: 'G2', exact: true })).toBeVisible()
  await expect(inspector.locator('img')).toHaveJSProperty('complete', true)
  expect((await inspector.boundingBox())!.x).toBeGreaterThan((await page.locator('#stage').boundingBox())!.x)
  await inspector.locator('.inspector-paths button').first().click()
  await expect(inspector.getByRole('heading', { name: 'Transaction details' })).toBeVisible()
  await inspector.getByRole('button', { name: /^Evidence/ }).first().click()
  const toggle = page.getByRole('button', { name: 'Collapse report' })
  await expect(toggle).toBeInViewport()
  await expect(page.locator('#report-evidence')).toBeVisible()
  expect(errors).toEqual([])
  await page.getByRole('complementary', { name: 'Case report' }).evaluate(panel =>
    Promise.all(panel.getAnimations().map(animation => animation.finished)))
  await page.screenshot({ path: test.info().outputPath('kucoin-inspector.png') })
})
