import { expect, test } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'

const casePath = process.env.KUCOIN_CASE
const reportPath = process.env.KUCOIN_REPORT

test('imports and reconciles the local KuCoin case in core and full views', async ({ page }) => {
  test.skip(!casePath || !existsSync(casePath), 'Provide KUCOIN_CASE to exercise the workspace data')
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  const importStarted = performance.now()
  await page.locator('#case-file').setInputFiles([casePath!, ...(reportPath && existsSync(reportPath) ? [reportPath] : [])])
  await expect(page.getByLabel('画布名称')).toHaveValue('KuCoin 2020 · 资金流调查', { timeout: 40_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '182', { timeout: 40_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '285')
  await expect(page.locator('#status')).toContainText('1,307 笔转账')
  async function savePainted(view: string, elapsed: number) {
    const snapshot = await page.evaluate(() => (window as any).flowCanvas.renderedSnapshot())
    expect(snapshot.geometry).toBe('rendered')
    expect(snapshot.nodes.every((node: { box?: number[] }) => node.box?.every(Number.isFinite))).toBe(true)
    expect(snapshot.edges.every((edge: { points: unknown[] }) => edge.points.length >= 2)).toBe(true)
    if (view === 'return') expect(snapshot.labels.length).toBeGreaterThan(0)
    writeFileSync(test.info().outputPath(view + '.geometry.json'), JSON.stringify(snapshot))
    console.log(view + ' render elapsed: ' + Math.round(elapsed) + ' ms')
    return snapshot
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
  const core = await inspectPaths()
  expect(core).toMatchObject({ brokenAnchors: 0, blocked: 0 })
  expect(core.curves).toBeGreaterThan(0)
  await page.screenshot({ path: test.info().outputPath('kucoin-core.png') })
  for (const [id, addresses, edges] of [['return', '5', '6'], ['batch-D8', '248', '249']]) {
    const start = performance.now()
    await page.getByLabel('案件视图').selectOption(id)
    await expect(page.locator('#graph')).toHaveAttribute('data-nodes', addresses)
    await expect(page.locator('#graph')).toHaveAttribute('data-edges', edges)
    await savePainted(id, performance.now() - start)
  }
  const allStarted = performance.now()
  await page.getByLabel('案件视图').selectOption('all')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '1748', { timeout: 45_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-edges', '2475')
  await expect(page.locator('#status')).toContainText('6,314 笔转账')
  await savePainted('all', performance.now() - allStarted)
  const full = await inspectPaths()
  expect(full).toMatchObject({ brokenAnchors: 0, blocked: 0 })
  console.log('KuCoin path diagnostics', { core, full })
  await page.getByRole('searchbox').fill('E-6-1-0001')
  await page.locator('#results button').first().click()
  await expect(page.getByRole('heading', { name: '交易明细' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '证据 E-6-1-0001', exact: true }).click()
  await expect(page.getByRole('heading', { name: '证据 E-6-1-0001', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('画布名称')).toHaveValue('KuCoin 2020 · 资金流调查', { timeout: 40_000 })
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '182', { timeout: 40_000 })
  expect(errors).toEqual([])
})
