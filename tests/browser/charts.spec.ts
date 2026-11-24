import { expect, test, type Page } from '@playwright/test'
import { demo } from '../../src/demo'

const homeHeading = (page: Page) => page.getByRole('heading', { name: 'Saved Charts' })
const canvasName = (page: Page) => page.getByLabel('Canvas name')
const saveStatus = (page: Page) => page.locator('#save-status')
const chartLink = (page: Page, title: string) => page.getByRole('link', { name: title, exact: true })
const kucoinUrl = '**/cases/kucoin-2020.json'
const kucoinTitle = 'KuCoin 2020 · Fund Flow Investigation'

function kucoinArchive() {
  const nodes = demo.addresses.slice(0, 2).map(node => ({ ...node, code: node.id, label: node.name }))
  const [transfer] = demo.transfers
  const view = {
    nodes: nodes.map((node, index) => ({ id: node.id, data: { layoutColumn: index } })),
    edges: [{ data: { events: [0] } }],
  }
  return {
    graph: { nodes, events: [{ ...transfer, timestamp: transfer.time, exhibit: transfer.evidence }], views: { all: view, core: view } },
    report: { chapters: [{ id: 'kucoin-report', title: 'KuCoin evidence' }] },
  }
}

test.beforeEach(async ({ page }) => {
  await page.route(kucoinUrl, route => route.fulfill({ status: 404 }))
})

async function saveChart(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(saveStatus(page)).toHaveText('Saved')
}

async function goHome(page: Page) {
  await page.getByRole('button', { name: 'Saved Charts' }).click()
  await expect(homeHeading(page)).toBeVisible()
}

async function openDemo(page: Page) {
  await page.goto('/#chart/canvas-workshop')
  await expect(page.locator('#status')).toContainText('6 transfers')
}

async function select(page: Page, reference: string) {
  return page.evaluate(ref => (window as any).maliciousFlow.set_view(ref), reference)
}

test('restores the workspace KuCoin archive with local edits and honors deletion', async ({ page }) => {
  let requests = 0
  await page.route(kucoinUrl, route => {
    requests++
    return route.fulfill({ json: kucoinArchive() })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('kucoin-history-fixture')) return
    localStorage.setItem('flow-edits:kucoin-2020', JSON.stringify({
      title: 'Previous KuCoin canvas', names: {}, notes: { relay: 'Saved KuCoin note' },
      positions: {}, bends: {}, entities: [], relations: [], drafts: [],
    }))
    sessionStorage.setItem('kucoin-history-fixture', 'true')
  })
  await page.goto('/')
  await chartLink(page, 'Previous KuCoin canvas').click()
  await expect(canvasName(page)).toHaveValue('Previous KuCoin canvas')
  await expect(page.getByRole('heading', { name: 'KuCoin evidence' })).toBeVisible()
  await select(page, 'relay')
  await expect(page.getByLabel('Node note')).toHaveValue('Saved KuCoin note')
  await goHome(page)
  await page.reload()
  await expect(chartLink(page, 'Previous KuCoin canvas')).toBeVisible()
  expect(requests).toBe(1)
  await page.getByRole('button', { name: 'Delete Previous KuCoin canvas' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('No saved charts yet.', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByText('No saved charts yet.', { exact: false })).toBeVisible()
  expect(requests).toBe(1)
})

test('moves the Agent panel horizontally with KuCoin scope and selection panels open', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 750 })
  await page.route(kucoinUrl, route => route.fulfill({ json: kucoinArchive() }))
  await page.goto('/')
  await chartLink(page, kucoinTitle).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '2')
  await select(page, 'relay')
  await expect(page.getByRole('complementary', { name: 'Selection details' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Network scope' })).toBeVisible()
  await page.getByRole('button', { name: 'Agent chat', exact: true }).click()
  const grip = page.getByLabel('Move Agent panel with the arrow keys')
  const panel = page.getByRole('region', { name: 'Agent chat' })
  const handle = (await grip.boundingBox())!
  const before = (await panel.boundingBox())!
  const graphPosition = () => page.evaluate(() => (window as any).flowCanvas.canvasCoordinates('origin'))
  const initialGraphPosition = await graphPosition()
  await page.mouse.move(handle.x + 6, handle.y + 12)
  await page.mouse.down()
  await page.mouse.move(handle.x + 225, handle.y - 54, { steps: 8 })
  await page.mouse.up()
  const moved = (await panel.boundingBox())!
  expect(moved.x - before.x).toBeGreaterThan(160)
  expect(moved.y).toBeLessThan(before.y)
  expect(await graphPosition()).toEqual(initialGraphPosition)
  await grip.press('ArrowLeft')
  expect((await panel.boundingBox())!.x).toBe(moved.x - 16)
})

test('manages two independent charts from the homepage and finds them by title, address or hash', async ({ page }) => {
  const address = '0x' + 'a'.repeat(40)
  const target = '0x' + 'b'.repeat(40)
  const hash = '0x' + 'c'.repeat(64)
  await page.route('https://eth.blockscout.com/api/v2/**', route => {
    if (route.request().url().endsWith('/addresses/' + address)) return route.fulfill({ json: { hash: address, has_token_transfers: false } })
    if (route.request().url().includes('/addresses/' + address + '/transactions')) return route.fulfill({ json: { items: [
      { hash, from: { hash: address }, to: { hash: target }, value: '2000000000000000000', status: 'ok', timestamp: '2020-11-23T12:00:00Z' },
    ] } })
    return route.fulfill({ status: 404 })
  })
  await page.goto('/')
  await expect(homeHeading(page)).toBeVisible()
  await expect(page.getByText('No saved charts yet.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'New Chart' }).click()
  await expect(canvasName(page)).toHaveValue('Ethereum investigation')
  const firstUrl = page.url()
  await canvasName(page).fill('Case Alpha')
  await saveChart(page)
  await page.getByLabel('Investigation seed').fill(address)
  await page.getByRole('button', { name: 'Collect and plot' }).click()
  await expect(page.locator('#status')).toContainText('1 transfer')
  await goHome(page)
  await page.getByRole('button', { name: 'New Chart' }).click()
  await expect(canvasName(page)).toHaveValue('Ethereum investigation')
  expect(page.url()).not.toBe(firstUrl)
  await canvasName(page).fill('Case Beta')
  await saveChart(page)
  await goHome(page)
  await page.reload()
  const search = page.getByRole('searchbox')
  await expect(chartLink(page, 'Case Alpha')).toBeVisible()
  await expect(chartLink(page, 'Case Beta')).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Case Alpha' })).toContainText(address)
  for (const query of ['alpha', address.toUpperCase(), hash]) {
    await search.fill(query)
    await expect(chartLink(page, 'Case Alpha')).toBeVisible()
    await expect(chartLink(page, 'Case Beta')).toBeHidden()
  }
  await search.clear()
  await page.getByRole('button', { name: 'Rename Case Beta' }).click()
  await page.getByRole('dialog').getByLabel('Chart name').fill('Case Bravo')
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click()
  await chartLink(page, 'Case Bravo').click()
  await expect(canvasName(page)).toHaveValue('Case Bravo')
  await expect(page.locator('#status')).toContainText('0 transfers')
  await goHome(page)
  await page.getByRole('button', { name: 'Delete Case Bravo' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(chartLink(page, 'Case Bravo')).toBeVisible()
  await page.getByRole('button', { name: 'Delete Case Bravo' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(chartLink(page, 'Case Bravo')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('saved-charts.png') })
  await chartLink(page, 'Case Alpha').click()
  await expect(page).toHaveURL(firstUrl)
  await expect(canvasName(page)).toHaveValue('Case Alpha')
  await expect(page.locator('#status')).toContainText('1 transfer')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(canvasName(page)).toHaveValue('Ethereum investigation')
  await saveChart(page)
  await goHome(page)
  await expect(chartLink(page, 'Ethereum investigation')).toBeVisible()
  await expect(chartLink(page, 'Case Alpha')).toHaveCount(0)
})

test('migrates the v1 chart and its edits and paginates by creation time', async ({ page }) => {
  await page.addInitScript(async data => {
    if (sessionStorage.getItem('fixture')) return
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('maliciousflow', 1)
      request.onupgradeneeded = () => {
        const workspace = request.result.createObjectStore('workspace')
        workspace.put(data, 'active')
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })
    localStorage.setItem('flow-edits:' + data.id, JSON.stringify({
      title: 'Legacy canvas', names: { relay: 'Legacy relay' }, notes: { relay: 'From the old workspace' },
      positions: {}, bends: {}, entities: [], relations: [], drafts: [],
    }))
    sessionStorage.setItem('fixture', 'true')
  }, { ...demo, id: 'legacy-case' })
  await page.goto('/')
  await chartLink(page, 'Legacy canvas').click()
  await expect(canvasName(page)).toHaveValue('Legacy canvas')
  await select(page, 'relay')
  await expect(page.getByLabel('Node note')).toHaveValue('From the old workspace')
  await goHome(page)
  await page.evaluate(async () => {
    const modulePath = '/src/storage.ts'
    const { saveCase } = await import(modulePath)
    await Promise.all(Array.from({ length: 10 }, (_, index) => saveCase({
      id: 'pagination-' + index, title: 'Chart ' + index, addresses: [], transfers: [],
    })))
  })
  await page.reload()
  await expect(page.locator('#charts-total')).toHaveText('11 charts')
  await expect(page.locator('#charts-page')).toHaveText('1 / 2')
  await expect(chartLink(page, 'Legacy canvas')).toBeHidden()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(chartLink(page, 'Legacy canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByRole('button', { name: 'Created' }).click()
  await expect(page.locator('#charts-created')).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.locator('#charts-rows tr').first()).toContainText('Legacy canvas')
  await page.getByLabel('Charts per page').selectOption('25')
  await expect(page.locator('#charts-page')).toHaveText('1 / 1')
  await expect(page.locator('#charts-rows tr')).toHaveCount(11)
})

test('retries a failed save and reopens the committed layout, notes, relations and evidence', async ({ page }) => {
  await openDemo(page)
  const initial = await select(page, 'D-1')
  const edgeId: string = initial.selection.id
  await select(page, 'relay')
  await page.getByLabel('Node note').fill('Reviewed the relay')
  await page.getByLabel('Node note').press('Tab')
  const relation: string = await page.evaluate(id => {
    const api = (window as any).maliciousFlow
    api.edit_canvas({ action: 'move', id: 'relay', position: [730, 360] })
    api.edit_canvas({ action: 'bend', id, offset: 25 })
    return api.edit_canvas({ action: 'connect', source: 'origin', target: 'alpha', note: 'Manual evidence link' })
  }, edgeId)
  await expect(saveStatus(page)).toHaveText('Unsaved changes')
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (record, key) {
      if (Array.isArray(key) && key[0] === 'edits') {
        IDBObjectStore.prototype.put = put
        throw new DOMException('Injected write failure', 'QuotaExceededError')
      }
      return put.call(this, record, key)
    }
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(saveStatus(page)).toHaveText('Save failed. Retry.')
  await expect(page.getByLabel('Node note')).toHaveValue('Reviewed the relay')
  await page.reload()
  await expect(saveStatus(page)).toHaveText('Unsaved changes')
  await saveChart(page)
  await page.evaluate(() => localStorage.removeItem('flow-edits:canvas-workshop'))
  await goHome(page)
  await page.reload()
  await chartLink(page, demo.title).click()
  await expect(saveStatus(page)).toHaveText('Saved')
  await select(page, 'relay')
  await expect(page.getByLabel('Node note')).toHaveValue('Reviewed the relay')
  const nodeBox = await page.evaluate(() => (window as any).flowCanvas.inspectDrawing().nodes.find((node: any) => node.id === 'relay').box)
  expect(nodeBox.slice(0, 2)).toEqual([570, 296])
  await select(page, relation)
  await expect(page.getByLabel('Edge note')).toHaveValue('Manual evidence link')
  await select(page, 'D-1')
  await expect(page.getByRole('button', { name: 'Evidence D-1' })).toBeVisible()
  await page.getByRole('button', { name: 'Evidence D-1' }).click()
  await expect(page.getByRole('heading', { name: 'Evidence D-1', exact: true })).toBeVisible()
  await expect(page.locator('#status')).toContainText('6 transfers')
  const databaseCheckpoint = await page.evaluate(async () => {
    const modulePath = '/src/storage.ts'
    const { loadChart } = await import(modulePath)
    return loadChart('canvas-workshop')
  })
  expect(databaseCheckpoint.edits.value.bends[edgeId]).toBe(25)
  expect(databaseCheckpoint.data.transfers).toEqual(demo.transfers)
  expect(databaseCheckpoint.data.chapters).toEqual(demo.chapters)
})

test('previews, undoes, resets and saves render colors on nodes and both edge types', async ({ page }) => {
  await openDemo(page)
  const style = (id: string) => page.evaluate(ref => (window as any).flowCanvas.elementStyle(ref), id)
  await select(page, 'relay')
  const nodeColor = page.getByLabel('Node color')
  const nodeOriginal = await style('relay')
  await nodeColor.evaluate((field: HTMLInputElement) => {
    field.value = '#ed65aa'
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect.poll(() => style('relay')).toMatchObject({ stroke: '#ed65aa', halo: true })
  expect((await style('relay')).fill).not.toBe(nodeOriginal.fill)
  await expect(saveStatus(page)).toHaveText('Saved')
  await nodeColor.dispatchEvent('change')
  await expect(saveStatus(page)).toHaveText('Unsaved changes')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(nodeColor).toHaveValue('#6cdbba')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(nodeColor).toHaveValue('#ed65aa')
  const edgeId = (await select(page, 'D-1')).selection.id
  const edgeColor = page.getByLabel('Edge color')
  await edgeColor.fill('#d68745')
  await expect.poll(() => style(edgeId)).toMatchObject({ stroke: '#d68745', endArrowFill: '#d68745', halo: true })
  await page.getByRole('button', { name: 'Reset color' }).click()
  await expect(edgeColor).toHaveValue('#84b1ff')
  await expect.poll(() => style(edgeId)).toMatchObject({ stroke: '#84b1ff', endArrowFill: '#84b1ff' })
  await edgeColor.fill('#8079ec')
  const relation = await page.evaluate(() =>
    (window as any).maliciousFlow.edit_canvas({ action: 'connect', source: 'relay', target: 'origin' }))
  await select(page, relation)
  await edgeColor.fill('#e46373')
  await expect.poll(() => style(relation)).toMatchObject({ stroke: '#e46373', endArrowFill: '#e46373' })
  await saveChart(page)
  await goHome(page)
  await page.reload()
  await chartLink(page, demo.title).click()
  await expect(saveStatus(page)).toHaveText('Saved')
  await select(page, 'relay')
  await expect(nodeColor).toHaveValue('#ed65aa')
  await select(page, 'D-1')
  await expect(edgeColor).toHaveValue('#8079ec')
  await expect(page.getByRole('button', { name: 'Evidence D-1' })).toBeVisible()
  await select(page, relation)
  await expect(edgeColor).toHaveValue('#e46373')
  await page.getByRole('button', { name: 'Reset color' }).click()
  await expect(edgeColor).toHaveValue('#baba83')
})

test('drags the Agent panel within the canvas and keeps the conversation and placeholders available', async ({ page }) => {
  await openDemo(page)
  const toggle = page.getByRole('button', { name: 'Agent chat', exact: true })
  const panel = page.getByRole('region', { name: 'Agent chat' })
  await toggle.click()
  await expect(panel.getByRole('button', { name: 'New session (Coming soon)' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Search chart sessions (Coming soon)' })).toBeDisabled()
  await panel.getByLabel('Attachments').click()
  await expect(panel.getByRole('button', { name: 'Add files or images · Coming soon' })).toBeDisabled()
  await panel.getByLabel('Attachments').click()
  const stage = (await page.locator('#stage').boundingBox())!
  const initialPanel = (await panel.boundingBox())!
  const initialToggle = (await toggle.boundingBox())!
  const position = () => page.evaluate(() => (window as any).flowCanvas.canvasCoordinates('origin'))
  const initialGraph = await position()
  const dragTo = async (left: number, top: number) => {
    const title = (await page.locator('#agent-titlebar').boundingBox())!
    await page.mouse.move(title.x + 25, title.y + 17)
    await page.mouse.down()
    await page.mouse.move(left, top, { steps: 8 })
    await page.mouse.up()
  }
  await dragTo(stage.x + 55, stage.y + 40)
  const first = (await panel.boundingBox())!
  const firstToggle = (await toggle.boundingBox())!
  expect(first.x).toBeLessThan(initialPanel.x)
  expect(first.y).toBeLessThan(initialPanel.y)
  expect(firstToggle.x - initialToggle.x).toBe(first.x - initialPanel.x)
  expect(firstToggle.y - initialToggle.y).toBe(first.y - initialPanel.y)
  await dragTo(stage.x + stage.width + 20, stage.y + 140)
  const second = (await panel.boundingBox())!
  expect(second.x).toBeGreaterThan(first.x)
  expect(second.x + second.width).toBeLessThanOrEqual(stage.x + stage.width)
  expect(second.y).toBeGreaterThan(first.y)
  expect(await position()).toEqual(initialGraph)
  const question = panel.getByLabel('Ask about this selection')
  await question.fill('Which evidence is available?')
  await panel.getByRole('button', { name: 'Collapse panel' }).click()
  await expect(panel).toBeHidden()
  await toggle.click()
  await expect(question).toHaveValue('Which evidence is available?')
  expect((await panel.boundingBox())!.x).toEqual(second.x)
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByRole('log')).toContainText('Sources')
  await panel.getByRole('button', { name: 'Collapse panel' }).click()
  await toggle.click()
  await expect(panel.getByRole('log')).toContainText('Which evidence is available?')
  await page.screenshot({ path: test.info().outputPath('agent-panel.png') })
  await page.setViewportSize({ width: 880, height: 730 })
  await expect.poll(async () => {
    const canvas = (await page.locator('#stage').boundingBox())!
    const dialog = (await panel.boundingBox())!
    return dialog.x >= canvas.x && dialog.x + dialog.width <= canvas.x + canvas.width
      && dialog.y >= canvas.y && dialog.y + dialog.height <= canvas.y + canvas.height
  }).toBe(true)
})

test('drags the star launcher with the Agent collapsed and expanded and preserves click-to-toggle', async ({ page }) => {
  await openDemo(page)
  const toggle = page.getByRole('button', { name: 'Agent chat', exact: true })
  const panel = page.getByRole('region', { name: 'Agent chat' })
  const dragLauncher = async (horizontal: number, vertical: number) => {
    const box = (await toggle.boundingBox())!
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + horizontal, centerY + vertical, { steps: 8 })
    await page.mouse.up()
  }

  const initial = (await toggle.boundingBox())!
  await dragLauncher(-190, -68)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toBeHidden()
  const moved = (await toggle.boundingBox())!
  expect(moved.x).toBe(initial.x - 190)
  expect(moved.y).toBe(initial.y - 68)

  await toggle.click()
  await expect(panel).toBeVisible()
  expect(await toggle.boundingBox()).toEqual(moved)
  const opened = (await panel.boundingBox())!
  expect(opened.x + opened.width).toBe(moved.x + moved.width)
  await dragLauncher(-100, 35)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const draggedPanel = (await panel.boundingBox())!
  const draggedToggle = (await toggle.boundingBox())!
  expect(draggedPanel.x - opened.x).toBe(-100)
  expect(draggedPanel.y - opened.y).toBe(35)
  expect(draggedToggle.x - moved.x).toBe(-100)
  expect(draggedToggle.y - moved.y).toBe(35)

  await toggle.click()
  await expect(panel).toBeHidden()
  expect(await toggle.boundingBox()).toEqual(draggedToggle)
  await toggle.press('ArrowRight')
  expect((await toggle.boundingBox())!.x).toBe(draggedToggle.x + 16)
  await toggle.press('Enter')
  await expect(panel).toBeVisible()
})
