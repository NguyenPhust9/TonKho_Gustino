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

test('dumpling button switches portions to pieces and back in cards and matrix', async () => {
  const catalogs = JSON.parse(await readFile(new URL('../data/inventory-catalogs.json', import.meta.url), 'utf8'))
  const item = catalogs.branches.find(({ branch }) => branch.code === 'B002').items.find((item) => item.Code === 'SCCC')
  const source = [{ InventoryItemId: item.Id, InventoryItemCode: item.Code, InventoryItemName: item.Name, BranchCode: 'A', BranchName: '15H', UnitName: item.UnitName, EndingStock: 2.5, MinimumStock: 3 }]
  const harness = dashboard(attachCatalogDescriptions(source, [item]))
  await harness.start()
  const { context, elements, csv } = harness
  assert.ok(elements.get('cardsView').innerHTML.includes('Đổi sang Cái'))
  assert.ok(elements.get('cardsView').innerHTML.includes('1 Phần = 8 Cái'))
  const clickUnit = (container, unit) => elements.get(container).dispatch('click', { target: { closest: () => ({ dataset: { itemUnit: 'SCCC', unitTarget: unit } }) } })
  clickUnit('cardsView', 'Cái')
  assert.ok(elements.get('cardsView').innerHTML.includes('Tổng: 20'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>24<'))
  assert.ok(elements.get('cardsView').innerHTML.includes('Đổi sang Phần'))
  vm.runInContext("currentView = 'table'; render(); exportCsv()", context)
  assert.ok((await csv()).includes('"Cái",20,0,20'))
  clickUnit('matrixBody', 'Phần')
  assert.ok(elements.get('matrixBody').innerHTML.includes('>2,5<'))
  assert.ok(elements.get('matrixBody').innerHTML.includes('Đổi sang Cái'))
  assert.equal(harness.requests(), 1)
})

test('unconvertible units stay on one card with separate totals per unit', () => {
  const rows = [
    { InventoryItemCode: 'BO', InventoryItemName: 'Bơ', BranchCode: 'A', BranchName: '15H', UnitName: 'Hũ', EndingStock: 2, MinimumStock: null },
    { InventoryItemCode: 'BO', InventoryItemName: 'Bơ', BranchCode: 'B', BranchName: 'Bếp', UnitName: 'Bịch', EndingStock: 5, MinimumStock: null }
  ]
  const { context, elements } = dashboard(rows)
  assert.equal(vm.runInContext('rawGroups.length', context), 1)
  vm.runInContext('render()', context)
  const cards = elements.get('cardsView').innerHTML
  assert.ok(cards.includes('Tổng: 2 Hũ + 5 Bịch'))
  assert.ok(cards.includes('Tồn (Hũ)'))
  assert.ok(cards.includes('Tồn (Bịch)'))
  assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), null)
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
  assert.ok(elements.get('cardsView').innerHTML.includes('Đổi sang Cái'))
  assert.ok(elements.get('cardsView').innerHTML.includes('data-item-unit="BABAVOMO"'))
  assert.ok(elements.get('cardsView').innerHTML.includes('<span class="item-unit">Phần</span>'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>26,6<'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>30<'))
  assert.ok(!elements.get('cardsView').innerHTML.includes('<p class="conversion-note">1 Phần = 5 Cái'))
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

test('Kim Sa dropdown uses the confirmed 12 pieces per pack, and unknown units cannot be selected', async () => {
  const options = attachCatalogDescriptions([{ InventoryItemCode: 'BBKS45G', UnitName: 'Gói' }], [])[0].AvailableUnits
  const source = [
    { InventoryItemCode: 'BBKS45G', InventoryItemName: 'Kim sa', BranchCode: 'A', UnitName: 'Gói', EndingStock: 8.8333, MinimumStock: 10, AvailableUnits: options },
    { InventoryItemCode: 'BBKS45G', InventoryItemName: 'Kim sa', BranchCode: 'B', UnitName: 'Gói', EndingStock: 9, MinimumStock: 5, AvailableUnits: options },
    { InventoryItemCode: 'OTHER', BranchCode: 'A', UnitName: 'Phần', EndingStock: 21, MinimumStock: null }
  ]
  const harness = dashboard(source)
  const { context, elements, csv } = harness
  await harness.start()
  assert.ok(elements.get('cardsView').innerHTML.includes('value="Túi"  disabled'))
  harness.selectUnit('BBKS45G', 'Cái')
  assert.ok(elements.get('cardsView').innerHTML.includes('1 Gói = 12 Cái'))
  assert.ok(elements.get('cardsView').innerHTML.includes('>106<'))
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='BBKS45G').branches[0].qty", context), 8.8333 * 12)
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='BBKS45G').branches[0].minimumStock", context), 120)
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='OTHER').unit", context), 'Phần')
  elements.get('exportCsv').click()
  assert.ok((await csv()).includes(`"Cái",${8.8333 * 12},108,`))
  harness.selectUnit('BBKS45G', 'Túi')
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='BBKS45G').unit", context), 'Cái')
  for (let i = 0; i < 3; i++) {
    harness.selectUnit('BBKS45G', 'Gói')
    assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='BBKS45G').branches[0].qty", context), 8.8333)
    harness.selectUnit('BBKS45G', 'Cái')
  }
  assert.equal(harness.requests(), 1)
  await context.load()
  assert.equal(vm.runInContext("rawGroups.find(g=>g.code==='BBKS45G').unit", context), 'Cái')
})

test('mixed base units keep all branches together and only accept valid common units', () => {
  const rows = [
    { InventoryItemCode: 'CAKE', BranchCode: 'A', UnitName: 'mẻ', EndingStock: 2, AvailableUnits: [{ unit: 'Cái', factor: 152, available: true }] },
    { InventoryItemCode: 'CAKE', BranchCode: 'B', UnitName: 'Cái', EndingStock: 3 }
  ]
  const { context } = dashboard(rows)
  assert.equal(vm.runInContext('rawGroups.length', context), 1)
  assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), null)
  vm.runInContext("setItemUnit('CAKE', 'Cái')", context)
  assert.equal(vm.runInContext('rawGroups.length', context), 1)
  assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), 307)
  vm.runInContext("setItemUnit('CAKE', 'mẻ')", context)
  assert.equal(vm.runInContext('rawGroups.length', context), 1)
  vm.runInContext("setItemUnit('CAKE', '__original__')", context)
  assert.equal(vm.runInContext('rawGroups.length', context), 1)
  assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), null)
})

test('original units keep the central kitchen visible alongside all six shops', async () => {
  const shops = [40, 208, 5, 117, 95, 46].map((qty, i) => ({ InventoryItemCode: 'BANHDX', InventoryItemName: 'BÁNH ĐẬU XANH', BranchCode: `S${i}`, BranchName: `Shop ${i}`, UnitName: 'Cái', EndingStock: qty, MinimumStock: 50 }))
  const source = [...shops, { InventoryItemCode: 'BANHDX', InventoryItemName: 'BÁNH ĐẬU XANH', BranchCode: 'K', BranchName: 'BẾP TRUNG TÂM', UnitName: 'mẻ', EndingStock: 8, MinimumStock: 2, AvailableUnits: [{ unit: 'Cái', factor: 152, available: true }] }]
  const { context, elements, csv } = dashboard(source)
  context.branches = source.map((row) => ({ code: row.BranchCode, name: row.BranchName }))
  vm.runInContext('rawBranches = branches; selectedBranchCodes = new Set(branches.map(b => b.code)); render()', context)
  const cards = elements.get('cardsView').innerHTML
  assert.equal((cards.match(/<article /g) || []).length, 1)
  assert.ok(cards.includes('BẾP TRUNG TÂM'))
  assert.ok(cards.includes('Tồn (mẻ)'))
  assert.ok(cards.includes('Tổng: 511 Cái + 8 mẻ'))
  assert.equal(vm.runInContext('getSelectedGroups()[0].branches.length', context), 7)
  for (let i = 0; i < 3; i++) {
    vm.runInContext("setItemUnit('BANHDX', 'Cái')", context)
    assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), 1727)
    assert.ok(elements.get('cardsView').innerHTML.includes('BẾP TRUNG TÂM'))
    vm.runInContext("setItemUnit('BANHDX', '__original__')", context)
    assert.equal(vm.runInContext('getSelectedGroups()[0].branches.length', context), 7)
    assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), null)
  }
  vm.runInContext("currentView = 'table'; render(); exportCsv()", context)
  assert.ok(elements.get('matrixBody').innerHTML.includes('>8 mẻ<'))
  assert.ok(elements.get('matrixBody').innerHTML.includes('511 Cái + 8 mẻ'))
  const exported = await csv()
  assert.ok(exported.includes('"Cái",40,208,5,117,95,46,0,511'))
  assert.ok(exported.includes('"mẻ",0,0,0,0,0,0,8,8'))
  vm.runInContext("selectedBranchCodes = new Set(['K']); render()", context)
  assert.equal(vm.runInContext('getSelectedGroups()[0].unit', context), 'mẻ')
  assert.equal(vm.runInContext('getSelectedGroups()[0].totalQty', context), 8)
})
