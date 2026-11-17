import test from 'node:test'
import assert from 'node:assert/strict'
import { attachCatalogDescriptions, convertStockUnits, getAvailableUnits, parseUnitConversion } from '../lib/stock-unit-conversion.mjs'

test('reads complete quantity notes, ratios and equations with the correct direction', () => {
  for (const [base, description, target, factor] of [
    ['Phần', ' 5 CÁI ', 'Cái', 5],
    ['mẻ', '152c', 'Cái', 152],
    ['mẻ', 'mẻ 152c', 'Cái', 152],
    ['mẻ', '152 cái 1 mẻ', 'Cái', 152],
    ['Phần', '2 cái/1 phần', 'Cái', 2],
    ['Phần', '4v/phần', 'Viên', 4],
    ['Phần', '180g', 'g', 180],
    ['Túi', '39 hạt', 'Hạt', 39],
    ['Phần', '1 Phần = 5 Cái', 'Cái', 5],
    ['Phần', '5 Cái = 1 Phần', 'Cái', 5],
    ['Gói', '1 Gói = 0,5 Kg', 'Kg', 0.5],
    ['Gói', '2 Gói = 12 Cái', 'Cái', 6]
  ]) {
    const result = parseUnitConversion(base, description)
    assert.equal(result?.toUnit, target, `${base}: ${description}`)
    assert.equal(result.factor, factor)
  }
})

test('ambiguous notes, approximate recipes and invalid factors leave units unchanged', () => {
  for (const [base, text] of [
    ['Phần', '18 phần, 1 phần 15g'], ['mẻ', '31 phần, 1 phần 15g'],
    ['Kg', '1kg khoảng 5.55 phần 180g'], ['Kg', '13 hạt'],
    ['Cái', '1 cặp'], ['Phần', '5 phần'], ['Phần', '5 cái hoặc 8 cái'],
    ['Phần', '0 cái'], ['Phần', '-5 cái'], ['Phần', '5 cái/0 phần'],
    ['Phần', '5 cái/1 gói'], ['', '5 cái'], ['Phần', ''],
    ['Phần', '5 cái giá 50.000'], ['Phần', 'Infinity cái']
  ]) assert.equal(parseUnitConversion(base, text), null, `${base}: ${text}`)
})

test('matches inventory IDs rather than borrowing a same-code menu description', () => {
  const rows = [{ InventoryItemId: 'material', InventoryItemCode: 'XMTT', UnitName: 'Phần', EndingStock: 4, MinimumStock: null }]
  const items = [
    { Id: 'menu', Code: 'XMTT', UnitName: 'Phần', Description: '4 cái' },
    { Id: 'material', Code: 'XMTT', UnitName: 'Phần', Description: '' }
  ]
  const [row] = convertStockUnits(attachCatalogDescriptions(rows, items))
  assert.equal(row.DisplayUnitName, 'Phần')
  assert.equal(row.DisplayEndingStock, 4)
  assert.equal(row.DisplayMinimumStock, null)
  assert.equal(row.AppliedConversion, null)
})

test('does not apply catalog rules when the stock unit differs', () => {
  const [row] = attachCatalogDescriptions(
    [{ InventoryItemId: 'cake', UnitName: 'Cái' }],
    [{ Id: 'cake', UnitName: 'mẻ', Description: '152 cái' }]
  )
  assert.equal(row.UnitConversion, null)
})

test('converts branch stock and minimums before rounding and preserves the originals', () => {
  const rows = ['A', 'B'].map((branch, i) => ({ InventoryItemId: branch, InventoryItemCode: 'BABAVOMO', BranchCode: branch, UnitName: 'Phần', EndingStock: [26.6, 21][i], MinimumStock: 5 }))
  const items = rows.map((row) => ({ Id: row.InventoryItemId, UnitName: 'Phần', Description: '5 CÁI' }))
  const converted = convertStockUnits(attachCatalogDescriptions(rows, items))
  assert.deepEqual(converted.map((r) => r.DisplayEndingStock), [133, 105])
  assert.equal(converted.reduce((sum, row) => sum + row.DisplayEndingStock, 0), 238)
  assert.ok(converted.every((row) => row.DisplayMinimumStock === 25 && row.DisplayUnitName === 'Cái'))
  assert.equal(converted[0].EndingStock, 26.6)
  assert.equal(converted[0].MinimumStock, 5)
  assert.equal(converted[0].UnitName, 'Phần')
})

test('combines batches with pieces without multiplying existing pieces a second time', () => {
  const rows = [
    { InventoryItemId: 'batch', InventoryItemCode: 'BANHDD', UnitName: 'mẻ', EndingStock: 3.5987, MinimumStock: 2 },
    { InventoryItemId: 'piece', InventoryItemCode: 'BANHDD', UnitName: 'Cái', EndingStock: 30, MinimumStock: 50 }
  ]
  const items = [{ Id: 'batch', UnitName: 'mẻ', Description: '152c' }, { Id: 'piece', UnitName: 'Cái', Description: '' }]
  const converted = convertStockUnits(attachCatalogDescriptions(rows, items))
  assert.equal(converted[0].DisplayEndingStock, 3.5987 * 152)
  assert.equal(converted[0].DisplayMinimumStock, 304)
  assert.equal(converted[1].DisplayEndingStock, 30)
  assert.ok(converted.every((row) => row.DisplayUnitName === 'Cái'))
})

test('uses each branch own factor and keeps zero, negative and unknown minimums', () => {
  const rows = [
    { InventoryItemId: 'a', InventoryItemCode: 'CAKE', UnitName: 'Gói', EndingStock: -0.8333, MinimumStock: null },
    { InventoryItemId: 'b', InventoryItemCode: 'CAKE', UnitName: 'Gói', EndingStock: 0, MinimumStock: 2 }
  ]
  const items = [{ Id: 'a', UnitName: 'Gói', Description: '6 cái' }, { Id: 'b', UnitName: 'Gói', Description: '10 cái' }]
  const [a, b] = convertStockUnits(attachCatalogDescriptions(rows, items))
  assert.equal(a.DisplayEndingStock, -0.8333 * 6)
  assert.equal(a.DisplayMinimumStock, null)
  assert.equal(b.DisplayEndingStock, 0)
  assert.equal(b.DisplayMinimumStock, 20)
})

test('normalizes compatible measurements but does not infer a missing package rule', () => {
  const [kg, gram, bag] = convertStockUnits([
    { InventoryItemCode: 'HDT', UnitName: 'Kg', EndingStock: 1, MinimumStock: 2 },
    { InventoryItemCode: 'HDT', UnitName: 'Gram', EndingStock: 500, MinimumStock: null },
    { InventoryItemCode: 'HDT', UnitName: 'Túi', EndingStock: 3, MinimumStock: null }
  ])
  assert.equal(kg.DisplayUnitName, 'Kg')
  assert.equal(gram.DisplayUnitName, 'g')
  assert.equal(bag.DisplayUnitName, 'Túi')
  const unified = convertStockUnits([kg, gram])
  assert.ok(unified.every((row) => row.DisplayUnitName === 'Kg'))
  assert.equal(unified[1].DisplayEndingStock, 0.5)
})

test('unit choices include original, description-based and metric conversions', () => {
  const row = { InventoryItemCode: 'PORTION', UnitName: 'Phần', UnitConversion: parseUnitConversion('Phần', '180g') }
  const options = getAvailableUnits(row)
  assert.equal(options.find((option) => option.unit === 'Phần').factor, 1)
  assert.equal(options.find((option) => option.unit === 'g').factor, 180)
  assert.equal(options.find((option) => option.unit === 'Kg').factor, 0.18)
  assert.ok(options.every((option) => option.available))
})
