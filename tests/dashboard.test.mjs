import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { attachCatalogDescriptions, convertStockUnits } from '../lib/stock-unit-conversion.mjs'

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')

function dashboard(rows) {
  const elements = new Map()
  let csvBlob
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: {} })
        return elements.get(id)
      },
      createElement() { return { click() {} } },
      body: { appendChild() {}, removeChild() {} }
    },
    Blob,
    URL: { createObjectURL(blob) { csvBlob = blob; return 'blob:test' }, revokeObjectURL() {} }
  })
  vm.runInContext(app, context)
  context.rows = rows
  vm.runInContext(`rawBranches = [{ code: 'A', name: '15H' }, { code: 'B', name: 'Bếp' }]; selectedBranchCodes = new Set(['A', 'B']); rawGroups = groupStockRows(rows)`, context)
  return { context, elements, csv: () => csvBlob.text() }
}

test('cards, matrix, branch filter and CSV use the same converted quantities and unit', async () => {
  const source = [
    { InventoryItemId: 'a', InventoryItemCode: 'BABAVOMO', InventoryItemName: 'Bánh bao', BranchCode: 'A', BranchName: '15H', UnitName: 'Phần', EndingStock: 26.6, MinimumStock: 30 },
    { InventoryItemId: 'b', InventoryItemCode: 'BABAVOMO', InventoryItemName: 'Bánh bao', BranchCode: 'B', BranchName: 'Bếp', UnitName: 'Phần', EndingStock: 21, MinimumStock: 5 }
  ]
  const items = source.map((row) => ({ Id: row.InventoryItemId, UnitName: 'Phần', Description: '5 CÁI' }))
  const { context, elements, csv } = dashboard(convertStockUnits(attachCatalogDescriptions(source, items)))
  vm.runInContext('render()', context)
  const cards = elements.get('cardsView').innerHTML
  for (const expected of ['Tổng: 238', '>133<', '>105<', '>150<', '>25<', '1 Phần = 5 Cái']) assert.ok(cards.includes(expected), expected)
  assert.equal(elements.get('countBelowMinimum').textContent, '1')
  vm.runInContext("currentView = 'table'; render()", context)
  const table = elements.get('matrixBody').innerHTML
  assert.ok(table.includes('>238<'))
  assert.ok(table.includes('Theo chi nhánh'))
  assert.ok(table.includes('color: #b45309'))
  vm.runInContext('exportCsv()', context)
  assert.ok((await csv()).includes('"Cái",133,105,238'))
  vm.runInContext("selectedBranchCodes = new Set(['A']); render(); exportCsv()", context)
  assert.ok(elements.get('matrixBody').innerHTML.includes('>133<'))
  assert.ok(elements.get('matrixBody').innerHTML.includes('>150<'))
  assert.ok(!elements.get('matrixBody').innerHTML.includes('Theo chi nhánh'))
  assert.ok((await csv()).includes('"Cái",133,133'))
})

test('unconvertible units form separate rows instead of a mixed-unit total', () => {
  const rows = [
    { InventoryItemCode: 'BO', InventoryItemName: 'Bơ', BranchCode: 'A', BranchName: '15H', UnitName: 'Hũ', EndingStock: 2, MinimumStock: null },
    { InventoryItemCode: 'BO', InventoryItemName: 'Bơ', BranchCode: 'B', BranchName: 'Bếp', UnitName: 'Bịch', EndingStock: 5, MinimumStock: null }
  ]
  const { context, elements } = dashboard(rows)
  assert.equal(vm.runInContext('rawGroups.length', context), 2)
  vm.runInContext('render()', context)
  const cards = elements.get('cardsView').innerHTML
  assert.ok(cards.includes('Tổng: 2'))
  assert.ok(cards.includes('Tổng: 5'))
  assert.ok(!cards.includes('Tổng: 7'))
})

test('escapes catalog notes before rendering in tooltip attributes', () => {
  const { context, elements } = dashboard([{ InventoryItemCode: 'SAFE', BranchCode: 'A', UnitName: 'Gói', EndingStock: 2, Description: '"><img src=x onerror=alert(1)>' }])
  vm.runInContext('render()', context)
  assert.ok(!elements.get('cardsView').innerHTML.includes('<img'))
  assert.ok(elements.get('cardsView').innerHTML.includes('&lt;img'))
})
