// Gustino - Tồn kho theo chi nhánh (CukCuk Dashboard)

const $ = (id) => document.getElementById(id)

// State
let rawBranches = []
let rawGroups = []
let currentTab = 'all'
let currentView = 'cards' // 'cards' | 'table'
let minStockSource = 'B004'

// ================= NUMBER FORMATTING =================
// Định dạng chuẩn, số tự nhiên, không dùng font nghệ thuật hay ký hiệu lạ
const qtyFormatter = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 3,
  minimumFractionDigits: 0
})

function formatQty(val) {
  if (val === null || val === undefined || val === '') return '0'
  const num = Number(val)
  if (isNaN(num)) return '0'
  const clean = Math.round(num * 1000) / 1000
  return qtyFormatter.format(clean)
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
function getFilteredGroups() {
  const query = ($('search').value || '').trim().toLowerCase()

  return rawGroups.filter((g) => {
    // 1. Lọc theo tab trạng thái
    if (currentTab === 'warning' && !(g.hasEmpty || g.hasNegative || g.hasBelowMinimum)) return false
    if (currentTab === 'negative' && !g.hasNegative) return false
    if (currentTab === 'allAvailable' && !g.allAvailable) return false

    // 2. Lọc theo từ khóa tìm kiếm
    if (query) {
      const matchCode = (g.code || '').toLowerCase().includes(query)
      const matchName = (g.name || '').toLowerCase().includes(query)
      const matchUnit = (g.unit || '').toLowerCase().includes(query)
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

function getBranchStatusLabel(qty, minimumStock = 0) {
  if (qty < 0) return `${formatQty(qty)} (Tồn âm)`
  if (qty === 0) return '0 (Hết hàng)'
  if (minimumStock > 0 && qty < minimumStock) return `${formatQty(qty)} (dưới tối thiểu ${formatQty(minimumStock)})`
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
        <p style="font-weight: 600; margin: 8px 0 4px; color: #334155;">Không tìm thấy nguyên vật liệu nào</p>
        <p style="font-size: 12.5px; color: #94a3b8; margin: 0;">Thử đổi từ khóa hoặc chọn tab lọc khác.</p>
      </div>
    `
    return
  }

  const html = list.map((g) => {
    const branchRows = g.branches.map((b) => {
      const statusClass = getBranchStatusClass(b.qty, b.minimumStock || 0)
      const statusText = getBranchStatusLabel(b.qty, b.minimumStock || 0)

      return `
        <div class="branch-row ${statusClass}">
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
            <span class="item-unit">${escapeHtml(g.unit)}</span>
          </div>
          <span class="total-pill">Tổng: ${formatQty(g.totalQty)}</span>
        </div>
        <h2 class="card-title" title="${escapeHtml(g.name)}">${escapeHtml(g.name)}</h2>
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

  if (!rawBranches.length || !list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="15" class="view-empty">
          <p style="font-weight: 600; color: #334155;">Không có dữ liệu hiển thị</p>
        </td>
      </tr>
    `
    return
  }

  // Tạo tiêu đề bảng đối chiếu
  const branchHeaders = rawBranches.map((b) => `
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
    const branchMap = new Map(g.branches.map((b) => [b.code, b.qty]))

    const branchCells = rawBranches.map((b) => {
      const qty = branchMap.has(b.code) ? branchMap.get(b.code) : 0
      let cellStyle = ''
      if (qty < 0) cellStyle = 'color: #dc2626; font-weight: 700; background: #fef2f2;'
      else if (qty === 0) cellStyle = 'color: #94a3b8;'
      else if (g.minimumStock > 0 && qty < g.minimumStock) cellStyle = 'color: #b45309; font-weight: 700; background: #fffbeb;'
      else cellStyle = 'color: #047857; font-weight: 600;'

      return `<td class="num-cell" style="${cellStyle}">${formatQty(qty)}</td>`
    }).join('')

    return `
      <tr>
        <td style="text-align: center; color: #94a3b8; font-size: 12px;">${idx + 1}</td>
        <td class="sticky-code"><span class="item-code">${escapeHtml(g.code)}</span></td>
        <td class="sticky-name" style="font-weight: 500;">${escapeHtml(g.name)}</td>
        <td style="text-align: center;"><span class="item-unit">${escapeHtml(g.unit)}</span></td>
        <td class="num-cell">${g.minimumStock === null ? '—' : formatQty(g.minimumStock)}</td>
        ${branchCells}
        <td class="num-cell cell-total">${formatQty(g.totalQty)}</td>
      </tr>
    `
  }).join('')

  tbody.innerHTML = html
}

function render() {
  const filtered = getFilteredGroups()

  $('summary').textContent = `Hiển thị ${formatQty(filtered.length)} / ${formatQty(rawGroups.length)} mặt hàng · ${rawBranches.length} chi nhánh`

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
function updateKPIs() {
  const totalItems = rawGroups.length
  const totalBranches = rawBranches.length
  const negativeCount = rawGroups.filter((g) => g.hasNegative).length
  const allAvailableCount = rawGroups.filter((g) => g.allAvailable).length
  const warningCount = rawGroups.filter((g) => g.hasEmpty || g.hasNegative || g.hasBelowMinimum).length
  const outStockCount = warningCount

  $('kpiTotalItems').textContent = formatQty(totalItems)
  $('kpiTotalBranches').textContent = formatQty(totalBranches)
  $('kpiOutStockItems').textContent = formatQty(outStockCount)
  $('kpiNegativeItems').textContent = formatQty(negativeCount)

  $('countAll').textContent = formatQty(totalItems)
  $('countWarning').textContent = formatQty(warningCount)
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

    rawBranches = Array.isArray(data.branches) ? data.branches : []
    if (data.minimumStockSource) {
      minStockSource = data.minimumStockSource.name
        ? (data.minimumStockSource.code ? `${data.minimumStockSource.name} (${data.minimumStockSource.code})` : data.minimumStockSource.name)
        : data.minimumStockSource
    }

    // Nhóm mặt hàng
    const map = new Map()
    data.rows.forEach((x) => {
      const key = String(x.InventoryItemCode || x.InventoryItemName || '').trim()
      if (!map.has(key)) {
        map.set(key, {
          code: String(x.InventoryItemCode || '').trim() || '—',
          name: x.InventoryItemName || 'Không tên',
          unit: x.UnitName || 'Chưa rõ ĐVT',
          minimumStock: x.MinimumStock === null ? null : Number(x.MinimumStock || 0),
          branches: []
        })
      }
      map.get(key).branches.push({
        name: x.BranchName,
        code: x.BranchCode,
        qty: Number(x.EndingStock || 0),
        minimumStock: x.MinimumStock === null ? null : Number(x.MinimumStock || 0)
      })
      if (x.MinimumStock !== null) map.get(key).minimumStock = Number(x.MinimumStock || 0)
    })

    // Tính toán tổng tồn và trạng thái cho từng mặt hàng
    rawGroups = [...map.values()].map((g) => {
      const totalQty = g.branches.reduce((sum, b) => sum + b.qty, 0)
      const hasNegative = g.branches.some((b) => b.qty < 0)
      const hasEmpty = g.branches.some((b) => b.qty === 0)
      const hasBelowMinimum = g.branches.some((b) => b.minimumStock > 0 && b.qty > 0 && b.qty < b.minimumStock)
      const allAvailable = g.branches.every((b) => b.qty > 0)

      return {
        ...g,
        totalQty,
        hasNegative,
        hasEmpty,
        hasBelowMinimum,
        allAvailable
      }
    })

    // Sắp xếp theo tên tiếng Việt
    rawGroups.sort((a, b) => a.name.localeCompare(b.name, 'vi'))

    pill.className = 'status-pill connected'
    $('statusText').textContent = `Đã đồng bộ ${rawBranches.length} chi nhánh`

    updateKPIs()
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
  if (!list.length || !rawBranches.length) {
    alert('Không có dữ liệu để xuất!')
    return
  }

  const branchHeaders = rawBranches.map((b) => `"${b.name} (${b.code})"`)
  const headers = ['STT', 'Mã hàng', 'Tên nguyên vật liệu', 'ĐVT', ...branchHeaders, 'Tổng tồn toàn hệ thống']

  const csvRows = [headers.join(',')]

  list.forEach((g, idx) => {
    const branchMap = new Map(g.branches.map((b) => [b.code, b.qty]))
    const branchQtys = rawBranches.map((b) => branchMap.has(b.code) ? branchMap.get(b.code) : 0)

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
  $('kpiNeedRestockBox').addEventListener('click', () => {
    $('tabWarning').click()
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
