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
  await page.getByRole('button', { name: '新建调查' }).click()
  await page.getByLabel('调查起点').fill(hash)
  await page.getByRole('button', { name: '采集并上图' }).click()
  await expect(page.locator('#status')).toContainText('1 笔转账')
  await page.getByRole('button', { name: 'Agent 对话' }).click()
  releaseToken()
  await expect(page.locator('#status')).toContainText('2 笔转账')
  await page.getByRole('button', { name: 'Agent 对话' }).click()
  await expect(page.locator('#agent-messages')).toContainText('采集到 2 笔')
  const snapshot = await page.evaluate(() => (window as any).maliciousFlow.set_view())
  expect(snapshot.revision).toBe(2)
  await page.getByRole('region', { name: 'Agent 对话' }).getByRole('button', { name: '起草', exact: true }).click()
  await expect(page.getByRole('heading', { name: '调查草稿' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('agent-investigation.png') })
  await page.reload()
  await expect(page.locator('#status')).toContainText('2 笔转账')
  await page.getByRole('button', { name: 'Agent 对话' }).click()
  await expect(page.locator('#agent-messages')).toContainText('采集到 2 笔')
  expect(errors).toEqual([])
})

test('applies Agent canvas commands and asks the user to confirm entity changes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  await page.evaluate(async () => {
    const api = (window as any).maliciousFlow
    api.edit_canvas({ action: 'rename', id: 'relay', text: '已核对中转钱包' })
    await api.set_view('relay')
    api.edit_entity({ name: '调查组 A', members: ['origin', 'relay'] })
  })
  await expect(page.getByRole('heading', { name: '已核对中转钱包', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '实体归属预览' })).toBeVisible()
  await page.getByRole('button', { name: '实体视图' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '5')
  await page.getByRole('button', { name: '确认归组' }).click()
  await expect(page.locator('#graph')).toHaveAttribute('data-nodes', '4')
})

test('queries a confirmed historical Ethereum transaction from the configured provider', async ({ page }) => {
  test.skip(!process.env.FLOW_LIVE_BLOCKSCOUT, 'Set FLOW_LIVE_BLOCKSCOUT=1 for a public-provider test')
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('button', { name: '新建调查' }).click()
  await page.getByLabel('调查起点').fill('0xfb97742ba12997a223fdbb0063a07042f6aa5431dc0767572da3428256314dbf')
  await page.getByRole('button', { name: '采集并上图' }).click()
  await expect(page.locator('#status')).toContainText('1 笔转账', { timeout: 60_000 })
  await expect(page.locator('#agent-messages')).toContainText('0.0005944537861548 ETH', { timeout: 60_000 })
})
