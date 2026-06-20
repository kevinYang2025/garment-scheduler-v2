<script setup>
// 数据源：fabric_loading_list（款式集）∩ style_color_size（颜色/尺码/原单量） + main_plan（裁剪起止时间）
// 视图对齐其他二次加工排程：同款多色码折叠成汇总行 / 展开后是 计划-实际-差异 三行 / 表头 filter
// 性能：useVirtualScroll composable（只渲染可见 ~50 行，2688 行秒出）+ shallowRef + Object.freeze + 点击编辑
// 新增/导入按钮写 schedule_master（type=cutting），与表格读 join 视图不互通——跟 secondary 系列现状一致
import { ref, shallowRef, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox, ElTag, ElButton } from 'element-plus'
import { useVirtualScroll } from '../composables/useVirtualScroll'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'
import api from '../api'

const rows = shallowRef([])
const dailyMap = shallowRef({})
const loading = ref(false)

// ============ 虚拟滚动 ============
const vs = useVirtualScroll(36, 8)

// 款号折叠
const expandedSet = ref(new Set())
function toggleCollapse(styleNo) {
  if (expandedSet.value.has(styleNo)) expandedSet.value.delete(styleNo)
  else expandedSet.value.add(styleNo)
  expandedSet.value = new Set(expandedSet.value)
}
function isCollapsed(styleNo) { return !expandedSet.value.has(styleNo) }
function groupRowCount(styleNo) { return rows.value.filter(r => r.style_no === styleNo).length }
const groupRowCount_total = computed(() => new Set(rows.value.map(r => r.style_no)).size)
// 汇总行某日的 plan = 该款所有色码该日 plan 之和
function summaryCellPlan(sumRow, date) {
  let s = 0
  for (const r of rows.value) {
    if (r.style_no !== sumRow.style_no) continue
    s += calcPlanQty(r, date)
  }
  return s
}

// Filter states
const textFilters = ref({})
const numFilters = ref({})
const dateFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

function onTextFilter(field, f) {
  textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } }
}
function onNumFilter(field, f) {
  numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } }
}
function onDateFilter(field, f) {
  dateFilters.value = { ...dateFilters.value, [field]: { validDates: f.validDates, hasEmpty: f.hasEmpty } }
}
function isFilterActive(field, type) {
  if (type === 'date') {
    const df = dateFilters.value[field]
    return df && (df.validDates?.size > 0 || df.hasEmpty)
  }
  return !!textFilters.value[field]?.applied || !!numFilters.value[field]?.applied
}
function onSort(field, sortBy, dir) {
  sortState.value = { field, sortBy, dir }
}

// Filtered & sorted rows
const filteredRows = computed(() => {
  let list = rows.value.slice()
  for (const [field, f] of Object.entries(textFilters.value)) {
    if (!f || !f.applied) continue
    list = list.filter(r => {
      const val = r[field] || ''; const hasVal = !!val
      if (hasVal && !f.checked.has(val)) return false
      if (!hasVal && !f.includeEmpty) return false
      return true
    })
  }
  for (const [field, f] of Object.entries(dateFilters.value)) {
    if (!f || ((!f.validDates || f.validDates.size === 0) && !f.hasEmpty)) continue
    list = list.filter(r => {
      const d = r[field] ? (r[field].includes('T') ? r[field].slice(0,10) : r[field]) : ''
      if (d && f.validDates && !f.validDates.has(d)) return false
      if (!d && !f.hasEmpty) return false
      return true
    })
  }
  for (const [field, f] of Object.entries(numFilters.value)) {
    if (!f || !f.applied) continue
    list = list.filter(r => {
      const v = r[field] || 0
      if (f.min != null && v < f.min) return false
      if (f.max != null && v > f.max) return false
      return true
    })
  }
  if (sortState.value.field) {
    const { field, sortBy, dir } = sortState.value
    const mul = dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      let va, vb
      if (sortBy === 'number') { va = parseInt(a[field]) || 0; vb = parseInt(b[field]) || 0; return (va - vb) * mul }
      if (sortBy === 'date') {
        va = a[field] ? (a[field].includes('T') ? a[field].slice(0,10) : a[field]) : ''
        vb = b[field] ? (b[field].includes('T') ? b[field].slice(0,10) : b[field]) : ''
        return va.localeCompare(vb) * mul
      }
      va = a[field] || ''; vb = b[field] || ''
      return va.localeCompare(vb, 'zh') * mul
    })
  }
  return list
})

// 日期范围：所有行 cutting_start/cutting_end 的并集
const dateCols = computed(() => {
  if (!rows.value.length) return []
  let min = null, max = null
  for (const r of rows.value) {
    if (r.cutting_start && (!min || r.cutting_start < min)) min = r.cutting_start
    if (r.cutting_end && (!max || r.cutting_end > max)) max = r.cutting_end
  }
  if (!min || !max) return []
  const sd = new Date(min + 'T00:00:00'), ed = new Date(max + 'T00:00:00')
  const days = Math.floor((ed - sd) / 86400000) + 1
  const cols = []
  for (let i = 0; i < days; i++) {
    const dt = new Date(sd); dt.setDate(dt.getDate() + i)
    cols.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`)
  }
  return cols
})

// [2026-06-20 S-2] 后端已返回 dateData,前端直接读取,不再重复计算
function calcPlanQty(r, date) {
  if (!r.dateData) return 0
  const dd = r.dateData.find(d => d.date === date)
  return dd ? (dd.plan || 0) : 0
}
function dailyPlan(r, date) { return calcPlanQty(r, date) }
function dailyActual(r, date) {
  const dd = dailyMap.value[r.row_id]
  const apiRow = dd ? dd.find(d => d.date === date) : null
  return apiRow ? (apiRow.actual || 0) : 0
}

// 按款号聚合 + 折叠汇总
const groupedRows = computed(() => {
  // 聚合每款
  const styleGroups = {}
  for (const r of filteredRows.value) {
    if (!styleGroups[r.style_no]) styleGroups[r.style_no] = { product_name: r.product_name, rows: [] }
    styleGroups[r.style_no].rows.push(r)
  }

  const result = []
  let lastStyle = ''
  for (const r of filteredRows.value) {
    const sn = r.style_no
    const firstOfGroup = sn !== lastStyle
    lastStyle = sn

    if (firstOfGroup && !expandedSet.value.has(sn)) {
      // 折叠：插入汇总行
      const group = styleGroups[sn]
      const totalOrder = group.rows.reduce((s, x) => s + (x.order_qty || 0), 0)
      const totalPlan = group.rows.reduce((s, x) => s + dateCols.value.reduce((ss, d) => ss + calcPlanQty(x, d), 0), 0)
      const totalActual = group.rows.reduce((s, x) => s + ((dailyMap.value[x.row_id] || []).reduce((ss, dd) => ss + (dd.actual || 0), 0)), 0)
      const totalDiff = totalActual - totalPlan
      // 裁剪日期用首个的
      const first = group.rows[0]
      result.push({
        row_id: `sum_${sn}`,
        style_no: sn, product_name: r.product_name,
        color: '', size_spec: '',
        order_qty: totalOrder,
        totalPlan, totalActual, totalDiff,
        cutting_start: first.cutting_start || '',
        cutting_end: first.cutting_end || '',
        daily_target: first.daily_target || 0,
        firstOfGroup: true, collapsed: true,
      })
      continue
    }
    if (!firstOfGroup && !expandedSet.value.has(sn)) continue
    // 展开：单色码行
    const planSum = dateCols.value.reduce((s, d) => s + calcPlanQty(r, d), 0)
    const actualSum = (dailyMap.value[r.row_id] || []).reduce((s, dd) => s + (dd.actual || 0), 0)
    result.push({
      ...r,
      totalPlan: planSum, totalActual: actualSum, totalDiff: actualSum - planSum,
      firstOfGroup,
    })
  }
  return result
})

// 每个 group row 展开为 1 行（汇总/折叠）或 3 行（计划/实际/差异/展开）
const tableRows = computed(() => {
  const out = []
  for (const r of groupedRows.value) {
    if (r.collapsed) {
      out.push({ ...r, _key: `${r.row_id}_summary`, _type: 'summary' })
    } else {
      out.push({ ...r, _key: `${r.row_id}_plan`, _type: 'plan' })
      out.push({ ...r, _key: `${r.row_id}_actual`, _type: 'actual' })
      out.push({ ...r, _key: `${r.row_id}_diff`, _type: 'diff' })
    }
  }
  return out
})

const vtStartIndex = computed(() => Math.max(0, Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows))
const vtVisibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
const vtVisibleRows = computed(() => tableRows.value.slice(vtStartIndex.value, vtStartIndex.value + vtVisibleCount.value))

function scrollToTop() {
  const el = document.querySelector('.vt-container')
  if (el) el.scrollTop = 0
}

onMounted(async () => {
  await load()
})

// Inline edit (cutting dates)
const editingId = ref(null)
const editForm = ref({})

function isEditing(r) {
  return editingId.value === r.row_id
}
function startEdit(r) {
  if (!r.main_plan_id) { ElMessage.warning('该色码没有主计划记录，无法编辑'); return }
  editingId.value = r.row_id
  editForm.value = {
    cutting_start: r.cutting_start || '',
    cutting_end: r.cutting_end || '',
  }
}
function cancelEdit() {
  editingId.value = null
  editForm.value = {}
}
async function saveEdit(r) {
  if (!r.main_plan_id) { ElMessage.error('没有 main_plan 记录，无法保存'); return }
  try {
    await api.updateMainPlanCutting(r.main_plan_id, editForm.value)
    ElMessage.success('修改成功')
    editingId.value = null
    await load()
  } catch (e) {
    console.error('saveEdit error:', e, e.response?.data)
    ElMessage.error('修改失败: ' + (e.response?.data?.error || e.message))
  }
}

// 实际行点击编辑（避免每格预渲染 input，896×28=25000 个 input 是最大渲染瓶颈）
const editingActual = ref({ rowId: null, date: null })
const editingActualVal = ref('')
function isEditingActual(r, d) {
  return editingActual.value.rowId === r.row_id && editingActual.value.date === d
}
function startEditActual(r, d) {
  if (d > today.value) return
  editingActual.value = { rowId: r.row_id, date: d }
  editingActualVal.value = String(dailyActual(r, d) || '')
}
function finishEditActual(r, d, save) {
  if (save) {
    const val = parseInt(editingActualVal.value) || 0
    updateDailyActual(r, d, val)
  }
  editingActual.value = { rowId: null, date: null }
}

function formatQty(v) { return v != null ? v.toLocaleString() : '0' }
function colorFor(v) { if (v > 0) return 'var(--success)'; if (v < 0) return 'var(--danger)'; return 'var(--text-tertiary)' }

const today = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
})

// 日期窗口：固定的"今天前 1 周 + 今天 + 后 3 周"= 共 4 周 = 28 天（与 secondary 一致）
const viewOffset = ref(0)
function shiftWeek(dir) { viewOffset.value += dir * 7 }

const visibleDateCols = computed(() => {
  const d = new Date(today.value + 'T00:00:00')
  const ws = new Date(d); ws.setDate(ws.getDate() - 7 + viewOffset.value)
  const we = new Date(d); we.setDate(we.getDate() + 21 + viewOffset.value)
  const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
  const result = []
  const cur = new Date(ws)
  while (cur <= we) {
    result.push(fmt(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return result
})

const dateRangeLabel = computed(() => {
  if (!visibleDateCols.value.length) return ''
  const first = visibleDateCols.value[0]
  const last = visibleDateCols.value[visibleDateCols.value.length - 1]
  return first.slice(5) + ' ~ ' + last.slice(5)
})

function dailyDiffVal(r, date) {
  if (date > today.value) return null
  return dailyActual(r, date) - dailyPlan(r, date)
}

function dateLabel(d) { return d ? d.slice(5) : '' }

async function load() {
  loading.value = true
  try {
    const { data } = await api.getCuttingSchedule()
    let rawRows
    let rawDaily
    if (Array.isArray(data)) {
      rawRows = data.map(r => ({
        ...r,
        row_id: r.row_id || r.id || `m${r.main_plan_id}_${r.color}_${r.size_spec}`,
        daily_target: r.daily_target || 30000,
      }))
      rawDaily = {}
    } else {
      rawRows = (data?.rows || []).map(r => ({
        ...r,
        row_id: r.row_id || `m${r.main_plan_id}_${r.color}_${r.size_spec}`,
      }))
      rawDaily = data?.daily || {}
    }
    rows.value = Object.freeze(rawRows.map(r => Object.freeze(r)))
    dailyMap.value = Object.freeze(rawDaily)
  } catch (e) {
    console.error('load cutting schedule error:', e)
    ElMessage.error('加载裁剪排程失败')
  }
  loading.value = false
}

async function updateDailyActual(r, date, val) {
  if (date > today.value) { ElMessage.warning('不能填写未来日期的实际产量'); return }
  try {
    await api.saveActual({
      schedule_type: 'cutting', style_id: 0, style_no: r.style_no,
      color: r.color, size_spec: r.size_spec, production_date: date,
      completed_qty: parseInt(val) || 0, defect_qty: 0,
      workshop: '', line_team: '', remark: ''
    })
    await load()
  } catch (e) {
    console.error('updateDailyActual error:', e)
    ElMessage.error('更新失败')
  }
}

function doExport() {
  window.open('/api/schedule/cutting/export', '_blank')
}

// ============ 新增 / 导入（写 schedule_master，type=cutting） ============
const dialogVisible = ref(false)
const createForm = ref({ style_no: '', product_name: '', color: '', size_spec: '', plan_qty: 0, plan_start: '', plan_end: '' })
function openCreate() {
  createForm.value = { style_no: '', product_name: '', color: '', size_spec: '', plan_qty: 0, plan_start: '', plan_end: '' }
  dialogVisible.value = true
}
async function doCreate() {
  const f = createForm.value
  if (!f.style_no) { ElMessage.warning('款号不能为空'); return }
  if (!f.plan_start || !f.plan_end) { ElMessage.warning('请填写裁剪上线和下线日期'); return }
  try {
    await api.createSchedule('cutting', {
      style_id: 0, style_no: f.style_no, product_name: f.product_name,
      color: f.color, size_spec: f.size_spec, plan_qty: Number(f.plan_qty) || 0,
      plan_start: f.plan_start, plan_end: f.plan_end,
    })
    ElMessage.success('创建成功')
    dialogVisible.value = false
  } catch (e) {
    ElMessage.error('创建失败: ' + (e.response?.data?.error || e.message))
  }
}

const importDialogVisible = ref(false)
const importFile = ref(null)
const importPreview = ref([])
const importMode = ref('skip')
const importing = ref(false)
function onImportFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  importFile.value = file
  parseExcel(file)
}
async function parseExcel(file) {
  importing.value = true
  try {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    importPreview.value = rows
  } catch (e) {
    ElMessage.error('解析失败: ' + e.message)
    importPreview.value = []
  }
  importing.value = false
}
async function doImport() {
  if (!importPreview.value?.length) { ElMessage.warning('没有可导入的数据'); return }
  importing.value = true
  try {
    const { data } = await api.importSchedule('cutting', importPreview.value, importMode.value)
    if (data.errors?.length) {
      ElMessage.warning(`导入完成：成功 ${data.imported}，跳过 ${data.skipped}，失败 ${data.errors.length}`)
    } else {
      ElMessage.success(`导入成功：${data.imported} 条（跳过 ${data.skipped}）`)
    }
    importDialogVisible.value = false
    importFile.value = null
    importPreview.value = []
  } catch (e) {
    ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message))
  }
  importing.value = false
}
</script>

<template>
  <div class="cutting-detail">
    <!-- 顶部操作栏 -->
    <div class="detail-header">
      <div class="header-left">
        <h3 style="margin:0">裁剪排程</h3>
        <span class="row-count">共 {{ filteredRows.length }} 行（{{ groupRowCount_total }} 款）</span>
      </div>
      <div class="header-nav">
        <span class="nav-arrows">
          <button class="nav-btn" @click="shiftWeek(-1)" title="前一周">◀</button>
          <button class="nav-btn today-btn" @click="viewOffset=0" title="回到今天">今天</button>
          <button class="nav-btn" @click="shiftWeek(1)" title="后一周">▶</button>
        </span>
        <span class="date-range-label">{{ dateRangeLabel }}</span>
      </div>
      <div class="header-actions">
        <el-button type="primary" @click="importDialogVisible = true">导入Excel</el-button>
        <el-button @click="doExport">导出Excel</el-button>
        <el-button type="success" @click="openCreate">+ 新增排程</el-button>
        <el-button type="primary" @click="load" :loading="loading">刷新</el-button>
      </div>
    </div>

    <div v-if="!rows.length && !loading" style="text-align:center;padding:60px;color:var(--text-tertiary)">
      暂无裁剪排程数据。需先在"基础数据/面料装柜清单"中录入款式，再在"计划管理/预排总计划"中设置裁剪起止时间。
    </div>

    <!-- 虚拟滚动表格 -->
    <div v-else :ref="el => vs.container.value = el" class="vt-container" @scroll.passive="vs.onScroll">
      <table class="excel-table">
        <colgroup>
          <col style="min-width:95px"><col style="min-width:120px"><col style="min-width:65px"><col style="min-width:60px">
          <col style="min-width:70px"><col style="min-width:70px">
          <col style="min-width:110px"><col style="min-width:110px">
          <col style="min-width:50px">
          <col v-for="d in visibleDateCols" :key="'c'+d" style="width:54px">
          <col style="min-width:90px">
        </colgroup>
        <thead>
          <tr>
            <th class="fix"><div class="col-header"><span>款号</span>
              <TextFilter :data="rows" field="style_no" @filter="f => onTextFilter('style_no', f)"
                :sortField="sortState.field==='style_no' ? sortState.sortBy : ''" :sortDir="sortState.field==='style_no' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('style_no')" />
            </div></th>
            <th class="fix"><div class="col-header"><span>品名</span>
              <TextFilter :data="rows" field="product_name" @filter="f => onTextFilter('product_name', f)"
                :sortField="sortState.field==='product_name' ? sortState.sortBy : ''" :sortDir="sortState.field==='product_name' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('product_name')" />
            </div></th>
            <th class="fix"><div class="col-header"><span>颜色</span>
              <TextFilter :data="rows" field="color" @filter="f => onTextFilter('color', f)"
                :sortField="sortState.field==='color' ? sortState.sortBy : ''" :sortDir="sortState.field==='color' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('color')" />
            </div></th>
            <th class="fix"><div class="col-header"><span>尺码</span>
              <TextFilter :data="rows" field="size_spec" @filter="f => onTextFilter('size_spec', f)"
                :sortField="sortState.field==='size_spec' ? sortState.sortBy : ''" :sortDir="sortState.field==='size_spec' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('size_spec')" />
            </div></th>
            <th class="fix"><div class="col-header"><span>原单量</span>
              <NumberFilter :data="rows" field="order_qty" @filter="f => onNumFilter('order_qty', f)"
                :sortField="sortState.field==='order_qty' ? sortState.sortBy : ''" :sortDir="sortState.field==='order_qty' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('order_qty')" />
            </div></th>
            <th class="fix"><div class="col-header"><span>合计</span></div></th>
            <th class="fix"><div class="col-header"><span>裁剪上线</span></div></th>
            <th class="fix"><div class="col-header"><span>裁剪下线</span></div></th>
            <th class="fix"><div class="col-header"><span>类型</span></div></th>
            <th v-for="d in visibleDateCols" :key="d" class="date-th" :class="{ 'today-col': d === today }">{{ dateLabel(d) }}</th>
            <th class="fix"><div class="col-header"><span>操作</span></div></th>
          </tr>
        </thead>
        <tbody>
          <!-- 顶部占位 -->
          <tr v-if="vtStartIndex > 0" :style="{ height: (vtStartIndex * vs.rowHeight) + 'px' }">
            <td :colspan="10 + visibleDateCols.length" style="padding:0;border:0"></td>
          </tr>
          <!-- 可见行：每个 group 渲染 1 行（汇总）或 3 行（计划/实际/差异） -->
          <template v-for="row in vtVisibleRows" :key="row._key">
            <!-- 折叠汇总行 -->
            <tr v-if="row._type === 'summary'" class="row-plan collapsed-row">
              <td class="fix first-group">
                <span class="collapse-btn" @click="toggleCollapse(row.style_no)">▶</span>
                {{ row.style_no }}
              </td>
              <td class="fix first-group">{{ row.product_name }}</td>
              <td class="fix" colspan="2" style="text-align:left;color:var(--text-tertiary);font-size:12px">共 {{ groupRowCount(row.style_no) }} 条颜色尺码</td>
              <td class="fix num">{{ formatQty(row.order_qty) }}</td>
              <td class="fix num sum-cell">{{ formatQty(row.totalPlan) }}</td>
              <td class="fix" colspan="2" style="text-align:center;color:var(--text-tertiary);font-size:12px">
                {{ row.cutting_start || '—' }} ~ {{ row.cutting_end || '—' }}
              </td>
              <td class="fix type-label plan-label">汇总</td>
              <td v-for="d in visibleDateCols" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today }">
                {{ formatQty(summaryCellPlan(row, d)) }}
              </td>
              <td class="fix"></td>
            </tr>
            <!-- 展开：计划行 -->
            <tr v-else-if="row._type === 'plan'" :class="['row-plan', { 'first-group': row.firstOfGroup, 'editing-row': isEditing(row) }]">
              <td class="fix" :class="{ 'first-group': row.firstOfGroup }">
                <span v-if="row.firstOfGroup" class="collapse-btn" @click="toggleCollapse(row.style_no)">▼</span>
                {{ row.firstOfGroup ? row.style_no : '' }}
              </td>
              <td class="fix" :class="{ 'first-group': row.firstOfGroup }">{{ row.firstOfGroup ? row.product_name : '' }}</td>
              <td class="fix">{{ row.color }}</td>
              <td class="fix">{{ row.size_spec }}</td>
              <td class="fix num">{{ formatQty(row.order_qty) }}</td>
              <td class="fix num sum-cell">{{ formatQty(row.totalPlan) }}</td>
              <td class="fix">
                <input v-if="isEditing(row)" class="inp" v-model="editForm.cutting_start" type="date" />
                <span v-else>{{ row.cutting_start || '' }}</span>
              </td>
              <td class="fix">
                <input v-if="isEditing(row)" class="inp" v-model="editForm.cutting_end" type="date" />
                <span v-else>{{ row.cutting_end || '' }}</span>
              </td>
              <td class="fix type-label plan-label">计划</td>
              <td v-for="d in visibleDateCols" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today }">
                {{ formatQty(dailyPlan(row, d)) }}
              </td>
              <td class="fix">
                <template v-if="isEditing(row)">
                  <el-button size="small" text type="primary" @click="saveEdit(row)">保存</el-button>
                  <el-button size="small" text @click="cancelEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button size="small" text type="primary" @click="startEdit(row)" :disabled="!row.main_plan_id">编辑</el-button>
                </template>
              </td>
            </tr>
            <!-- 实际行 -->
            <tr v-else-if="row._type === 'actual'" class="row-actual">
              <td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td>
              <td class="fix"></td>
              <td class="fix num sum-cell">{{ formatQty(row.totalActual) }}</td>
              <td class="fix"></td><td class="fix"></td>
              <td class="fix type-label actual-label">实际</td>
              <td v-for="d in visibleDateCols" :key="'a'+d"
                  class="cell-num editable-cell" :class="{ 'today-col': d === today, 'cell-disabled': d > today }"
                  @click="d <= today && startEditActual(row, d)">
                <input v-if="isEditingActual(row, d)" type="number" class="inp-qty"
                  v-model="editingActualVal"
                  @blur="finishEditActual(row, d, true)"
                  @keydown.enter="finishEditActual(row, d, true)"
                  @keydown.esc="finishEditActual(row, d, false)"
                  min="0" max="99999" autofocus />
                <span v-else-if="d > today" class="cell-empty">—</span>
                <span v-else>{{ formatQty(dailyActual(row, d)) }}</span>
              </td>
              <td class="fix"></td>
            </tr>
            <!-- 差异行 -->
            <tr v-else class="row-diff">
              <td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td>
              <td class="fix"></td>
              <td class="fix num sum-cell" :class="{ 'diff-pos': row.totalDiff > 0, 'diff-neg': row.totalDiff < 0 }">
                {{ row.totalDiff > 0 ? '+' : '' }}{{ formatQty(row.totalDiff) }}
              </td>
              <td class="fix"></td><td class="fix"></td>
              <td class="fix type-label diff-label">差异</td>
              <td v-for="d in visibleDateCols" :key="'f'+d" class="cell-num" :class="{ 'today-col': d === today }">
                <template v-if="d > today"><span class="cell-empty">—</span></template>
                <template v-else>
                  <span :class="{ 'diff-pos': dailyDiffVal(row, d) > 0, 'diff-neg': dailyDiffVal(row, d) < 0 }">
                    {{ dailyDiffVal(row, d) > 0 ? '+' : '' }}{{ formatQty(dailyDiffVal(row, d)) }}
                  </span>
                </template>
              </td>
              <td class="fix"></td>
            </tr>
          </template>
          <!-- 底部占位 -->
          <tr v-if="(vtStartIndex + vtVisibleRows.length) < tableRows.length" :style="{ height: ((tableRows.length - vtStartIndex - vtVisibleRows.length) * vs.rowHeight) + 'px' }">
            <td :colspan="10 + visibleDateCols.length" style="padding:0;border:0"></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 新增排程弹窗 -->
    <el-dialog v-model="dialogVisible" title="新增裁剪排程" width="560px">
      <el-form :model="createForm" label-width="90px" size="small">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="款号" required><el-input v-model="createForm.style_no" placeholder="例：NTJ62633" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="品名"><el-input v-model="createForm.product_name" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="颜色"><el-input v-model="createForm.color" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="尺码"><el-input v-model="createForm.size_spec" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="原单量"><el-input-number v-model="createForm.plan_qty" :min="0" style="width:100%" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="裁剪上线" required><el-input v-model="createForm.plan_start" type="date" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="裁剪下线" required><el-input v-model="createForm.plan_end" type="date" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 导入Excel 弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入 Excel" width="640px" destroy-on-close>
      <div style="margin-bottom:12px">
        <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
        <span v-if="importFile" style="margin-left:8px;color:var(--primary-dark)">{{ importFile.name }}</span>
      </div>
      <div v-if="importPreview?.length" style="margin-bottom:8px;font-size:12px;color:var(--text-secondary)">
        共 {{ importPreview.length }} 条
        <el-radio-group v-model="importMode" size="small" style="margin-left:12px">
          <el-radio-button value="skip">跳过重复</el-radio-button>
          <el-radio-button value="overwrite">覆盖重复</el-radio-button>
        </el-radio-group>
      </div>
      <el-table v-if="importPreview?.length" :data="importPreview.slice(0, 200)" size="small" border max-height="320">
        <el-table-column prop="款号" label="款号" width="100" />
        <el-table-column prop="品名" label="品名" width="120" />
        <el-table-column prop="颜色" label="颜色" width="80" />
        <el-table-column prop="尺码" label="尺码" width="70" />
        <el-table-column prop="原单量" label="原单量" width="80" />
        <el-table-column prop="裁剪上线" label="裁剪上线" width="100" />
        <el-table-column prop="裁剪下线" label="裁剪下线" width="100" />
      </el-table>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="doImport" :loading="importing" :disabled="!importPreview?.length">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.cutting-detail { display: flex; flex-direction: column; height: 100%; }

.detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); gap: 12px; }
.header-left { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.row-count { color: var(--text-tertiary); font-size: 13px; }
.header-nav { display: flex; align-items: center; gap: 8px; justify-content: center; flex: 1; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }

.nav-arrows { display: flex; align-items: center; gap: 4px; }
.nav-btn {
  padding: 6px 12px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: var(--transition);
  line-height: 1;
}
.nav-btn:hover { background: var(--primary-dark); }
.nav-btn.today-btn { font-size: 13px; font-weight: 600; padding: 6px 14px; }
.date-range-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  min-width: 120px;
  text-align: center;
  margin-left: 4px;
}

.excel-wrap, .vt-container {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
}

.vt-container {
  /* 自实现虚拟滚动容器 */
  position: relative;
}
.vt-row {
  height: 36px;
}
.vt-row td {
  padding: 6px 16px !important;
  vertical-align: middle;
}

.excel-table {
  border-collapse: collapse;
  font-size: 13px;
  color: var(--text);
  min-width: 100%;
  width: 100%;
}

.excel-table thead th {
  padding: 0;
  background: var(--card);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border);
  text-align: center;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 3;
}

.excel-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  white-space: nowrap;
  text-align: center;
}

.col-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  padding: 10px 14px;
  gap: 4px;
}
.col-header span {
  font-weight: 500;
  font-size: 11px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  letter-spacing: 0.3px;
}

/* 行类型：与二次加工系列对齐配色（淡紫/淡绿/淡橙） */
.row-plan { background: #f5f0ff; }
.row-actual { background: #f0fff4; }
.row-diff { background: #fffaf0; }
.row-diff td { border-bottom: 2px solid var(--border); }
.first-group td { border-top: 2px solid var(--primary); }
.collapse-btn {
  cursor: pointer; user-select: none; margin-right: 4px; font-size: 10px;
  color: var(--text-tertiary); transition: color 0.15s;
}
.collapse-btn:hover { color: var(--primary); }
.collapsed-row { background: #f8f5ff !important; opacity: 0.85; }
.collapsed-row .fix { background: #f8f5ff !important; }

tbody tr:hover td:not(.fix) { background: var(--primary-light); }
.editing-row td { background: var(--primary-light) !important; box-shadow: inset 3px 0 0 var(--primary); }
.editing-row td.fix:not(:first-child) { background: var(--primary-light) !important; }

.row-plan .fix { background: #f5f0ff; }
.row-actual .fix { background: #f0fff4; }
.row-diff .fix { background: #fffaf0; }

.fix {
  position: sticky;
  left: 0;
  z-index: 1;
  background: inherit;
}
.row-plan .fix { background: var(--card); }
.row-actual .fix { background: var(--bg); }
.row-diff .fix { background: var(--card); }

.excel-table thead .fix { z-index: 4; background: var(--card); }

.date-th { min-width: 54px; width: 54px; }
.excel-table .today-col {
  background: #e0d4ff !important;
  box-shadow: inset 3px 0 0 var(--primary);
  text-align: center !important;
}
.excel-table thead .today-col {
  background: #e0d4ff !important;
  color: var(--primary) !important;
  font-weight: 700 !important;
}

.num {
  text-align: center !important;
  font-variant-numeric: tabular-nums;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.sum-cell { font-weight: 700; }
.type-label { font-weight: 600; font-size: 12px; }
.plan-label { color: #7c3aed; }
.actual-label { color: #059669; }
.diff-label { color: #d97706; }
.diff-pos { color: #059669; font-weight: 600; }
.diff-neg { color: #dc2626; font-weight: 600; }

.cell-num {
  text-align: center !important;
  font-variant-numeric: tabular-nums;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

.cell-edit { padding: 2px; cursor: pointer; }
.cell-edit:hover { background: var(--primary-light); }
.cell-disabled { cursor: not-allowed; color: var(--text-tertiary); }
.cell-empty { color: var(--text-tertiary); opacity: 0.5; }

.inp {
  width: 100%;
  border: 1px solid var(--primary);
  text-align: left;
  font-size: 13px;
  padding: 4px 8px;
  background: var(--card);
  border-radius: var(--radius-sm);
  font-family: inherit;
}
.inp:focus { outline: none; box-shadow: 0 0 0 2px rgba(99,102,241,.2); }
.inp-qty {
  width: 100%;
  border: 1px solid var(--primary);
  text-align: center;
  font-size: 13px;
  padding: 3px 4px;
  background: var(--card);
  border-radius: var(--radius-sm);
  font-family: inherit;
}
.inp-qty:focus { outline: none; box-shadow: 0 0 0 2px rgba(99,102,241,.2); }

.inp-qty {
  width: 56px;
  border: 1px solid var(--primary);
  text-align: right;
  font-size: 12px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  padding: 2px 4px;
  background: var(--card);
  border-radius: 2px;
}
.inp-qty:focus { outline: none; box-shadow: 0 0 0 2px rgba(99,102,241,.2); }
.inp-qty:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
  opacity: 0.4;
}
.scroll-top-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
  box-shadow: var(--shadow-md);
  z-index: 100;
  transition: var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
}
.scroll-top-btn:hover { background: var(--primary-hover); }
</style>