import test from 'node:test'
import assert from 'node:assert/strict'
import { getAllStockSummaries } from '../cukcuk-stock.mjs'

test('loads descriptions through Open Platform only and joins catalog items by ID', async (t) => {
  const previous = Object.fromEntries(['CUKCUK_APP_ID', 'CUKCUK_DOMAIN', 'CUKCUK_SECRET_KEY'].map((key) => [key, process.env[key]]))
  Object.assign(process.env, { CUKCUK_APP_ID: 'api-test-app', CUKCUK_DOMAIN: 'api-test-domain', CUKCUK_SECRET_KEY: 'api-test-key' })
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value })
  const paths = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://graphapi.cukcuk.vn')
    paths.push(parsed.pathname)
    const body = options.body && JSON.parse(options.body)
    let Data
    if (parsed.pathname === '/api/Account/Login') {
      assert.deepEqual(Object.keys(body).sort(), ['AppID', 'Domain', 'LoginTime', 'SignatureInfo'])
      Data = { AccessToken: 'test-token', CompanyCode: 'test-company' }
    } else {
      assert.equal(options.headers.Authorization, 'Bearer test-token')
      if (parsed.pathname === '/api/v1/branchs/all') Data = [{ Id: 'branch', Code: 'B001', Name: '15H' }]
      else if (parsed.pathname === '/api/v1/stock/summary/paging') {
        assert.equal(body.FromDate, '2026-10-01T00:00:00')
        assert.equal(body.ToDate, '2026-11-16T23:59:59')
        Data = [{ InventoryItemId: 'cake', InventoryItemCode: 'BABAVOMO', UnitName: 'Phần', EndingStock: 26.6 }]
      } else if (parsed.pathname === '/api/v1/inventoryitems/paging') {
        assert.equal(body.BranchId, 'branch')
        Data = [{ Id: 'cake', Code: 'BABAVOMO', UnitName: 'Phần', Description: '5 CÁI' }]
      } else assert.fail(`Unexpected API path: ${parsed.pathname}`)
    }
    return Response.json({ Success: true, Data, Total: Array.isArray(Data) ? Data.length : 0 })
  })
  const data = await getAllStockSummaries({ fromDate: '2026-10-01', toDate: '2026-11-16' })
  assert.equal(paths.filter((path) => path === '/api/Account/Login').length, 1)
  assert.equal(data.rows[0].Description, '5 CÁI')
  assert.equal(data.rows[0].DisplayEndingStock, 133)
  assert.equal(data.rows[0].DisplayUnitName, 'Cái')
  assert.equal(data.rows[0].EndingStock, 26.6)
})
