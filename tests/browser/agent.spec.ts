import { expect, test } from '@playwright/test'

test('collects an Ethereum transaction in two updates and restores the investigation', async ({ page }) => {
  const hash = '0x' + '3'.repeat(64)
  const from = { hash: '0x' + '1'.repeat(40) }
  const to = { hash: '0x' + '2'.repeat(40) }
  const timestamp = '2020-11-23T12:00:00Z'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseToken!: () => void
  const waitForFirstBatch = new Promise<void>(resolve => { releaseToken = resolve })
  await page.route('https://eth.blockscout.com/api/v2/transactions/**', async route => {
    if (route.request().url().endsWith('/token-transfers')) {
      await waitForFirstBatch
      await route.fulfill({ json: { items: [{ transaction_hash: hash, log_index: 4, timestamp, from, to,
        token: { address_hash: '0x' + 'a'.repeat(40), symbol: 'USDC', type: 'ERC-20' }, total: { value: '1200000', decimals: '6' } }] } })
    } else {
      await route.fulfill({ json: { hash, timestamp, from, to, status: 'ok', value: '1000000000000000000' } })
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New Chart' }).click()
  await page.getByLabel('Investigation seed').fill(hash)
  await page.getByRole('button', { name: 'Collect and plot' }).click()
  await expect(page.locator('#status')).toContainText('1 transfer')
  await page.getByRole('button', { name: 'Agent chat' }).click()
  const updateStarted = performance.now()
  releaseToken()
  await expect(page.locator('#status')).toContainText('2 transfers')
  console.log('Analysis batch and render: ' + Math.round(performance.now() - updateStarted) + ' ms')
  await page.getByRole('button', { name: 'Agent chat' }).click()
  await expect(page.locator('#agent-messages')).toContainText('2 transfers')
  const snapshot = await page.evaluate(() => (window as any).maliciousFlow.set_view())
  expect(snapshot.revision).toBe(2)
  await page.getByRole('region', { name: 'Agent chat' }).getByRole('button', { name: 'Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Investigation draft' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('agent-investigation.png') })
  await page.reload()
  await expect(page.locator('#status')).toContainText('2 transfers')
  await page.getByRole('button', { name: 'Agent chat' }).click()
  await expect(page.locator('#agent-messages')).toContainText('2 transfers')
  const updates = await page.evaluate(caseId => (window as any).maliciousFlow.analysis_updates(caseId, 1), snapshot.caseId)
  expect(updates).toMatchObject({ caseId: snapshot.caseId, revision: 2, receipts: [{ revision: 2, added: 1 }] })
  expect(errors).toEqual([])
})

test('applies Agent canvas commands and asks the user to confirm entity changes', async ({ page }) => {
  await page.goto('/#chart/canvas-workshop')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  await page.evaluate(async () => {
    const api = (window as any).maliciousFlow
    api.edit_canvas({ action: 'rename', id: 'relay', text: 'Reviewed relay wallet' })
    await api.set_view('relay')
    api.edit_entity({ name: 'Investigation A', members: ['origin', 'relay'] })
  })
  await expect(page.getByRole('heading', { name: 'Reviewed relay wallet', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entity assignment review' })).toBeVisible()
  await page.getByRole('button', { name: 'Group by entity' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  await page.getByRole('button', { name: 'Confirm assignment' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '4')
})

test('queries a confirmed historical Ethereum transaction from the configured provider', async ({ page }) => {
  test.skip(!process.env.FLOW_LIVE_BLOCKSCOUT, 'Set FLOW_LIVE_BLOCKSCOUT=1 for a public-provider test')
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'New Chart' }).click()
  await page.getByLabel('Investigation seed').fill('0xfb97742ba12997a223fdbb0063a07042f6aa5431dc0767572da3428256314dbf')
  await page.getByRole('button', { name: 'Collect and plot' }).click()
  await expect(page.locator('#status')).toContainText('1 transfer', { timeout: 60_000 })
  await expect(page.locator('#agent-messages')).toContainText('0.0005944537861548 ETH', { timeout: 60_000 })
})

test('hands the current selection and question to an external Agent handler', async ({ page }) => {
  await page.goto('/#chart/canvas-workshop')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  await page.evaluate(async () => {
    const api = (window as any).maliciousFlow
    await api.set_view('D-3')
    api.set_agent_handler(({ question, context }: { question: string; context: { transfers: { id: string; amount: string }[] } }) => ({
      text: question + ' ' + context.transfers[0].amount + ' ETH',
      refs: [context.transfers[0].id],
    }))
  })
  await page.getByRole('button', { name: 'Agent chat' }).click()
  await page.getByLabel('Ask about this selection').fill('External reply')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('#agent-messages')).toContainText('External reply 12.75 ETH')
})

test('follows a downstream transfer and opens its evidence from the Agent result', async ({ page }) => {
  const seed = '0x' + '1'.repeat(64)
  const next = '0x' + '2'.repeat(64)
  const from = { hash: '0x' + 'a'.repeat(40) }
  const relay = { hash: '0x' + 'b'.repeat(40) }
  const to = { hash: '0x' + 'c'.repeat(40) }
  const first = { hash: seed, from, to: relay, value: '1000000000000000000', status: 'ok', timestamp: '2020-11-23T12:00:00Z' }
  const second = { hash: next, from: relay, to, value: '2000000000000000000', status: 'ok', timestamp: '2020-11-23T12:01:00Z' }
  await page.route('https://eth.blockscout.com/api/v2/**', async route => {
    const url = route.request().url()
    if (url.endsWith('/transactions/' + seed)) return route.fulfill({ json: first })
    if (url.endsWith('/token-transfers')) return route.fulfill({ json: { items: [] } })
    if (url.endsWith('/addresses/' + relay.hash)) return route.fulfill({ json: { ...relay, has_token_transfers: false } })
    if (url.endsWith('/addresses/' + relay.hash + '/transactions')) return route.fulfill({ json: { items: [first, second] } })
    return route.fulfill({ status: 404 })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New Chart' }).click()
  await page.getByLabel('Investigation seed').fill(seed)
  await page.getByLabel('Direction').selectOption('downstream')
  await page.getByLabel('Hops').selectOption('2')
  await page.getByRole('button', { name: 'Collect and plot' }).click()
  await expect(page.locator('#status')).toContainText('2 transfers')
  await expect(page.locator('#agent-messages')).toContainText('Downstream search, up to 2 hops')
  await page.screenshot({ path: test.info().outputPath('downstream-trace.png') })
  await page.locator('#agent-messages').getByRole('button', { name: '1:' + next + ':external' }).click()
  await expect(page.getByRole('heading', { name: 'Transaction details' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Selection details' })).toContainText(next)
})

test('restores an unsent question after collapse and reload', async ({ page }) => {
  await page.goto('/#chart/canvas-workshop')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  const toggle = page.getByRole('button', { name: 'Agent chat' })
  await toggle.click()
  const question = page.getByLabel('Ask about this selection')
  await question.fill('What evidence supports this transfer?')
  await toggle.click()
  await expect(question).toBeHidden()
  await page.reload()
  await toggle.click()
  await expect(question).toHaveValue('What evidence supports this transfer?')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('#agent-messages')).toContainText('Sources')
  await page.reload()
  await toggle.click()
  await expect(question).toHaveValue('')
})
