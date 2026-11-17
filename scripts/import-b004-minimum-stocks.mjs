import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const sourceFiles = process.argv.slice(2)
if (!sourceFiles.length) {
  throw new Error('Dùng: node scripts/import-b004-minimum-stocks.mjs <trang1.json> [trang2.json]')
}

const items = []
for (const filename of sourceFiles) {
  const page = JSON.parse(await readFile(filename, 'utf8'))
  if (!page?.success || !Array.isArray(page.data)) throw new Error(`Dữ liệu không hợp lệ: ${filename}`)
  items.push(...page.data)
}

const minimumStocks = {}
for (const item of items) {
  const code = String(item.InventoryItemCode || '').trim()
  if (!code) throw new Error('Có mặt hàng thiếu mã.')
  if (code in minimumStocks) throw new Error(`Mã hàng bị trùng: ${code}`)
  minimumStocks[code] = Number(item.MinimumStock || 0)
}

await mkdir(resolve('data'), { recursive: true })
await writeFile(
  resolve('data/15h-b001-minimum-stocks.json'),
  `${JSON.stringify({ branchCode: 'B001', branchName: '15H', itemCount: items.length, totalExpected: 138, minimumStocks }, null, 2)}\n`,
  'utf8'
)

console.log(`Đã nhập ${items.length} mức tồn tối thiểu cho 15H/B001.`)
