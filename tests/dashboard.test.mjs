import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { attachCatalogDescriptions, convertStockUnits } from '../lib/stock-unit-conversion.mjs'

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')

function dashboard(rows, selectedUnits = {}) {
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
            dispatch(event, payload) { handlers.get(event)?.(payload) },
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
  context.initialUnits = Object.entries(selectedUnits)
  vm.runInContext('for (const [key, unit] of initialUnits) selectedItemUnits.set(key, unit)', context)
  vm.runInContext(`rawBranches = [{ code: 'A', name: '15H' }, { code: 'B', name: 'Bếp' }]; selectedBranchCodes = new Set(['A', 'B']); rawRows = rows; rawGroups = groupStockRows(rawRows)`, context)
  return {
    context, elements, csv: () => csvBlob.text(), requests: () => requests,
    async start() { onReady(); await new Promise(setImmediate) },
    selectUnit(key, unit, container = 'cardsView') {
      const target = { dataset: { itemUnit: key }, value: unit, closest() { return this } }
      elements.get(container).dispatch('change', { target })
    }
  }
}

test('cards, matrix, branch filter and CSV use the same converted quantities and unit', async () => {
  const source = [
    { InventoryItemId: 'a', InventoryItemCode: 'BABAVOMO', InventoryItemName: 'Bánh bao', BranchCode: 'A', BranchName: '15H', UnitName: 'Phần', EndingStock: 26.6, MinimumStock: 30 },
    { InventoryItemId: 'b', InventoryItemCode: 'BABAVOMO', InventoryItemName: 'Bánh bao', BranchCode: 'B', BranchName: 'Bếp', UnitName: 'Phần', EndingStock: 21, MinimumStock: 5 }
  ]
  const items = source.map((row) => ({ Id: row.InventoryItemId, UnitName: 'Phần', Description: '5 CÁI' }))
  const { context, elements, csv } = dashboard(convertStockUnits(attachCatalogDescriptions(source, items)), { BABAVOMO: 'Cái' })
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

test('per-item dropdown switches only that item, including matrix, minimums and CSV', async () => {
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
  assert.ok(elements.get('cardsView').innerHTML.includes('Tổng: 47,6'))
  assert.ok(elements.get('cardsView').innerHTML.includes('Đổi ĐVT'))
  assert.ok(elements.get('cardsView').innerHTML.includes('data-item-unit="BABAVOMO"'))
  assert.ok(elements.get('cardsView').innerHTML.includes('value="Phần" selected'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>26,6<'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>30<'))
  assert.ok(!elements.get('cardsView').innerHTML.includes('1 Phần = 5 Cái'))
  elements.get('exportCsv').click()
  assert.ok((await csv()).includes('"Phần",26.6,21,47.6'))

  elements.get('search').value = 'BABAVOMO'
  vm.runInContext("selectedBranchCodes = new Set(['A']); currentView = 'table'; currentTab = 'belowMinimum'; render()", context)
  for (let i = 0; i < 3; i++) {
    harness.selectUnit('BABAVOMO', 'Cái', 'matrixBody')
    assert.ok(elements.get('matrixBody').innerHTML.includes('>133<'))
    assert.ok(elements.get('matrixBody').innerHTML.includes('>150<'))
    elements.get('exportCsv').click()
    assert.ok((await csv()).includes('"Cái",133,133'))
    harness.selectUnit('BABAVOMO', 'Phần', 'matrixBody')
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
  assert.equal(vm.runInContext("getFilteredGroups().find(g=>g.code==='OTHER')?.unit", context), undefined)
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='OTHER').branches[0].qty", context), 8.8333)
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='OTHER').unit", context), 'Gói')
})

test('switching units keeps unconverted quantities, negative stock, zero and unknown minimums', () => {
  const source = [-1, 0].map((qty, i) => ({ InventoryItemId: `${i}`, InventoryItemCode: 'CAKE', BranchCode: ['A', 'B'][i], UnitName: 'Phần', EndingStock: qty, MinimumStock: null }))
  source.push({ InventoryItemId: 'bag', InventoryItemCode: 'BAG', BranchCode: 'A', UnitName: 'Gói', EndingStock: 8.8333, MinimumStock: null })
  const rows = convertStockUnits(attachCatalogDescriptions(source, [{ Id: '0', UnitName: 'Phần', Description: '5 cái' }, { Id: '1', UnitName: 'Phần', Description: '5 cái' }]))
  const { context } = dashboard(rows)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').totalQty", context), -1)
  vm.runInContext("setItemUnit('CAKE', 'Cái')", context)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').totalQty", context), -5)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'BAG').totalQty", context), 8.8333)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').branches[1].qty", context), 0)
  assert.equal(vm.runInContext("getSelectedGroups().find(g => g.code === 'CAKE').branches[0].minimumStock", context), null)
})

test('a package dropdown uses its supplied factor, and unknown units cannot be selected', async () => {
  // A synthetic package rule tests the UI without claiming it came from CukCuk.
  const options = [
    { unit: 'Gói', factor: 1, available: true },
    { unit: 'Cái', factor: 4, available: true },
    { unit: 'Túi', factor: null, available: false }
  ]
  const source = [
    { InventoryItemCode: 'PACKAGE', InventoryItemName: 'Kim sa', BranchCode: 'A', UnitName: 'Gói', EndingStock: 8.8333, MinimumStock: 10, AvailableUnits: options },
    { InventoryItemCode: 'PACKAGE', InventoryItemName: 'Kim sa', BranchCode: 'B', UnitName: 'Gói', EndingStock: 9, MinimumStock: 5, AvailableUnits: options },
    { InventoryItemCode: 'OTHER', BranchCode: 'A', UnitName: 'Phần', EndingStock: 21, MinimumStock: null }
  ]
  const harness = dashboard(source)
  const { context, elements, csv } = harness
  await harness.start()
  assert.ok(elements.get('cardsView').innerHTML.includes('value="Túi"  disabled'))
  harness.selectUnit('PACKAGE', 'Cái')
  assert.ok(elements.get('cardsView').innerHTML.includes('1 Gói = 4 Cái'))
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='PACKAGE').branches[0].qty", context), 35.3332)
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='PACKAGE').branches[0].minimumStock", context), 40)
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='OTHER').unit", context), 'Phần')
  elements.get('exportCsv').click()
  assert.ok((await csv()).includes('"Cái",35.3332,36,'))
  harness.selectUnit('PACKAGE', 'Túi')
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='PACKAGE').unit", context), 'Cái')
  for (let i = 0; i < 3; i++) {
    harness.selectUnit('PACKAGE', 'Gói')
    assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='PACKAGE').branches[0].qty", context), 8.8333)
    harness.selectUnit('PACKAGE', 'Cái')
  }
  assert.equal(harness.requests(), 1)
  await context.load()
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='PACKAGE').unit", context), 'Cái')
})

test('mixed base units only merge when all branches can use the chosen unit', () => {
  const rows = [
    { InventoryItemCode: 'CAKE', BranchCode: 'A', UnitName: 'mẻ', EndingStock: 2, AvailableUnits: [{ unit: 'Cái', factor: 152, available: true }] },
    { InventoryItemCode: 'CAKE', BranchCode: 'B', UnitName: 'Cái', EndingStock: 3 }
  ]
  const { context } = dashboard(rows)
  assert.equal(vm.runInContext('rawGroups.length', context), 2)
  vm.runInContext("setItemUnit('CAKE', 'Cái')", context)
  assert.equal(vm.runInContext('rawGroups.length', context), 1)
  assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), 307)
  vm.runInContext("setItemUnit('CAKE', 'mẻ')", context)
  assert.equal(vm.runInContext('rawGroups.length', context), 1)
  vm.runInContext("setItemUnit('CAKE', '__original__')", context)
  assert.equal(vm.runInContext('rawGroups.length', context), 2)
})
