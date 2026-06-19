<script setup>
import { ref, computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import StylePicker from '../components/StylePicker.vue'
import DateFilter from '../components/DateFilter.vue'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'
import MainPlanGantt from './MainPlanGantt.vue'
import { useVirtualScroll } from '../composables/useVirtualScroll'

// 虚拟滚动（行高 40px：12+12 padding + 13px font + 1px border）
const vs = useVirtualScroll(40, 8)

const columns = [
  { field: 'style_no', label: '款号', width: 120, type: 'text' },
  { field: 'product_name', label: '品名', width: 130, type: 'text' },
  { field: 'plan_qty', label: '计划数量', width: 100, type: 'number' },
  { field: 'due_date', label: '交期', width: 110, type: 'date' },
  { field: 'arrival_date', label: '预计面料到货', width: 120, type: 'date' },
  { field: 'cutting_start', label: '裁剪上线', width: 110, type: 'date' },
  { field: 'cutting_end', label: '裁剪下线', width: 110, type: 'date' },
  { field: 'printing_start', label: '印花上线', width: 100, type: 'date' },
  { field: 'printing_end', label: '印花下线', width: 100, type: 'date' },
  { field: 'embroidery_start', label: '刺绣上线', width: 100, type: 'date' },
  { field: 'embroidery_end', label: '刺绣下线', width: 100, type: 'date' },
  { field: 'template_start', label: '模板上线', width: 100, type: 'date' },
  { field: 'template_end', label: '模板下线', width: 100, type: 'date' },
  { field: 'ironing_start', label: '烫标上线', width: 100, type: 'date' },
  { field: 'ironing_end', label: '烫标下线', width: 100, type: 'date' },
  { field: 'sewing_remind_date', label: '缝制提醒', width: 110, type: 'date' },
  { field: 'sewing_start', label: '缝制上线', width: 110, type: 'date' },
  { field: 'sewing_end', label: '缝制下线', width: 110, type: 'date' },
  { field: 'workshop', label: '车间', width: 80, type: 'text' },
  { field: 'line_team', label: '班组', width: 70, type: 'text' },
  { field: 'line_index', label: '产线', width: 70, type: 'text' },
]
// checkbox(40) + 数据列 + 操作(120)，两表共用此宽度保证对齐
const colWidths = [40, ...columns.map(c => c.width), 120]

const headerRef = ref(null)
const bodyRef = ref(null)
const plans = ref([])
const loading = ref(false)
const viewMode = ref('table') // 'table' or 'gantt'

const editingId = ref(null)
const editForm = ref({})

// Batch operations
const selectedIds = ref(new Set())
const isAllSelected = computed(() => filteredPlans.value.length > 0 && filteredPlans.value.every(r => selectedIds.value.has(r.id)))
const selectedCount = computed(() => selectedIds.value.size)

function toggleSelect(id) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedIds.value = s
}
function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(filteredPlans.value.map(r => r.id))
  }
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.size} 条预排总计划？`, '批量删除', { type: 'warning' })
    const ids = [...selectedIds.value]
    let ok = 0, fail = 0
    for (const id of ids) {
      try { await api.deleteMainPlan(id); ok++ } catch { fail++ }
    }
    selectedIds.value = new Set()
    ElMessage.success(`删除完成：${ok} 成功，${fail} 失败`)
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('批量删除失败')
  }
}

const autoScheduling = ref(false)
const conflictCount = computed(() => plans.value.filter(p => p.conflict_flag).length)
const dueWarnCount = computed(() => plans.value.filter(p => p.due_date_warning && !p.expired && !p.conflict_flag).length)
const expiredCount = computed(() => plans.value.filter(p => p.expired).length)

async function doAutoSchedule() {
  try {
    await ElMessageBox.confirm('将清空现有计划并根据装柜清单和款式数据自动排产，确定？', '自动排产', { type: 'warning' })
    autoScheduling.value = true
    const { data } = await api.autoSchedule()
    ElMessage.success(`排产完成：${data.count} 条计划` + (data.conflicts > 0 ? `，${data.conflicts} 条冲突` : ''))
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('排产失败: ' + (e.response?.data?.error || e.message))
  }
  autoScheduling.value = false
}

// Filter states
const dateFilters = ref({})
const textFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

const precomputedOptions = shallowRef({})
function computeFilterOptions() {
  const fields = ['style_no', 'product_name', 'workshop', 'line_team']
  const result = {}
  for (const f of fields) {
    const map = {}
    let emptyCount = 0
    for (const row of plans.value) {
      const val = row[f]
      if (val === undefined || val === null || val === '') { emptyCount++; continue }
      const key = String(val)
      map[key] = (map[key] || 0) + 1
    }
    result[f] = { options: Object.entries(map).map(([text, count]) => ({ text, count })), emptyCount }
  }
  precomputedOptions.value = result
}

function onDateFilter(field, f) {
  dateFilters.value = { ...dateFilters.value, [field]: f }
}
function onTextFilter(field, f) {
  textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } }
}
function onSort(field, sortBy, dir) {
  sortState.value = { field, sortBy, dir }
}

function isFilterActive(field, type) {
  if (type === 'date') {
    const f = dateFilters.value[field]
    return !!(f && (f.validDates?.size > 0 || f.hasEmpty))
  }
  return !!textFilters.value[field]?.applied
}

const dateFields = computed(() => {
  const s = new Set()
  for (const col of columns) {
    if (col.type === 'date') s.add(col.field)
  }
  return s
})

const filteredPlans = computed(() => {
  const today = fmtLocal(new Date())
  return plans.value.filter(r => {
    // Date filters
    for (const [field, f] of Object.entries(dateFilters.value)) {
      if (!f) continue
      const d = r[field] ? (r[field].includes('T') ? r[field].slice(0, 10) : r[field]) : ''
      if (d && !f.validDates.has(d)) return false
      if (!d && !f.hasEmpty) return false
    }
    // Text filters
    for (const [field, f] of Object.entries(textFilters.value)) {
      if (!f || !f.applied) continue
      const val = r[field] || ''
      const hasVal = !!val
      if (hasVal && !f.checked.has(val)) return false
      if (!hasVal && !f.includeEmpty) return false
    }
    return true
  }).sort((a, b) => {
    // 用户选择排序
    if (sortState.value.field) {
      const { field, sortBy, dir } = sortState.value
      const mul = dir === 'asc' ? 1 : -1
      let va, vb
      if (sortBy === 'count') {
        va = a[field] || ''
        vb = b[field] || ''
        return va.localeCompare(vb, 'zh') * mul
      }
      if (sortBy === 'date') {
        va = a[field] ? (a[field].includes('T') ? a[field].slice(0, 10) : a[field]) : ''
        vb = b[field] ? (b[field].includes('T') ? b[field].slice(0, 10) : b[field]) : ''
        return va.localeCompare(vb) * mul
      }
      va = a[field] || ''
      vb = b[field] || ''
      return va.localeCompare(vb, 'zh') * mul
    }
    // 默认排序：未排班组优先 → 缝制提醒到期优先 → 按上线时间
    const aUnassigned = !a.workshop || !a.line_team
    const bUnassigned = !b.workshop || !b.line_team
    if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1
    if (aUnassigned && bUnassigned) {
      const aRemind = a.sewing_remind_date || ''
      const bRemind = b.sewing_remind_date || ''
      const aRemindDue = aRemind && aRemind <= today
      const bRemindDue = bRemind && bRemind <= today
      if (aRemindDue !== bRemindDue) return aRemindDue ? -1 : 1
    }
    const aStart = a.sewing_start || '9999-99-99'
    const bStart = b.sewing_start || '9999-99-99'
    return aStart.localeCompare(bStart)
  })
})

// 虚拟滚动切片
const totalRows = computed(() => filteredPlans.value.length)
const visibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
const startIndex = computed(() => {
  const idx = Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows
  return idx < 0 ? 0 : (idx > totalRows.value ? totalRows.value : idx)
})
const visibleRows = computed(() => filteredPlans.value.slice(startIndex.value, startIndex.value + visibleCount.value))
const topPad = computed(() => startIndex.value * vs.rowHeight)
const bottomPad = computed(() => Math.max(0, (totalRows.value - startIndex.value - visibleRows.value.length) * vs.rowHeight))

// 是否在绝对索引 idx 的数据行上面插一个分组标题行
function showSection(absIdx) {
  if (absIdx <= 0 || absIdx >= totalRows.value) return false
  const cur = filteredPlans.value[absIdx]
  const prev = filteredPlans.value[absIdx - 1]
  if (!cur || !prev) return false
  const curAssigned = !!(cur.workshop && cur.line_team)
  const prevAssigned = !!(prev.workshop && prev.line_team)
  return curAssigned !== prevAssigned
}

// 未排班组数量
const unassignedCount = computed(() => plans.value.filter(r => !r.workshop || !r.line_team).length)
const assignedCount = computed(() => plans.value.filter(r => r.workshop && r.line_team).length)

// 多行分组：同一款多线时，只在第一行显示款号/品名等重复信息
function isFirstOfGroup(row) {
  return row.line_index <= 1
}

// Re-sync column widths when body rows change
watch(filteredPlans, () => { setTimeout(syncColWidths, 0) })

async function load() {
  loading.value = true
  try {
    const { data } = await api.getMainPlan()
    plans.value = data
    computeFilterOptions()
  } catch (e) {
    ElMessage.error('加载预排总计划失败')
  } finally {
    loading.value = false
  }
}

function startEdit(row) {
  editingId.value = row.id
  editForm.value = { ...row }
}
function cancelEdit() {
  editingId.value = null
  editForm.value = {}
}
async function saveEdit() {
  try {
    await api.updateMainPlan(editForm.value.id, editForm.value)
    ElMessage.success('保存成功')
    editingId.value = null
    load()
  } catch (e) {
    ElMessage.error('保存失败')
  }
}
async function remove(id) {
  try {
    await ElMessageBox.confirm('确定删除该预排总计划?', '提示', { type: 'warning' })
    await api.deleteMainPlan(id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

// New plan dialog
const dialogVisible = ref(false)
const stylePickerRef = ref(null)
const selectedStyle = ref(null)
const form = ref({})

const configCache = ref({ shippingBuffer: 5, pickingDays: 3, lineChangeDays: 0.5, sewingCapacity: 800, cuttingCapacity: 30000 })

async function loadConfig() {
  try {
    const [sysRes, capRes] = await Promise.all([api.getSystemConfig(), api.getCapacityConfig()])
    const sys = sysRes.data
    const cap = capRes.data
    configCache.value.shippingBuffer = parseInt(sys.find(c => c.config_key === 'shipping_buffer_days')?.config_value || '5')
    configCache.value.pickingDays = parseInt(sys.find(c => c.config_key === 'picking_days')?.config_value || '3')
    configCache.value.lineChangeDays = parseFloat(sys.find(c => c.config_key === 'line_change_days')?.config_value || '0.5')
    configCache.value.sewingCapacity = parseInt(cap.find(c => c.process_type === 'sewing')?.daily_capacity || '800')
    configCache.value.cuttingCapacity = parseInt(cap.find(c => c.process_type === 'cutting')?.daily_capacity || '30000')
  } catch (e) { /* use defaults */ }
}

function fmtLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function autoCalcDates() {
  if (!form.value.due_date) return
  await loadConfig()
  const c = configCache.value
  const due = new Date(form.value.due_date + 'T00:00:00')
  const qty = form.value.plan_qty || 0

  const sewingEnd = new Date(due)
  sewingEnd.setDate(sewingEnd.getDate() - c.shippingBuffer)
  const sewingDays = Math.ceil(qty / c.sewingCapacity) || 1
  const sewingStart = new Date(sewingEnd)
  sewingStart.setDate(sewingStart.getDate() - sewingDays - Math.ceil(c.lineChangeDays))
  const sewingRemind = new Date(sewingStart)
  sewingRemind.setDate(sewingRemind.getDate() - 2)

  const secondaryEnd = new Date(sewingStart)
  secondaryEnd.setDate(secondaryEnd.getDate() - 1)
  const secondaryStart = new Date(secondaryEnd)
  secondaryStart.setDate(secondaryStart.getDate() - 3)

  const cuttingEnd = new Date(secondaryStart)
  cuttingEnd.setDate(cuttingEnd.getDate() - c.pickingDays)
  const cuttingDays = Math.ceil(qty / c.cuttingCapacity) || 1
  const cuttingStart = new Date(cuttingEnd)
  cuttingStart.setDate(cuttingStart.getDate() - cuttingDays)
  form.value.cutting_start = fmtLocal(cuttingStart)
  form.value.cutting_end = fmtLocal(cuttingEnd)
  form.value.secondary_start = fmtLocal(secondaryStart)
  form.value.secondary_end = fmtLocal(secondaryEnd)
  form.value.printing_start = ''
  form.value.printing_end = ''
  form.value.embroidery_start = ''
  form.value.embroidery_end = ''
  form.value.template_start = ''
  form.value.template_end = ''
  form.value.sewing_remind_date = fmtLocal(sewingRemind)
  form.value.sewing_start = fmtLocal(sewingStart)
  form.value.sewing_end = fmtLocal(sewingEnd)
}

function openAdd() {
  selectedStyle.value = null
  form.value = {
    plan_qty: 0,
    due_date: '',
    arrival_date: '',
    pipeline_count: 1,
    workshop: '',
    line_team: '',
    line_count: 1,
    line_index: 1,
    expired: 0,
  }
  dialogVisible.value = true
}

function onStyleSelect(s) {
  selectedStyle.value = s
  form.value.plan_qty = s.plan_qty
  form.value.due_date = s.due_date
  autoCalcDates()
}

async function save() {
  if (!selectedStyle.value) {
    ElMessage.warning('请先选择款式')
    return
  }
  try {
    const payload = {
      style_id: selectedStyle.value.id,
      style_no: selectedStyle.value.style_no,
      product_name: selectedStyle.value.product_name,
      plan_qty: form.value.plan_qty,
      due_date: form.value.due_date,
      arrival_date: form.value.arrival_date || '',
      cutting_start: form.value.cutting_start,
      cutting_end: form.value.cutting_end,
      secondary_start: form.value.secondary_start,
      secondary_end: form.value.secondary_end,
      printing_start: form.value.printing_start || '',
      printing_end: form.value.printing_end || '',
      embroidery_start: form.value.embroidery_start || '',
      embroidery_end: form.value.embroidery_end || '',
      template_start: form.value.template_start || '',
      template_end: form.value.template_end || '',
      sewing_remind_date: form.value.sewing_remind_date,
      sewing_start: form.value.sewing_start,
      sewing_end: form.value.sewing_end,
      pipeline_count: form.value.pipeline_count || 1,
      is_scheduled: false,
      workshop: form.value.workshop || '',
      line_team: form.value.line_team || '',
      line_count: form.value.line_count || 1,
      line_index: form.value.line_index || 1,
      expired: form.value.expired || 0,
    }
    await api.saveMainPlan(payload)
    ElMessage.success('已添加到预排总计划')
    dialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error('保存失败')
  }
}

// Import / Export
const fileInputRef = ref(null)
async function exportExcel() {
  try {
    if (!filteredPlans.value.length) { ElMessage.warning('没有可导出的数据'); return }
    const XLSX = await import('xlsx')
    const header = columns.map(c => c.label)
    const data = filteredPlans.value.map(row => columns.map(c => {
      let v = row[c.field]
      if (v === null || v === undefined) return ''
      if (c.type === 'date' && v.includes && v.includes('T')) v = v.slice(0, 10)
      return v
    }))
    const ws = XLSX.utils.aoa_to_sheet([header, ...data])
    ws['!cols'] = columns.map(c => ({ wch: Math.max(c.label.length * 2, Math.floor(c.width / 8)) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '预排总计划')
    XLSX.writeFile(wb, '预排总计划.xlsx')
    ElMessage.success(`导出成功：${filteredPlans.value.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败')
  }
}
function triggerImport() { fileInputRef.value?.click() }
async function handleImport(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    ElMessage.info('导入中...')
    const res = await api.importMainPlan(file)
    ElMessage.success(`导入完成：${res.data.imported} 条导入`)
    load()
  } catch (err) {
    ElMessage.error('导入失败: ' + (err.response?.data?.error || err.message))
  }
  e.target.value = ''
}

function scrollToTop() {
  if (bodyRef.value) bodyRef.value.scrollTop = 0
}

function fmtDate(v) {
  if (!v) return ''
  if (v.includes('T')) return v.slice(0, 10)
  return v
}

// Drag-to-scroll on empty td areas
let dragging = false, dragX = 0, dragY = 0, dragSL = 0, dragST = 0, dragWrap = null
function onDragStart(e) {
  if (e.target.tagName !== 'TD' && e.target.tagName !== 'TH') return
  dragWrap = e.currentTarget
  dragging = true
  dragX = e.pageX
  dragY = e.pageY
  dragSL = dragWrap.scrollLeft
  dragST = dragWrap.scrollTop
  e.preventDefault()
}
function onDragMove(e) {
  if (!dragging || !dragWrap) return
  dragWrap.scrollLeft = dragSL - (e.pageX - dragX)
  dragWrap.scrollTop = dragST - (e.pageY - dragY)
}
function onDragEnd() { dragging = false; dragWrap = null }

// Double-div: sync body scroll → header scroll, sync header col widths → body cols
function syncHeaderScroll() {
  if (!headerRef.value || !bodyRef.value) return
  headerRef.value.scrollLeft = bodyRef.value.scrollLeft
}
// 统一滚动处理：同时驱动虚拟滚动 + 同步表头横向偏移
function onBodyScroll(e) {
  vs.onScroll(e)
  syncHeaderScroll()
}
function syncColWidths() {
  if (!headerRef.value || !bodyRef.value) return
  const hThs = headerRef.value.querySelectorAll('th')
  const widths = Array.from(hThs).map(th => th.offsetWidth)
  const rows = bodyRef.value.querySelectorAll('tbody tr')
  for (const row of rows) {
    const tds = row.querySelectorAll('td')
    tds.forEach((td, i) => { if (widths[i]) td.style.width = widths[i] + 'px' })
  }
  const totalW = widths.reduce((s, w) => s + w, 0)
  const headerTable = headerRef.value.querySelector('table')
  const bodyTable = bodyRef.value.querySelector('table')
  if (headerTable) headerTable.style.minWidth = totalW + 'px'
  if (bodyTable) bodyTable.style.minWidth = totalW + 'px'
}

onMounted(() => {
  load().then(() => setTimeout(syncColWidths, 0))
  const body = bodyRef.value
  if (body) {
    body.addEventListener('mousedown', onDragStart)
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }
})
onUnmounted(() => {
  if (bodyRef.value) {
    bodyRef.value.removeEventListener('mousedown', onDragStart)
  }
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <div class="styles-page">
    <div class="toolbar">
      <div class="view-tabs">
        <button class="view-tab" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">📊 表格</button>
        <button class="view-tab" :class="{ active: viewMode === 'gantt' }" @click="viewMode = 'gantt'">📅 甘特图</button>
      </div>
      <template v-if="viewMode === 'table'">
        <el-button type="warning" @click="doAutoSchedule" :loading="autoScheduling">⚡ 自动排产</el-button>
        <el-button type="primary" @click="openAdd">+ 新增计划</el-button>
        <el-button @click="exportExcel">导出 Excel</el-button>
        <el-button @click="triggerImport">导入 Excel</el-button>
        <input ref="fileInputRef" type="file" accept=".xlsx,.xls" style="display:none" @change="handleImport" />
        <span v-if="conflictCount > 0" class="conflict-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          {{ conflictCount }} 条冲突
        </span>
        <span v-if="dueWarnCount > 0" class="due-warn-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {{ dueWarnCount }} 条交期临近
        </span>
        <span v-if="expiredCount > 0" class="expired-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {{ expiredCount }} 条已过期
        </span>
      </template>
    </div>

    <div v-if="!plans.length && !loading" class="empty-state">暂无预排总计划数据，点击上方按钮新增</div>

    <!-- 批量操作栏 -->
    <div v-if="selectedCount > 0" class="batch-bar">
      <span class="batch-count">已选 {{ selectedCount }} 项</span>
      <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
      <el-button size="small" text @click="selectedIds.value = new Set()">取消选择</el-button>
    </div>

    <!-- 甘特图视图 -->
    <MainPlanGantt v-if="viewMode === 'gantt'" />

    <div v-if="viewMode === 'table'" class="excel-wrap">
      <!-- 固定表头 -->
      <div class="excel-header" ref="headerRef">
        <table class="excel-table">
          <colgroup><col v-for="(w, i) in colWidths" :key="i" :style="{ width: w + 'px' }" /></colgroup>
          <thead>
            <tr>
              <th style="text-align:center">
                <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" class="chk" />
              </th>
              <th v-for="col in columns" :key="col.field">
                <div class="col-header">
                  <DateFilter v-if="col.type==='date'" :data="plans" :field="col.field" :label="col.label" :active="isFilterActive(col.field, 'date')" @filter="f => onDateFilter(col.field, f)" />
                  <NumberFilter v-else-if="col.type==='number'" :data="plans" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" :active="isFilterActive(col.field)" @filter="f => onTextFilter(col.field, f)" @sort="onSort" />
                  <TextFilter v-else :data="plans" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" :active="isFilterActive(col.field)" @filter="f => onTextFilter(col.field, f)" @sort="onSort" />
                </div>
              </th>
              <th>
                操作
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <!-- 可滚动表体 -->
      <div class="excel-body" ref="bodyRef" @scroll="onBodyScroll">
        <table class="excel-table">
          <colgroup><col v-for="(w, i) in colWidths" :key="i" :style="{ width: w + 'px' }" /></colgroup>
          <tbody>
          <tr v-if="topPad > 0" :style="{ height: topPad + 'px' }"><td :colspan="columns.length + 2" style="padding:0;border:0"></td></tr>
          <template v-for="(row, i) in visibleRows" :key="row.id">
          <!-- 分组分隔线（基于绝对索引判断） -->
          <tr v-if="showSection(startIndex + i) && !(row.workshop && row.line_team)" class="section-row">
            <td :colspan="columns.length + 2" class="section-label">
              <span class="section-tag unassigned">待排班组款式 ({{ unassignedCount }})</span>
              <span class="section-hint">缝制提醒到期的已置顶</span>
            </td>
          </tr>
          <tr v-if="showSection(startIndex + i) && (row.workshop && row.line_team)" class="section-row">
            <td :colspan="columns.length + 2" class="section-label">
              <span class="section-tag assigned">已排班组款式 ({{ assignedCount }})</span>
            </td>
          </tr>
          <tr :class="{ 'editing-row': editingId === row.id, 'selected-row': selectedIds.has(row.id), 'unassigned-row': !row.workshop || !row.line_team, 'conflict-row': row.conflict_flag && !row.expired, 'expired-row': row.expired, 'due-warn-row': row.due_date_warning && !row.expired && !row.conflict_flag, 'multi-line-row': row.line_count > 1 && !isFirstOfGroup(row) }">
            <td class="chk-cell">
              <input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggleSelect(row.id)" class="chk" />
              <span v-if="row.expired" class="expired-icon" title="已过期：交期已过，不排产">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </span>
              <span v-else-if="row.conflict_flag" class="conflict-icon" title="排程冲突：缝制/烫标上线早于二次加工下线">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
              </span>
              <span v-else-if="row.due_date_warning" class="due-warn-icon" :title="'交期临近：' + row.due_date">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </span>
            </td>
            <td style="white-space:normal;word-break:break-all;overflow:hidden">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.style_no" /></template>
              <template v-else><span :style="{ opacity: row.line_count > 1 && !isFirstOfGroup(row) ? 0.5 : 1 }">{{ row.style_no }}</span></template>
            </td>
            <td style="white-space:normal;word-break:break-all;overflow:hidden">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.product_name" /></template>
              <template v-else><span :style="{ opacity: row.line_count > 1 && !isFirstOfGroup(row) ? 0.5 : 1 }">{{ row.product_name }}</span></template>
            </td>
            <td class="num">
              <template v-if="editingId === row.id"><input class="inp" v-model.number="editForm.plan_qty" type="number" min="0" /></template>
              <template v-else><span>{{ row.plan_qty }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.due_date" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.due_date) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.arrival_date" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.arrival_date) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.cutting_start" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.cutting_start) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.cutting_end" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.cutting_end) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.printing_start" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.printing_start) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.printing_end" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.printing_end) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.embroidery_start" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.embroidery_start) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.embroidery_end" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.embroidery_end) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.template_start" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.template_start) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.template_end" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.template_end) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.ironing_start" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.ironing_start) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.ironing_end" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.ironing_end) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.sewing_remind_date" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.sewing_remind_date) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.sewing_start" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.sewing_start) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.sewing_end" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.sewing_end) }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.workshop" /></template>
              <template v-else><span>{{ row.workshop }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.line_team" /></template>
              <template v-else><span>{{ row.line_team }}</span></template>
            </td>
            <td>
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.line_index" type="number" min="1" /></template>
              <template v-else><span>{{ row.line_count > 1 ? row.line_index + '/' + row.line_count : '' }}</span></template>
            </td>
            <td class="action-cell">
              <template v-if="editingId === row.id">
                <el-button size="small" text type="primary" @click="saveEdit">保存</el-button>
                <el-button size="small" text @click="cancelEdit">取消</el-button>
              </template>
              <template v-else>
                <el-button size="small" text @click="startEdit(row)">编辑</el-button>
                <el-button size="small" text type="danger" @click="remove(row.id)">删除</el-button>
              </template>
            </td>
          </tr>
          </template>
          <tr v-if="bottomPad > 0" :style="{ height: bottomPad + 'px' }"><td :colspan="columns.length + 2" style="padding:0;border:0"></td></tr>
        </tbody>
      </table>
    </div>
    </div><!-- /table view -->

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 新增计划弹窗 -->
    <el-dialog v-model="dialogVisible" title="新增预排总计划" width="680px">
      <el-form label-width="90px" size="small">
        <el-form-item label="选择款式">
          <StylePicker ref="stylePickerRef" :model-value="selectedStyle" @select="onStyleSelect" />
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="计划数量">
              <el-input-number v-model="form.plan_qty" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="交期">
              <el-date-picker v-model="form.due_date" type="date" value-format="YYYY-MM-DD" style="width:100%" @change="autoCalcDates" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="预计面料到货">
              <el-date-picker v-model="form.arrival_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="流水线数">
              <el-input-number v-model="form.pipeline_count" :min="1" :max="10" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">裁剪</el-divider>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="上线">
              <el-date-picker v-model="form.cutting_start" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="下线">
              <el-date-picker v-model="form.cutting_end" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">二次加工</el-divider>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="印花上线"><el-date-picker v-model="form.printing_start" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="印花下线"><el-date-picker v-model="form.printing_end" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="刺绣上线"><el-date-picker v-model="form.embroidery_start" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="刺绣下线"><el-date-picker v-model="form.embroidery_end" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="模板上线"><el-date-picker v-model="form.template_start" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="模板下线"><el-date-picker v-model="form.template_end" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="烫标上线"><el-date-picker v-model="form.ironing_start" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="烫标下线"><el-date-picker v-model="form.ironing_end" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
        </el-row>

        <el-divider content-position="left">缝制</el-divider>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="提醒日">
              <el-date-picker v-model="form.sewing_remind_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="上线">
              <el-date-picker v-model="form.sewing_start" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="下线">
              <el-date-picker v-model="form.sewing_end" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="车间">
              <el-input v-model="form.workshop" placeholder="如：一车间" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="班组">
              <el-input v-model="form.line_team" placeholder="如：1班" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.styles-page { display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.view-tabs { display: flex; gap: 4px; margin-right: 8px; }
.view-tab {
  padding: 6px 16px; border: 1px solid var(--border); border-radius: 8px;
  background: #fff; cursor: pointer; font-size: 13px; font-weight: 500;
  color: var(--text-secondary); transition: all .2s;
}
.view-tab:hover { background: #f8f9fa; }
.view-tab.active {
  background: var(--primary); color: #fff; border-color: var(--primary);
}

.empty-state { text-align: center; padding: 80px 60px; color: var(--text-tertiary); font-size: 14px; }

/* 批量操作栏 */
.batch-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  margin-bottom: 12px;
  background: var(--primary-light);
  border: 1px solid var(--primary);
  border-radius: var(--radius-sm);
}
.batch-count {
  font-size: 13px; font-weight: 600; color: var(--primary);
  margin-right: 4px;
}

/* Checkbox */
.chk {
  width: 16px; height: 16px;
  accent-color: var(--primary);
  cursor: pointer;
}
.chk-cell {
  text-align: center !important;
  vertical-align: middle;
  cursor: default;
  padding: 12px 0 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.conflict-icon { cursor: help; flex-shrink: 0; }
.due-warn-icon { cursor: help; flex-shrink: 0; }
.selected-row td {
  background: var(--primary-light) !important;
}

/* 分区分隔行 */
.section-row td {
  background: var(--bg) !important;
  padding: 8px 12px !important;
  border-bottom: 2px solid var(--border) !important;
  white-space: nowrap;
}
.section-tag {
  display: inline-block;
  font-size: 13px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
  margin-right: 8px;
}
.section-tag.unassigned {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.section-tag.assigned {
  background: var(--primary-light, #eef2ff);
  color: var(--primary-dark, #3730a3);
  border: 1px solid var(--primary-light, #c7d2fe);
}
.section-hint {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 400;
}
.unassigned-row td {
  background: #fffbeb !important;
}
.conflict-row td {
  background: #fef2f2 !important;
}
.expired-row td {
  background: #f9fafb !important;
  color: #9ca3af !important;
}
.due-warn-row td {
  background: #fffbeb !important;
}
.multi-line-row td {
  border-top: 1px dashed #e5e7eb !important;
}
.conflict-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  padding: 4px 10px;
  background: #fef2f2;
  color: #ef4444;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}
.due-warn-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  padding: 4px 10px;
  background: #fffbeb;
  color: #f59e0b;
  border: 1px solid #fde68a;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}
.expired-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  padding: 4px 10px;
  background: #fef2f2;
  color: #ef4444;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

/* 双div容器：header固定 + body滚动 */
.excel-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  background: var(--card);
  border: 1px solid var(--border);
  overflow: hidden;
}

.excel-header {
  flex-shrink: 0;
  overflow: hidden;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}

.excel-body {
  flex: 1;
  overflow: auto;
}

/* 表格共享样式 */
.excel-table td, .excel-table th {
  cursor: default;
}
.excel-table td *, .excel-table th * {
  cursor: text;
}

.excel-table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  color: var(--text);
  width: 100%;
  table-layout: fixed;
}

/* 表头：小灰字，左对齐，只有底部细线 */
.excel-table thead th {
  padding: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
  text-transform: none;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}

/* 数据行：大间距，只有底部细线，无竖线 */
.excel-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  line-height: 1.5;
}
/* 对齐：body td 宽度匹配 header th（合并冲突icon后：checkbox=1, 款号=2, ...） */

.col-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 10px 16px;
  gap: 4px;
}
.col-header span {
  font-weight: 500;
  font-size: 11px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  letter-spacing: 0.3px;
}

.excel-body tbody tr:hover td { background: var(--primary-light); }
.editing-row td {
  background: var(--primary-light) !important;
  box-shadow: inset 3px 0 0 var(--primary);
}

.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; white-space: nowrap; }
.text-left { text-align: left; }
.wrap-cell { overflow: hidden; word-break: break-all; white-space: normal !important; }

.action-cell {
  white-space: nowrap;
  min-width: 120px;
}

.inp {
  width: 100%;
  border: 1px solid var(--border);
  text-align: left;
  font-size: 13px;
  padding: 4px 8px;
  background: var(--card);
  border-radius: var(--radius-sm);
  font-family: inherit;
  transition: border-color .15s;
}
.inp:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 2px rgba(0,0,0,.06);
}
.inp-select {
  width: 100%;
  border: 1px solid var(--border);
  text-align: left;
  font-size: 13px;
  padding: 4px 8px;
  background: var(--card);
  border-radius: var(--radius-sm);
  font-family: inherit;
  color: var(--text);
  cursor: pointer;
  transition: border-color .15s;
}
.inp-select:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 2px rgba(0,0,0,.06);
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
