// Gustino - Tồn kho theo chi nhánh (CukCuk Dashboard)

const $ = (id) => document.getElementById(id)

// State
let rawBranches = []
let rawRows = []
let rawGroups = []
let selectedBranchCodes = null
let currentTab = 'all'
let currentView = 'cards' // 'cards' | 'table'
const selectedItemUnits = new Map()
let minStockSource = 'B004'

// ================= NUMBER FORMATTING =================
// Hiển thị tối đa 1 chữ số thập phân như báo cáo CukCuk; giữ số gốc để tính toán.
const qtyFormatter = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0
})

function formatQty(val) {
  if (val === null || val === undefined || val === '') return '0'
  const num = Number(val)
  if (isNaN(num)) return '0'
  return qtyFormatter.format(num)
}

function formatDateISO(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function setDatePreset(type) {
  const now = new Date()
  let from = new Date()
  let to = new Date()

  if (type === 'today') {
    from = now
    to = now
  } else if (type === 'week') {
    from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
    to = now
  } else if (type === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1)
    to = now
  } else if (type === 'lastMonth') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    to = new Date(now.getFullYear(), now.getMonth(), 0)
  }

  $('from').value = formatDateISO(from)
  $('to').value = formatDateISO(to)

  document.querySelectorAll('.preset-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === type)
  })
}

// ================= FILTER & DATA COMPUTATION =================
function getGroupLabels(branches) {
  const minimums = branches.map((b) => b.minimumStock)
  const uniformMinimum = minimums.length > 0 && minimums.every((value) => value !== null && value === minimums[0])
  const labels = [...new Set(branches.map((b) => b.conversionLabel).filter(Boolean))]
  return {
    minimumLabel: uniformMinimum ? formatQty(minimums[0]) : minimums.some((value) => value !== null) ? 'Theo chi nhánh' : '—',
    conversionLabel: labels.length === 1 ? labels[0] : labels.length ? 'Quy đổi theo từng chi nhánh' : ''
  }
}

function itemKey(row) {
  return String(row.InventoryItemCode || row.InventoryItemName || '').trim()
}

function unitKey(value) {
  return String(value || '').trim().toLocaleLowerCase('vi')
}

function rowUnitOptions(row) {
  const original = String(row.UnitName || 'Chưa rõ ĐVT').trim()
  const options = new Map([[unitKey(original), { unit: original, factor: 1, available: true }]])
  for (const option of row.AvailableUnits || []) {
    if (option.unit && !options.has(unitKey(option.unit))) {
      options.set(unitKey(option.unit), { ...option, available: option.available !== false && Number.isFinite(option.factor) && option.factor > 0 })
    }
  }
  // Supports responses from the previous API version during deployment.
  const conversion = row.UnitConversion || row.AppliedConversion
  if (conversion && Number.isFinite(conversion.factor) && conversion.factor > 0 && !options.has(unitKey(conversion.toUnit))) {
    options.set(unitKey(conversion.toUnit), { unit: conversion.toUnit, factor: conversion.factor, available: true })
  }
  return [...options.values()]
}

function groupUnitOptions(branches) {
  const options = new Map()
  for (const branch of branches) {
    for (const option of branch.unitOptions) {
      const key = unitKey(option.unit)
      if (!options.has(key)) options.set(key, { unit: option.unit, available: false })
    }
  }
  return [...options.values()].map((option) => ({
    ...option,
    available: branches.every((branch) => branch.unitOptions.some((candidate) => unitKey(candidate.unit) === unitKey(option.unit) && candidate.available))
  }))
}

function groupStockRows(rows) {
  const map = new Map()
  rows.forEach((x) => {
    const code = String(x.InventoryItemCode || '').trim()
    const keyCode = itemKey(x)
    const options = rowUnitOptions(x)
    const selectedUnit = selectedItemUnits.get(keyCode)
    const choice = options.find((option) => option.available && unitKey(option.unit) === unitKey(selectedUnit)) || options[0]
    const unit = choice.unit
    const factor = choice.factor
    // Separate units that cannot be converted, so totals never add bags to jars, etc.
    const key = JSON.stringify([code || x.InventoryItemName || '', unit.toLocaleLowerCase('vi')])
    if (!map.has(key)) map.set(key, { code: code || '—', itemKey: keyCode, name: x.InventoryItemName || 'Không tên', unit, branches: [] })
    const minimum = x.MinimumStock
    map.get(key).branches.push({
      name: x.BranchName,
      code: x.BranchCode,
      qty: Number(x.EndingStock || 0) * factor,
      minimumStock: minimum == null ? null : Number(minimum) * factor,
      baseQty: Number(x.EndingStock || 0),
      baseUnit: String(x.UnitName || '').trim(),
      description: x.Description || '',
      unitOptions: options,
      conversionLabel: unitKey(unit) !== unitKey(x.UnitName) || factor !== 1
        ? `1 ${String(x.UnitName).trim()} = ${new Intl.NumberFormat('vi-VN', { maximumSignificantDigits: 12 }).format(factor)} ${unit}` : ''
    })
  })
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
}

function setItemUnit(key, name) {
  const rows = rawRows.filter((row) => itemKey(row) === key)
  if (!rows.length) return
  if (name === '__original__') selectedItemUnits.delete(key)
  else {
    // Only offer a target that is valid for every branch of this item.
    if (!rows.every((row) => rowUnitOptions(row).some((option) => option.available && unitKey(option.unit) === unitKey(name)))) return
    selectedItemUnits.set(key, name)
  }
  rawGroups = groupStockRows(rawRows)
  render()
}

function renderUnitSelector(group) {
  const rows = rawRows.filter((row) => itemKey(row) === group.itemKey)
  const branches = rows.map((row) => ({ unitOptions: rowUnitOptions(row) }))
  const options = groupUnitOptions(branches)
  if (options.length < 2) return `<span class="item-unit">${escapeHtml(group.unit)}</span>`
  const sameOriginalUnit = new Set(rows.map((row) => unitKey(row.UnitName))).size === 1
  const selected = selectedItemUnits.get(group.itemKey)
  const available = options.filter((option) => option.available)
  if (options.length === 2 && available.length === 2 && sameOriginalUnit) {
    const target = available.find((option) => unitKey(option.unit) !== unitKey(group.unit))
    const rules = [...new Set(rows.map((row) => {
      const option = rowUnitOptions(row).find((candidate) => candidate.available && unitKey(candidate.unit) !== unitKey(row.UnitName))
      return `1 ${row.UnitName} = ${new Intl.NumberFormat('vi-VN', { maximumSignificantDigits: 12 }).format(option.factor)} ${option.unit}`
    }))]
    return `<span class="item-unit">${escapeHtml(group.unit)}</span>
      <button type="button" class="item-unit-button" data-item-unit="${escapeHtml(group.itemKey)}" data-unit-target="${escapeHtml(target.unit)}" title="${escapeHtml(rules.join(' · '))}" aria-label="Đổi ${escapeHtml(group.name)} sang ${escapeHtml(target.unit)}">⇄ Đổi sang ${escapeHtml(target.unit)}</button>`
  }
  return `
    <label class="item-unit-control">
      <span class="item-unit-label">Đổi ĐVT</span>
      <select class="item-unit-select" data-item-unit="${escapeHtml(group.itemKey)}" aria-label="Đổi đơn vị tính cho ${escapeHtml(group.name)}">
        ${sameOriginalUnit ? '' : `<option value="__original__" ${selected ? '' : 'selected'}>ĐVT gốc</option>`}
        ${options.map((option) => `<option value="${escapeHtml(option.unit)}" ${unitKey(option.unit) === unitKey(selected || (sameOriginalUnit ? group.unit : '')) ? 'selected' : ''} ${option.available ? '' : 'disabled'}>${escapeHtml(option.unit)}${option.available ? '' : ' (chưa có hệ số)'}</option>`).join('')}
      </select>
    </label>
  `
}

function branchQuantityTitle(branch) {
  return [
    `${formatQty(branch.baseQty)} ${branch.baseUnit}`,
    branch.conversionLabel,
    branch.description
  ].filter(Boolean).join(' · ')
}

function getSelectedBranches() {
  return rawBranches.filter((b) => selectedBranchCodes?.has(b.code))
}

function renderBranchOptions(previousBranches) {
  const previousCodes = new Set(previousBranches.map((b) => b.code))
  selectedBranchCodes = new Set(rawBranches
    .filter((b) => selectedBranchCodes === null || selectedBranchCodes.has(b.code) || !previousCodes.has(b.code))
    .map((b) => b.code))

  $('branchFilter').hidden = !rawBranches.length
  $('branchOptions').innerHTML = rawBranches.map((b) => `
    <label class="branch-option">
      <input type="checkbox" value="${escapeHtml(b.code)}" ${selectedBranchCodes.has(b.code) ? 'checked' : ''}>
      <span>${escapeHtml(b.name)}</span>
    </label>
  `).join('')
}

function getSelectedGroups() {
  return rawGroups.map((g) => {
    const branches = g.branches.filter((b) => selectedBranchCodes?.has(b.code))
    return {
      ...g,
      branches,
      ...getGroupLabels(branches),
      totalQty: branches.reduce((sum, b) => sum + b.qty, 0),
      hasNegative: branches.some((b) => b.qty < 0),
      hasEmpty: branches.some((b) => b.qty === 0),
      hasBelowMinimum: branches.some((b) => b.minimumStock > 0 && b.qty > 0 && b.qty < b.minimumStock),
      allAvailable: branches.length > 0 && branches.every((b) => b.qty > 0)
    }
  }).filter((g) => g.branches.length > 0)
}

function getEmptyMessage() {
  return rawBranches.length && !selectedBranchCodes?.size
    ? 'Vui lòng chọn ít nhất một chi nhánh'
    : 'Không tìm thấy nguyên vật liệu nào'
}

function getFilteredGroups(groups = getSelectedGroups()) {
  const query = ($('search').value || '').trim().toLowerCase()

  return groups.filter((g) => {
    // 1. Lọc theo tab trạng thái
    if (currentTab === 'outStock' && !g.hasEmpty) return false
    if (currentTab === 'belowMinimum' && !g.hasBelowMinimum) return false
    if (currentTab === 'negative' && !g.hasNegative) return false
    if (currentTab === 'allAvailable' && !g.allAvailable) return false

    // 2. Lọc theo từ khóa tìm kiếm
    if (query) {
      const matchCode = (g.code || '').toLowerCase().includes(query)
      const matchName = (g.name || '').toLowerCase().includes(query)
      const matchUnit = [g.unit, ...g.branches.map((b) => `${b.baseUnit} ${b.description}`)].join(' ').toLowerCase().includes(query)
      return matchCode || matchName || matchUnit
    }

    return true
  })
}

function getBranchStatusClass(qty, minimumStock = 0) {
  if (qty < 0) return 'status-negative'
  if (qty === 0) return 'status-empty'
  if (minimumStock > 0 && qty < minimumStock) return 'status-low'
  return 'status-available'
}

function getBranchStatusLabel(qty) {
  return formatQty(qty)
}

// ================= RENDER CARD VIEW =================
function renderCardsView(list) {
  const container = $('cardsView')
  if (!list.length) {
    container.innerHTML = `
      <div class="view-empty" style="grid-column: 1 / -1;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p style="font-weight: 600; margin: 8px 0 4px; color: #334155;">${getEmptyMessage()}</p>
        <p style="font-size: 12.5px; color: #94a3b8; margin: 0;">Thử đổi từ khóa hoặc chọn tab lọc khác.</p>
      </div>
    `
    return
  }

  const html = list.map((g) => {
    const visibleBranches = currentTab === 'belowMinimum'
      ? g.branches.filter((b) => b.qty > 0 && b.minimumStock > 0 && b.qty < b.minimumStock)
      : currentTab === 'outStock'
        ? g.branches.filter((b) => b.qty === 0)
        : currentTab === 'negative'
          ? g.branches.filter((b) => b.qty < 0)
          : g.branches
    const visibleTotal = visibleBranches.reduce((sum, b) => sum + b.qty, 0)
    const branchRows = visibleBranches.map((b) => {
      const statusClass = getBranchStatusClass(b.qty, b.minimumStock || 0)
      const statusText = getBranchStatusLabel(b.qty)

      return `
        <div class="branch-row ${statusClass}" title="${escapeHtml(branchQuantityTitle(b))}">
          <div class="branch-title">
            <span>${escapeHtml(b.name)}</span>
          </div>
          <div class="branch-metrics">
            <div class="branch-metric"><span>Tồn</span><strong>${statusText}</strong></div>
            <div class="branch-metric minimum"><span>Tối thiểu</span><strong>${b.minimumStock === null ? '—' : formatQty(b.minimumStock)}</strong></div>
          </div>
        </div>
      `
    }).join('')

    return `
      <article class="item-card">
        <div class="card-top">
          <div class="card-tags">
            <span class="item-code">${escapeHtml(g.code)}</span>
            ${renderUnitSelector(g)}
          </div>
          <span class="total-pill">Tổng: ${formatQty(visibleTotal)}</span>
        </div>
        <h2 class="card-title" title="${escapeHtml(g.name)}">${escapeHtml(g.name)}</h2>
        ${g.conversionLabel ? `<p class="conversion-note">${escapeHtml(g.conversionLabel)}</p>` : ''}
        <div class="branch-list">
          ${branchRows}
        </div>
      </article>
    `
  }).join('')

  container.innerHTML = html
}

// ================= RENDER MATRIX TABLE VIEW =================
function renderMatrixView(list) {
  const thead = $('matrixHead')
  const tbody = $('matrixBody')
  const branches = getSelectedBranches()

  if (!rawBranches.length || !list.length) {
    thead.innerHTML = ''
    tbody.innerHTML = `
      <tr>
        <td colspan="${branches.length + 6}" class="view-empty">
          <p style="font-weight: 600; color: #334155;">${getEmptyMessage()}</p>
        </td>
      </tr>
    `
    return
  }

  // Tạo tiêu đề bảng đối chiếu
  const branchHeaders = branches.map((b) => `
    <th class="th-num" title="${escapeHtml(b.name)}">
      ${escapeHtml(b.name)}
    </th>
  `).join('')

  thead.innerHTML = `
    <tr>
      <th class="th-center" style="width: 50px;">STT</th>
      <th class="sticky-code" style="width: 110px;">Mã hàng</th>
      <th class="sticky-name">Tên nguyên vật liệu</th>
      <th class="th-center" style="width: 80px;">ĐVT</th>
      <th class="th-num" style="width: 110px;">Tồn tối thiểu</th>
      ${branchHeaders}
      <th class="th-num" style="background: #f8fafc; font-weight: 700;">Tổng tồn</th>
    </tr>
  `

  // Tạo các dòng dữ liệu
  const html = list.map((g, idx) => {
    // Tạo map tồn theo branch code để ánh xạ nhanh
    const branchMap = new Map(g.branches.map((b) => [b.code, b]))

    const branchCells = branches.map((b) => {
      const branch = branchMap.get(b.code)
      const qty = branch?.qty ?? 0
      let cellStyle = ''
      if (qty < 0) cellStyle = 'color: #dc2626; font-weight: 700; background: #fef2f2;'
      else if (qty === 0) cellStyle = 'color: #94a3b8;'
      else if (branch?.minimumStock > 0 && qty < branch.minimumStock) cellStyle = 'color: #b45309; font-weight: 700; background: #fffbeb;'
      else cellStyle = 'color: #047857; font-weight: 600;'

      return `<td class="num-cell" title="${branch ? escapeHtml(branchQuantityTitle(branch)) : ''}" style="${cellStyle}">${formatQty(qty)}</td>`
    }).join('')

    return `
      <tr>
        <td style="text-align: center; color: #94a3b8; font-size: 12px;">${idx + 1}</td>
        <td class="sticky-code"><span class="item-code">${escapeHtml(g.code)}</span></td>
        <td class="sticky-name" style="font-weight: 500;">${escapeHtml(g.name)}</td>
        <td style="text-align: center;" title="${escapeHtml(g.conversionLabel)}">${renderUnitSelector(g)}</td>
        <td class="num-cell" title="${escapeHtml(g.branches.map((b) => `${b.name}: ${b.minimumStock === null ? '—' : formatQty(b.minimumStock)} ${g.unit}`).join(' · '))}">${g.minimumLabel}</td>
        ${branchCells}
        <td class="num-cell cell-total">${formatQty(g.totalQty)}</td>
      </tr>
    `
  }).join('')

  tbody.innerHTML = html
}

function render() {
  const groups = getSelectedGroups()
  const filtered = getFilteredGroups(groups)
  updateKPIs(groups)

  $('summary').textContent = `Hiển thị ${formatQty(filtered.length)} / ${formatQty(groups.length)} mặt hàng · ${getSelectedBranches().length} / ${rawBranches.length} chi nhánh`

  if (currentView === 'cards') {
    $('cardsView').style.display = 'grid'
    $('matrixView').style.display = 'none'
    renderCardsView(filtered)
  } else {
    $('cardsView').style.display = 'none'
    $('matrixView').style.display = 'block'
    renderMatrixView(filtered)
  }
}

// ================= STATS & KPIS =================
function updateKPIs(groups) {
  const totalItems = groups.length
  const totalBranches = rawBranches.length
  const negativeCount = groups.filter((g) => g.hasNegative).length
  const allAvailableCount = groups.filter((g) => g.allAvailable).length
  const outStockCount = groups.filter((g) => g.hasEmpty).length
  const belowMinimumCount = groups.filter((g) => g.hasBelowMinimum).length

  $('kpiTotalItems').textContent = formatQty(totalItems)
  $('kpiTotalBranches').textContent = formatQty(totalBranches)
  $('kpiOutStockItems').textContent = formatQty(outStockCount)
  $('kpiBelowMinimumItems').textContent = formatQty(belowMinimumCount)
  $('kpiNegativeItems').textContent = formatQty(negativeCount)

  $('countAll').textContent = formatQty(totalItems)
  $('countOutStock').textContent = formatQty(outStockCount)
  $('countBelowMinimum').textContent = formatQty(belowMinimumCount)
  $('countNegative').textContent = formatQty(negativeCount)
  $('countAvailable').textContent = formatQty(allAvailableCount)
}

// ================= DATA FETCHING =================
async function load() {
  const from = $('from').value
  const to = $('to').value
  const params = new URLSearchParams({ from, to })

  const pill = $('statusPill')
  const refreshBtn = $('refresh')

  pill.className = 'status-pill loading'
  $('statusText').textContent = 'Đang tải dữ liệu 7 chi nhánh...'
  refreshBtn.classList.add('loading')
  refreshBtn.disabled = true

  $('cardsView').innerHTML = `
    <div class="view-loading" style="grid-column: 1 / -1;">
      <div class="spinner-circle"></div>
      <p style="font-weight: 600; color: #334155; margin: 0 0 4px;">Đang kết nối hệ thống CukCuk...</p>
      <p style="font-size: 12.5px; color: #94a3b8; margin: 0;">Đang đối chiếu dữ liệu tồn kho toàn bộ 7 chi nhánh, vui lòng đợi giây lát.</p>
    </div>
  `

  try {
    const res = await fetch('/api/inventory/all?' + params.toString())
    const data = await res.json()

    if (!res.ok) throw new Error(data.error || 'Lỗi máy chủ')

    const previousBranches = rawBranches
    rawBranches = Array.isArray(data.branches) ? data.branches : []
    if (data.minimumStockSource) {
      minStockSource = data.minimumStockSource.name
        ? (data.minimumStockSource.code ? `${data.minimumStockSource.name} (${data.minimumStockSource.code})` : data.minimumStockSource.name)
        : data.minimumStockSource
    }

    rawRows = data.rows
    for (const [key, name] of selectedItemUnits) {
      const rows = rawRows.filter((row) => itemKey(row) === key)
      if (!rows.length || !rows.every((row) => rowUnitOptions(row).some((option) => option.available && unitKey(option.unit) === unitKey(name)))) selectedItemUnits.delete(key)
    }
    rawGroups = groupStockRows(rawRows)

    pill.className = 'status-pill connected'
    $('statusText').textContent = `Đã đồng bộ ${rawBranches.length} chi nhánh`

    renderBranchOptions(previousBranches)
    render()
  } catch (err) {
    console.error('Fetch error:', err)
    pill.className = 'status-pill error'
    $('statusText').textContent = 'Lỗi kết nối CukCuk'

    $('cardsView').innerHTML = `
      <div class="view-empty" style="grid-column: 1 / -1;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p style="font-weight: 600; color: #dc2626; margin: 8px 0 4px;">Không tải được dữ liệu tồn kho</p>
        <p style="font-size: 12.5px; color: #64748b; margin: 0;">${escapeHtml(err.message)}</p>
      </div>
    `
  } finally {
    refreshBtn.classList.remove('loading')
    refreshBtn.disabled = false
  }
}

// ================= EXPORT CSV MATRIX =================
function exportCsv() {
  const list = getFilteredGroups()
  const branches = getSelectedBranches()
  if (!list.length || !rawBranches.length) {
    alert('Không có dữ liệu để xuất!')
    return
  }

  const branchHeaders = branches.map((b) => `"${b.name.replace(/"/g, '""')} (${b.code})"`)
  const headers = ['STT', 'Mã hàng', 'Tên nguyên vật liệu', 'ĐVT', ...branchHeaders, 'Tổng tồn chi nhánh đã chọn']

  const csvRows = [headers.join(',')]

  list.forEach((g, idx) => {
    const branchMap = new Map(g.branches.map((b) => [b.code, b.qty]))
    const branchQtys = branches.map((b) => branchMap.has(b.code) ? branchMap.get(b.code) : 0)

    const row = [
      idx + 1,
      `"${g.code.replace(/"/g, '""')}"`,
      `"${g.name.replace(/"/g, '""')}"`,
      `"${g.unit.replace(/"/g, '""')}"`,
      ...branchQtys,
      g.totalQty
    ]
    csvRows.push(row.join(','))
  })

  const csvContent = '\uFEFF' + csvRows.join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const from = $('from').value || 'from'
  const to = $('to').value || 'to'
  a.href = url
  a.download = `TonKho_Gustino_LienChiNhanh_${from}_${to}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeHtml(str) {
  if (typeof str !== 'string') return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ================= EVENT LISTENERS =================
window.addEventListener('DOMContentLoaded', () => {
  setDatePreset('month')

  $('refresh').addEventListener('click', load)
  $('exportCsv').addEventListener('click', exportCsv)
  const onUnitChange = (event) => {
    const select = event.target.closest('select[data-item-unit]')
    if (select) setItemUnit(select.dataset.itemUnit, select.value)
  }
  $('cardsView').addEventListener('change', onUnitChange)
  $('matrixBody').addEventListener('change', onUnitChange)
  const onUnitClick = (event) => {
    const button = event.target.closest('button[data-unit-target]')
    if (button) setItemUnit(button.dataset.itemUnit, button.dataset.unitTarget)
  }
  $('cardsView').addEventListener('click', onUnitClick)
  $('matrixBody').addEventListener('click', onUnitClick)
  $('branchOptions').addEventListener('change', (event) => {
    const input = event.target
    if (!input.matches('input[type="checkbox"]')) return
    if (input.checked) selectedBranchCodes.add(input.value)
    else selectedBranchCodes.delete(input.value)
    render()
  })

  // Presets ngày
  document.querySelectorAll('.preset-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      setDatePreset(btn.dataset.preset)
      load()
    })
  })

  // Tìm kiếm tức thì
  const searchInput = $('search')
  const clearBtn = $('clearSearch')

  searchInput.addEventListener('input', () => {
    clearBtn.style.display = searchInput.value ? 'block' : 'none'
    render()
  })

  clearBtn.addEventListener('click', () => {
    searchInput.value = ''
    clearBtn.style.display = 'none'
    searchInput.focus()
    render()
  })

  // Tabs lọc
  document.querySelectorAll('.tab-chip').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-chip').forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')
      currentTab = tab.dataset.tab
      render()
    })
  })

  // KPI boxes click để lọc nhanh
  $('kpiItemsBox').addEventListener('click', () => {
    $('tabAll').click()
  })
  $('kpiOutStockBox').addEventListener('click', () => {
    $('tabOutStock').click()
  })
  $('kpiBelowMinimumBox').addEventListener('click', () => {
    $('tabBelowMinimum').click()
  })
  $('kpiNegativeBox').addEventListener('click', () => {
    $('tabNegative').click()
  })

  // Toggle chế độ xem Dạng Thẻ / Dạng Bảng Ma Trận
  $('viewCardBtn').addEventListener('click', () => {
    $('viewCardBtn').classList.add('active')
    $('viewTableBtn').classList.remove('active')
    currentView = 'cards'
    render()
  })

  $('viewTableBtn').addEventListener('click', () => {
    $('viewTableBtn').classList.add('active')
    $('viewCardBtn').classList.remove('active')
    currentView = 'table'
    render()
  })

  // Tải dữ liệu ban đầu
  load()
})
