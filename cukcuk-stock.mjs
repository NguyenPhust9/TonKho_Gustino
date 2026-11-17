import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import minimumStockConfig from './data/minimum-stocks-by-branch.json' with { type: 'json' }
import { attachCatalogDescriptions, convertStockUnits } from './lib/stock-unit-conversion.mjs'

for (const envFile of ['.env.local', '.env']) {
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envFile); break } catch {}
  }
}

const ROOT = 'https://graphapi.cukcuk.vn'
const minimumStocksByBranch = Object.fromEntries(Object.entries(minimumStockConfig.branches || {}).map(([code, config]) => [code, config.minimumStocks || {}]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function request(path, { token, companyCode, body } = {}) {
  for (let retry = 0; ; retry++) {
    const response = await fetch(`${ROOT}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}`, CompanyCode: companyCode }) }, ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) })
    const result = await response.json()
    if (response.ok && result.Success !== false) return result
    if (result.ErrorType === 102 && retry < 3) { await sleep(1_000); continue }
    throw new Error(`CUKCUK: ${result.ErrorMessage || response.status} (ErrorType: ${result.ErrorType ?? '-'})`)
  }
}
const required = (key) => { if (!process.env[key]) throw new Error(`Thiếu ${key}`); return process.env[key] }
async function getApiAuth() {
  const loginData = { AppID: required('CUKCUK_APP_ID'), Domain: required('CUKCUK_DOMAIN'), LoginTime: new Date().toISOString() }
  const SignatureInfo = createHmac('sha256', required('CUKCUK_SECRET_KEY')).update(JSON.stringify(loginData), 'utf8').digest('hex')
  const login = await request('/api/Account/Login', { body: { ...loginData, SignatureInfo } })
  return { token: login.Data.AccessToken, companyCode: login.Data.CompanyCode }
}

async function getApiBranches(auth) {
  const result = await request('/api/v1/branchs/all?includeInactive=false', auth)
  return result.Data
}

async function getPagedRows(path, auth, params) {
  const rows = [], limit = 100
  for (let page = 1; ; page++) {
    const result = await request(path, { ...auth, body: { ...params, Page: page, Limit: limit } })
    if (!Array.isArray(result.Data)) throw new Error('Phản hồi danh sách CukCuk không hợp lệ')
    rows.push(...result.Data)
    if (result.Data.length < limit || (Number(result.Total) > 0 && rows.length >= Number(result.Total))) break
    await sleep(400)
  }
  return rows
}

function getDates(fromDate, toDate) {
  const from = fromDate || required('CUKCUK_FROM_DATE'), to = toDate || required('CUKCUK_TO_DATE')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Ngày lọc phải có dạng YYYY-MM-DD')
  return { from, to }
}

async function getBranchStock(auth, branch, from, to) {
  return getPagedRows('/api/v1/stock/summary/paging', auth, { BranchId: branch.Id, FromDate: `${from}T00:00:00`, ToDate: `${to}T23:59:59` })
}

export async function getBranches() {
  const branches = await getApiBranches(await getApiAuth())
  return branches.map(({ Code, Name }) => ({ code: Code, name: Name }))
}

export async function getAllStockSummaries({ fromDate, toDate } = {}) {
  const { from, to } = getDates(fromDate, toDate)
  const auth = await getApiAuth()
  const branches = await getApiBranches(auth)
  const results = []
  for (const branch of branches) {
    const rows = await getBranchStock(auth, branch, from, to)
    await sleep(400)
    const items = await getPagedRows('/api/v1/inventoryitems/paging', auth, { BranchId: branch.Id, IncludeInactive: true })
    results.push({ branch: { code: branch.Code, name: branch.Name }, rows: attachCatalogDescriptions(rows, items) })
    await sleep(400)
  }
  return {
    branches: results.map(({ branch }) => branch),
    fromDate: from,
    toDate: to,
    minimumStockSource: { name: 'Theo từng chi nhánh' },
    rows: convertStockUnits(results.flatMap(({ branch, rows }) => rows.map((row) => {
      const code = String(row.InventoryItemCode || '').trim()
      const minimumStockByCode = minimumStocksByBranch[branch.code] || {}
      return {
        ...row,
        BranchCode: branch.code,
        BranchName: branch.name,
        MinimumStock: Object.hasOwn(minimumStockByCode, code) ? minimumStockByCode[code] : null
      }
    })))
  }
}

export async function getStockSummary({ branchCode, fromDate, toDate } = {}) {
  const { from, to } = getDates(fromDate, toDate)
  const auth = await getApiAuth()
  const code = branchCode || required('CUKCUK_BRANCH_CODE')
  const branches = await getApiBranches(auth)
  const branch = branches.find((row) => row.Code === code)
  if (!branch) throw new Error(`Không tìm thấy chi nhánh ${code}`)
  const rows = await getBranchStock(auth, branch, from, to)
  return { branch: { code: branch.Code, name: branch.Name }, fromDate: from, toDate: to, total: rows.length, rows }
}
if (process.argv[1]?.endsWith('cukcuk-stock.mjs')) getStockSummary().then(({ branch, total }) => console.log(`Chi nhánh: ${branch.name} — ${total} dòng`)).catch((error) => { console.error(error.message); process.exitCode = 1 })
