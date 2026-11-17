import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { attachCatalogDescriptions, convertStockUnits } from '../lib/stock-unit-conversion.mjs'

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')

function dashboard(rows) {
  const elements = new Map()
  let csvBlob
  let onReady
  let requests = 0
  const branches = [{ code: 'A', name: '15H' }, { code: 'B', name: 'Bếp' }]
  const context = vm.createContext({
    window: { addEventListener(event, callback) { if (event === 'DOMContentLoaded') onReady = callback } },
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          const classes = new Set()
          const handlers = new Map()
          elements.set(id, {
            value: '', innerHTML: '', textContent: '', style: {}, attributes: {},
            classList: {
              add(name) { classes.add(name) },
              remove(name) { classes.delete(name) },
              contains(name) { return classes.has(name) },
              toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name) }
            },
            setAttribute(name, value) { this.attributes[name] = value },
            addEventListener(event, handler) { handlers.set(event, handler) },
            click() { handlers.get('click')?.() }
          })
        }
        return elements.get(id)
      },
      querySelectorAll() { return [] },
      createElement() { return { click() {} } },
      body: { appendChild() {}, removeChild() {} }
    },
    Blob,
    URLSearchParams,
    fetch: async () => { requests++; return { ok: true, json: async () => ({ branches, rows }) } },
    URL: { createObjectURL(blob) { csvBlob = blob; return 'blob:test' }, revokeObjectURL() {} }
  })
  vm.runInContext(app, context)
  context.rows = rows
  vm.runInContext(`rawBranches = [{ code: 'A', name: '15H' }, { code: 'B', name: 'Bếp' }]; selectedBranchCodes = new Set(['A', 'B']); rawRows = rows; rawGroups = groupStockRows(rawRows)`, context)
  return {
    context, elements, csv: () => csvBlob.text(), requests: () => requests,
    async start() { onReady(); await new Promise(setImmediate) }
  }
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

test('unit buttons switch cards, matrix, minimums and CSV without fetching again or changing filters', async () => {
  const source = [
    { InventoryItemId: 'a', InventoryItemCode: 'BABAVOMO', InventoryItemName: 'Bánh bao', BranchCode: 'A', BranchName: '15H', UnitName: 'Phần', EndingStock: 26.6, MinimumStock: 30 },
    { InventoryItemId: 'b', InventoryItemCode: 'BABAVOMO', InventoryItemName: 'Bánh bao', BranchCode: 'B', BranchName: 'Bếp', UnitName: 'Phần', EndingStock: 21, MinimumStock: 5 },
    { InventoryItemId: 'c', InventoryItemCode: 'OTHER', InventoryItemName: 'Khác', BranchCode: 'A', BranchName: '15H', UnitName: 'Gói', EndingStock: 8.8333, MinimumStock: null }
  ]
  const items = source.slice(0, 2).map((row) => ({ Id: row.InventoryItemId, UnitName: 'Phần', Description: '5 CÁI' }))
  const harness = dashboard(convertStockUnits(attachCatalogDescriptions(source, items)))
  const { context, elements, csv } = harness
  await harness.start()
  assert.equal(harness.requests(), 1)
  assert.equal(elements.get('unitConvertedBtn').attributes['aria-pressed'], 'true')
  assert.ok(elements.get('cardsView').innerHTML.includes('Tổng: 238'))

  elements.get('unitOriginalBtn').click()
  assert.equal(elements.get('unitOriginalBtn').attributes['aria-pressed'], 'true')
  assert.equal(elements.get('unitConvertedBtn').classList.contains('active'), false)
  assert.ok(elements.get('cardsView').innerHTML.includes('Tổng: 47,6'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>26,6<'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>30<'))
  assert.ok(!elements.get('cardsView').innerHTML.includes('1 Phần = 5 Cái'))
  elements.get('exportCsv').click()
  assert.ok((await csv()).includes('"Phần",26.6,21,47.6'))

  elements.get('search').value = 'BABAVOMO'
  vm.runInContext("selectedBranchCodes = new Set(['A']); currentView = 'table'; currentTab = 'belowMinimum'; render()", context)
  for (let i = 0; i < 3; i++) {
    elements.get('unitConvertedBtn').click()
    assert.ok(elements.get('matrixBody').innerHTML.includes('>133<'))
    assert.ok(elements.get('matrixBody').innerHTML.includes('>150<'))
    elements.get('exportCsv').click()
    assert.ok((await csv()).includes('"Cái",133,133'))
    elements.get('unitOriginalBtn').click()
    assert.ok(elements.get('matrixBody').innerHTML.includes('>26,6<'))
    assert.ok(elements.get('matrixBody').innerHTML.includes('>30<'))
    assert.equal(elements.get('search').value, 'BABAVOMO')
    assert.equal(vm.runInContext('currentTab', context), 'belowMinimum')
    assert.equal(vm.runInContext('currentView', context), 'table')
    assert.equal(vm.runInContext('selectedBranchCodes.size', context), 1)
  }
  assert.equal(harness.requests(), 1)
  await context.load()
  assert.ok(elements.get('matrixBody').innerHTML.includes('>26,6<'))
  assert.equal(elements.get('unitOriginalBtn').attributes['aria-pressed'], 'true')
})

test('switching units keeps unconverted quantities, negative stock, zero and unknown minimums', () => {
  const source = [-1, 0].map((qty, i) => ({ InventoryItemId: `${i}`, InventoryItemCode: 'CAKE', BranchCode: ['A', 'B'][i], UnitName: 'Phần', EndingStock: qty, MinimumStock: null }))
  source.push({ InventoryItemId: 'bag', InventoryItemCode: 'BAG', BranchCode: 'A', UnitName: 'Gói', EndingStock: 8.8333, MinimumStock: null })
  const rows = convertStockUnits(attachCatalogDescriptions(source, [{ Id: '0', UnitName: 'Phần', Description: '5 cái' }, { Id: '1', UnitName: 'Phần', Description: '5 cái' }]))
  const { context } = dashboard(rows)
  vm.runInContext("setUnitMode('original')", context)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').totalQty", context), -1)
  vm.runInContext("setUnitMode('converted')", context)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').totalQty", context), -5)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'BAG').totalQty", context), 8.8333)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').branches[1].qty", context), 0)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').branches[0].minimumStock", context), null)
})
