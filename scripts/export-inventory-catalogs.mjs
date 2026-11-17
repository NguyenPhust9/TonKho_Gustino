import { mkdir, writeFile } from 'node:fs/promises'
import { getAllInventoryCatalogs } from '../cukcuk-stock.mjs'

const catalog = await getAllInventoryCatalogs({ onProgress: ({ branchCode, branchName, count }) => console.log(`${branchCode} | ${branchName}: ${count} items`) })
await mkdir('data', { recursive: true })
await writeFile('data/inventory-catalogs.json', `${JSON.stringify(catalog, null, 2)}\n`)
console.log(JSON.stringify({ branches: catalog.branches.length, items: catalog.branches.reduce((sum, branch) => sum + branch.items.length, 0), withDescriptions: catalog.branches.reduce((sum, branch) => sum + branch.items.filter((item) => item.Description?.trim()).length, 0), sampleFields: Object.keys(catalog.branches[0]?.items[0] || {}), sccc: catalog.branches.flatMap(({ branch, items }) => items.filter((item) => item.Code?.trim() === 'SCCC').map((item) => ({ branch: branch.code, ...item }))) }, null, 2))
