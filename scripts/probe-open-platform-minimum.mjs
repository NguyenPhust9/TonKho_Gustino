import { createHmac } from 'node:crypto'

process.loadEnvFile('.env.local')
const root = 'https://graphapi.cukcuk.vn'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let auth = {}
// Reference values supplied by the user, never used as API results.
const reportedMinimums = { B001: 0, B002: 0, B003: 50, B004: 50, B005: 50, B006: 2, B007: 50 }
const compare = process.argv.includes('--compare')

async function call(path, body) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(root + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    })
    let result
    try { result = await response.json() } catch { throw new Error(`Non-JSON response at ${path} (HTTP ${response.status})`) }
    if (Number(result.ErrorType) === 102 && attempt < 3) { await delay(1000); continue }
    if (!response.ok || result.Success === false) throw new Error(`Request failed at ${path} (HTTP ${response.status}, ErrorType ${result.ErrorType ?? '-'})`)
    return result
  }
}

function minimumFields(value, prefix = '', results = []) {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (/minimum|(?:min|safety|reorder).*(?:stock|qty|quantity)|stock.*min/i.test(key)) results.push({ path, value: child })
      if (child && typeof child === 'object') minimumFields(child, path, results)
    }
  }
  return results
}

async function main() {
  for (const key of ['CUKCUK_APP_ID', 'CUKCUK_DOMAIN', 'CUKCUK_SECRET_KEY']) if (!process.env[key]) throw new Error(`Missing ${key}`)
  const loginData = { AppID: process.env.CUKCUK_APP_ID, Domain: process.env.CUKCUK_DOMAIN, LoginTime: new Date().toISOString() }
  const SignatureInfo = createHmac('sha256', process.env.CUKCUK_SECRET_KEY).update(JSON.stringify(loginData), 'utf8').digest('hex')
  const login = await call('/api/Account/Login', { ...loginData, SignatureInfo })
  auth = { Authorization: `Bearer ${login.Data.AccessToken}`, CompanyCode: login.Data.CompanyCode }
  console.log('Open Platform login: successful. No web-session credentials used.')
  await delay(400)
  const { Data: branches } = await call('/api/v1/branchs/all?includeInactive=false')
  const results = []
  const selectedBranches = process.argv.includes('--stock-detail-only') ? branches.filter((branch) => branch.Code === 'B004') : branches
  for (const branch of selectedBranches) {
    await delay(400)
    const list = await call('/api/v1/inventoryitems/paging', { BranchId: branch.Id, KeySearch: 'BANHDD', IncludeInactive: true, Page: 1, Limit: 100 })
    const item = list.Data?.find((row) => row.Code?.trim() === 'BANHDD')
    const result = { branchCode: branch.Code, branchName: branch.Name, listTotal: list.Total, itemId: item?.Id ?? null, listMinimum: minimumFields(list.Data), actualMinimum: typeof item?.MinimumStock === 'number' ? item.MinimumStock : null }
    if (item?.Id) {
      await delay(400)
      try {
        const detail = await call(`/api/v1/inventoryitems/detail/${encodeURIComponent(item.Id)}`)
        result.detailMinimum = minimumFields(detail.Data)
        result.detailKeys = Object.keys(detail.Data || {})
        if (typeof detail.Data?.MinimumStock === 'number') result.actualMinimum = detail.Data.MinimumStock
      } catch (error) { result.detailError = error.message }
      if (branch.Code === 'B004' && !compare) {
        await delay(400)
        const stock = await call('/api/v1/stock/summary/paging', { BranchId: branch.Id, FromDate: '2026-10-01T00:00:00', ToDate: '2026-11-13T23:59:59', Page: 1, Limit: 100 })
        result.stockMinimum = minimumFields(stock.Data)
        result.stockKeys = Object.keys(stock.Data?.find((row) => row.InventoryItemCode === 'BANHDD') || {})
        await delay(400)
        try {
          const ledger = await call('/api/v1/stock/summary/detail', { BranchId: branch.Id, InventoryItemId: item.Id, FromDate: '2026-10-01T00:00:00', ToDate: '2026-11-13T00:00:00' })
          result.ledgerRows = Array.isArray(ledger.Data) ? ledger.Data.length : null
          result.ledgerMinimum = minimumFields(ledger.Data)
          result.ledgerKeys = [...new Set((Array.isArray(ledger.Data) ? ledger.Data : []).flatMap(Object.keys))]
        } catch (error) { result.ledgerError = error.message }
      }
    }
    if (!compare) console.log(JSON.stringify(result))
    results.push(result)
  }
  console.log('BRANCHES_CHECKED', results.length)
  console.log('BRANCHES_WITH_MINIMUM_FIELDS', results.filter((row) => row.listMinimum.length || row.detailMinimum?.length).length)
  if (compare) console.table(results.sort((a, b) => a.branchCode.localeCompare(b.branchCode)).map((row) => ({
    Code: row.branchCode,
    Branch: row.branchName,
    UserReported: reportedMinimums[row.branchCode],
    ApiMinimumStock: row.actualMinimum === null ? 'NOT RETURNED' : row.actualMinimum,
    Verification: row.actualMinimum === null ? 'UNVERIFIED' : row.actualMinimum === reportedMinimums[row.branchCode] ? 'MATCH' : 'DIFFERENT',
  })))
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
