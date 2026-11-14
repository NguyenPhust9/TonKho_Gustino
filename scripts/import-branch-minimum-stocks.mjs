import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [branchCode, branchName, ...sourceFiles] = process.argv.slice(2)
if (!branchCode || !branchName || !sourceFiles.length) throw new Error('Dùng: node scripts/import-branch-minimum-stocks.mjs <mã> <tên> <file...>')

const output = resolve('data/minimum-stocks-by-branch.json')
let config = { branches: {} }
try { config = JSON.parse(await readFile(output, 'utf8')) } catch {}
const items = []
for (const filename of sourceFiles) {
  const page = JSON.parse(await readFile(filename, 'utf8'))
  if (!Array.isArray(page.data)) throw new Error(`Dữ liệu không hợp lệ: ${filename}`)
  items.push(...page.data)
}
const minimumStocks = {}
for (const item of items) minimumStocks[String(item.InventoryItemCode || '').trim()] = Number(item.MinimumStock || 0)
config.branches[branchCode] = { name: branchName, itemCount: items.length, totalExpected: Number(JSON.parse(await readFile(sourceFiles[0], 'utf8')).total || items.length), minimumStocks }
await mkdir(resolve('data'), { recursive: true })
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`)
console.log(`Đã nhập ${items.length} mã cho ${branchName}/${branchCode}.`)
