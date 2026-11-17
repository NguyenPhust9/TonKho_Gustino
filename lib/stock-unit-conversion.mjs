import unitConversionConfig from '../data/unit-conversions.json' with { type: 'json' }

const normalize = (value) => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')

const definitions = [
  ['Cái', ['cái', 'c']], ['Viên', ['viên', 'v']], ['Hạt', ['hạt']],
  ['Con', ['con']], ['Phần', ['phần']], ['Cặp', ['cặp']], ['Tô', ['tô']],
  ['Trứng', ['trứng']], ['mẻ', ['mẻ']], ['Gói', ['gói']], ['Túi', ['túi']],
  ['Bịch', ['bịch']], ['Bao', ['bao']], ['Hộp', ['hộp']], ['Thùng', ['thùng']],
  ['Chai', ['chai']], ['Can', ['can']], ['Bình', ['bình']], ['Hũ', ['hũ']],
  ['g', ['g', 'gr', 'gram', 'gam'], 'mass', 1],
  ['Kg', ['kg', 'kilogram', 'kilôgam'], 'mass', 1000],
  ['ml', ['ml', 'mililít'], 'volume', 1],
  ['Lít', ['l', 'lít', 'lit'], 'volume', 1000]
]
const units = new Map(definitions.flatMap(([name, aliases, dimension, scale]) => aliases.map((alias) => [alias, { name, dimension, scale }])))
const containers = new Set(['Phần', 'mẻ', 'Gói', 'Túi', 'Bịch', 'Bao', 'Hộp', 'Thùng', 'Chai', 'Can', 'Bình', 'Hũ'])
const numberPattern = '(\\d+(?:[.,]\\d+)?)'
const quantityPattern = new RegExp(`^${numberPattern}\\s*([\\p{L}]+)$`, 'u')

function unit(value) {
  const name = normalize(value)
  return units.get(name) || { name: String(value || '').trim() }
}

function quantity(text) {
  const match = normalize(text).match(quantityPattern)
  if (!match || !units.has(match[2])) return null
  const value = Number(match[1].replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? { value, unit: unit(match[2]) } : null
}

// Only complete, unambiguous notes are interpreted. Never extract numbers from prose.
export function parseUnitConversion(baseUnit, description) {
  const base = unit(baseUnit)
  const text = normalize(description)
  if (!base.name || !text) return null
  let target, factor
  const equation = text.split('=')
  if (equation.length === 2) {
    const left = quantity(equation[0]), right = quantity(equation[1])
    if (!left || !right) return null
    if (left.unit.name === base.name) { target = right.unit; factor = right.value / left.value }
    else if (right.unit.name === base.name) { target = left.unit; factor = left.value / right.value }
  } else if (equation.length === 1) {
    const ratio = text.split('/')
    if (ratio.length === 2) {
      const numerator = quantity(ratio[0])
      const denominator = quantity(ratio[1]) || quantity(`1 ${ratio[1]}`)
      if (numerator && denominator?.unit.name === base.name) { target = numerator.unit; factor = numerator.value / denominator.value }
    } else if (ratio.length === 1 && containers.has(base.name)) {
      let content = text
      const baseName = normalize(base.name)
      if (content.startsWith(`${baseName} `)) content = content.slice(baseName.length).trim()
      else {
        // e.g. "152 cái 1 mẻ"; the trailing unit must be the actual base unit.
        const suffix = ` 1 ${baseName}`
        if (content.endsWith(suffix)) content = content.slice(0, -suffix.length).trim()
      }
      const parsed = quantity(content)
      if (parsed) { target = parsed.unit; factor = parsed.value }
    }
  }
  if (!target || target.name === base.name || !Number.isFinite(factor) || factor <= 0) return null
  // Bare notes on a weight/count unit (e.g. Kg + "13 hạt") are not a conversion rule.
  return { fromUnit: base.name, toUnit: target.name, factor, source: 'description', description: String(description).trim() }
}

function measurementFactor(from, to) {
  const a = unit(from), b = unit(to)
  if (a.name && a.name === b.name) return 1
  return a.dimension && a.dimension === b.dimension ? a.scale / b.scale : null
}

function conversionTo(row, target) {
  const direct = measurementFactor(row.UnitName, target)
  if (direct !== null) return direct
  if (!row.UnitConversion) return null
  const factor = measurementFactor(row.UnitConversion.toUnit, target)
  return factor === null ? null : row.UnitConversion.factor * factor
}

export function getAvailableUnits(row, conversion = row.UnitConversion) {
  const config = unitConversionConfig.items[String(row.InventoryItemCode || '').trim().toUpperCase()] || {}
  const rules = [
    ...(config.conversions || []).map((rule) => ({ ...rule, source: 'user' })),
    ...(conversion ? [conversion] : [])
  ].filter((rule) => rule.fromUnit && rule.toUnit && Number.isFinite(rule.factor) && rule.factor > 0)
  const available = new Map()
  const queue = []
  const add = (name, factor, source) => {
    const label = unit(name).name
    const key = normalize(label)
    if (!key || available.has(key) || !Number.isFinite(factor) || factor <= 0) return
    const option = { unit: label, factor, source, available: true }
    available.set(key, option)
    queue.push(option)
  }
  add(row.UnitName, 1, 'original')
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    for (const rule of rules) {
      if (unit(rule.fromUnit).name === current.unit) add(rule.toUnit, current.factor * rule.factor, rule.source)
      if (unit(rule.toUnit).name === current.unit) add(rule.fromUnit, current.factor / rule.factor, rule.source)
    }
    for (const [name, , dimension] of definitions) {
      if (dimension && dimension === unit(current.unit).dimension) add(name, current.factor * measurementFactor(current.unit, name), 'measurement')
    }
  }
  for (const name of config.unavailableUnits || []) {
    if (!available.has(normalize(name))) available.set(normalize(name), { unit: name, factor: null, available: false })
  }
  return [...available.values()]
}

export function attachCatalogDescriptions(rows, items) {
  const byId = new Map(items.map((item) => [normalize(item.Id), item]))
  const byCode = new Map()
  for (const item of items) {
    const code = String(item.Code || '').trim()
    if (!byCode.has(code)) byCode.set(code, [])
    byCode.get(code).push(item)
  }
  return rows.map((row) => {
    // Menu items and materials can share a code and unit, but have different IDs/notes.
    const candidates = byCode.get(String(row.InventoryItemCode || '').trim()) || []
    const item = row.InventoryItemId ? byId.get(normalize(row.InventoryItemId)) : candidates.length === 1 ? candidates[0] : null
    const description = String(item?.Description || '').trim()
    const sameUnit = item && measurementFactor(item.UnitName, row.UnitName) === 1
    const conversion = sameUnit ? parseUnitConversion(row.UnitName, description) : null
    return { ...row, Description: description, UnitConversion: conversion, AvailableUnits: getAvailableUnits(row, conversion) }
  })
}

export function convertStockUnits(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = String(row.InventoryItemCode || row.InventoryItemName || '').trim()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()].flatMap((group) => {
    const targets = [...new Set([
      ...group.filter((row) => row.UnitConversion).map((row) => row.UnitConversion.toUnit),
      ...group.map((row) => unit(row.UnitName).name)
    ])]
    const commonUnit = targets.find((target) => target && group.every((row) => conversionTo(row, target) !== null))
    return group.map((row) => {
      const displayUnit = commonUnit || row.UnitConversion?.toUnit || unit(row.UnitName).name
      const factor = conversionTo(row, displayUnit) ?? 1
      const stock = Number(row.EndingStock || 0)
      const minimum = row.MinimumStock == null ? null : Number(row.MinimumStock)
      const applied = factor !== 1 || unit(row.UnitName).name !== displayUnit
      return {
        ...row,
        DisplayUnitName: displayUnit,
        DisplayEndingStock: stock * factor,
        DisplayMinimumStock: minimum === null ? null : minimum * factor,
        AppliedConversion: applied ? { fromUnit: String(row.UnitName).trim(), toUnit: displayUnit, factor, source: row.UnitConversion ? 'description' : 'measurement' } : null
      }
    })
  })
}
