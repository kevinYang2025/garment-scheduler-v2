<script setup>
// 缝制每日计划 —— 数据来源：预排总计划
// 表格格式与班组缝制计划(SewingPlanDetail.vue)一致
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'
import DateFilter from '../components/DateFilter.vue'

const emit = defineEmits(['back'])

const plans = ref([])
const loading = ref(false)

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

// Filtered & sorted plans
const filteredPlans = computed(() => {
  let list = plans.value.filter(r => r.sewing_start && r.sewing_end).slice()

  for (const [field, f] of Object.entries(textFilters.value)) {
    if (!f || !f.applied) continue
    list = list.filter(r => {
      const val = r[field] || ''
      const hasVal = !!val
      if (hasVal && !f.checked.has(val)) return false
      if (!hasVal && !f.includeEmpty) return false
      return true
    })
  }

  for (const [field, f] of Object.entries(numFilters.value)) {
    if (!f || !f.applied) continue
    list = list.filter(r => {
      const val = r[field]
      const numVal = val != null ? Number(val) : null
      if (numVal != null && !isNaN(numVal)) {
        if (f.min != null && numVal < f.min) return false
        if (f.max != null && numVal > f.max) return false
      }
      return true
    })
  }

  for (const [field, f] of Object.entries(dateFilters.value)) {
    if (!f || ((!f.validDates || f.validDates.size === 0) && !f.hasEmpty)) continue
    list = list.filter(r => {
      const d = r[field] ? (r[field].includes('T') ? r[field].slice(0, 10) : r[field]) : ''
      if (d && f.validDates && !f.validDates.has(d)) return false
      if (!d && !f.hasEmpty) return false
      return true
    })
  }

  if (sortState.value.field) {
    const { field, sortBy, dir } = sortState.value
    const mul = dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      let va, vb
      if (sortBy === 'number') {
        va = parseInt(a[field]) || 0
        vb = parseInt(b[field]) || 0
        return (va - vb) * mul
      }
      if (sortBy === 'date') {
        va = a[field] ? (a[field].includes('T') ? a[field].slice(0, 10) : a[field]) : ''
        vb = b[field] ? (b[field].includes('T') ? b[field].slice(0, 10) : b[field]) : ''
        return va.localeCompare(vb) * mul
      }
      va = a[field] || ''
      vb = b[field] || ''
      return va.localeCompare(vb, 'zh') * mul
    })
  }

  return list
})

// Compute date range from all plans' sewing_start ~ sewing_end
const dateCols = computed(() => {
  if (!plans.value.length) return []
  let min = null, max = null
  for (const m of plans.value) {
    if (m.sewing_start && (!min || m.sewing_start < min)) min = m.sewing_start
    if (m.sewing_end && (!max || m.sewing_end > max)) max = m.sewing_end
  }
  if (!min || !max) return []
  const sd = new Date(min + 'T00:00:00'), ed = new Date(max + 'T00:00:00')
  const days = Math.floor((ed - sd) / 86400000) + 1
  const cols = []
  for (let i = 0; i < days; i++) {
    const dt = new Date(sd); dt.setDate(dt.getDate() + i)
    cols.push(fmt(dt))
  }
  return cols
})

// Groups: one group per plan row, with plan/actual/diff sub-rows
const groups = computed(() => {
  return filteredPlans.value.map(m => {
    const planSum = dateCols.value.reduce((s, date) => s + calcPlanQty(m, date), 0)
    return { master: m, planSum }
  })
})

// Calculate daily plan quantity
function calcPlanQty(master, date) {
  const start = master.sewing_start
  const end = master.sewing_end
  if (!start || !end || !master.plan_qty) return 0
  if (date < start || date > end) return 0

  const dailyTarget = calcDailyTarget(master)
  if (!dailyTarget) return 0

  const sd = new Date(start + 'T00:00:00')
  const cd = new Date(date + 'T00:00:00')
  const dayIdx = Math.floor((cd - sd) / 86400000)
  const fullDays = Math.floor(master.plan_qty / dailyTarget)
  const remainder = master.plan_qty % dailyTarget

  if (dayIdx < fullDays) return dailyTarget
  if (dayIdx === fullDays && remainder > 0) return remainder
  return 0
}

function calcDailyTarget(master) {
  if (master.daily_target) return master.daily_target
  const start = master.sewing_start
  const end = master.sewing_end
  if (!start || !end || !master.plan_qty) return 0
  const days = Math.ceil((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000) + 1
  return Math.ceil(master.plan_qty / days)
}

// Today
const today = computed(() => {
  const d = new Date()
  return fmt(d)
})

// Date window navigation
const viewOffset = ref(0)
function shiftWeek(dir) { viewOffset.value += dir * 7 }

const visibleDateCols = computed(() => {
  const d = new Date(today.value + 'T00:00:00')
  const ws = new Date(d); ws.setDate(ws.getDate() - 7 + viewOffset.value)
  const we = new Date(d); we.setDate(we.getDate() + 21 + viewOffset.value)
  const wsStr = fmt(ws)
  const weStr = fmt(we)
  return dateCols.value.filter(c => c >= wsStr && c <= weStr)
})

const dateRangeLabel = computed(() => {
  if (!visibleDateCols.value.length) return ''
  const first = visibleDateCols.value[0]
  const last = visibleDateCols.value[visibleDateCols.value.length - 1]
  return first.slice(5) + ' ~ ' + last.slice(5)
})

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(v) {
  if (!v) return ''
  if (v.includes('T')) return v.slice(0, 10)
  return v
}

function formatQty(v) { return v != null ? v.toLocaleString() : '0' }
function dateLabel(d) { return d ? d.slice(5) : '' }

async function load() {
  loading.value = true
  try {
    const { data } = await api.getMainPlan()
    plans.value = data || []
  } catch {
    ElMessage.error('加载预排总计划失败')
  }
  loading.value = false
}

// Export Excel
async function doExport() {
  try {
    if (!filteredPlans.value.length) { ElMessage.warning('没有可导出的数据'); return }
    const XLSX = await import('xlsx')
    const fixedHeaders = ['款号', '品名', '计划数量', '目标日产量', '缝制开始', '缝制结束', '车间', '班组']
    const dateHeaders = visibleDateCols.value
    const header = [...fixedHeaders, ...dateHeaders.map(d => d.slice(5))]

    const rows = []
    for (const g of groups.value) {
      const m = g.master
      // 计划行
      rows.push([
        m.style_no, m.product_name, m.plan_qty, calcDailyTarget(m),
        fmtDate(m.sewing_start), fmtDate(m.sewing_end), m.workshop || '', m.line_team || '',
        ...dateHeaders.map(d => calcPlanQty(m, d))
      ])
    }

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = header.map((h, i) => ({ wch: i < fixedHeaders.length ? Math.max(h.length * 2, 10) : 8 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '缝制每日计划')
    XLSX.writeFile(wb, '缝制每日计划.xlsx')
    ElMessage.success(`导出成功：${rows.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败')
  }
}

// Drag-to-scroll
const bodyRef = ref(null)
let dragging = false, dragX = 0, dragY = 0, dragSL = 0, dragST = 0, dragWrap = null
function onDragStart(e) {
  if (e.target.tagName !== 'TD' && e.target.tagName !== 'TH') return
  dragWrap = e.currentTarget
  dragging = true
  dragX = e.pageX
  dragY = e.pageY
  dragSL = dragWrap.scrollLeft
  dragST = dragWrap.scrollTop
  dragWrap.classList.add('dragging')
  e.preventDefault()
}
function onDragMove(e) {
  if (!dragging || !dragWrap) return
  dragWrap.scrollLeft = dragSL - (e.pageX - dragX)
  dragWrap.scrollTop = dragST - (e.pageY - dragY)
}
function onDragEnd() {
  if (dragWrap) dragWrap.classList.remove('dragging')
  dragging = false
  dragWrap = null
}

onMounted(async () => {
  await load()
  const body = bodyRef.value
  if (body) {
    body.addEventListener('mousedown', onDragStart)
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }
})
onUnmounted(() => {
  const body = bodyRef.value
  if (body) body.removeEventListener('mousedown', onDragStart)
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <div class="sewing-daily">
    <!-- 顶部操作栏 -->
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="emit('back')"><span style="margin-right:4px">&larr;</span> 返回</el-button>
      </div>
      <div class="header-nav">
        <span class="nav-arrows">
          <button class="nav-btn" @click="shiftWeek(-1)" title="前一周">&laquo;</button>
          <button class="nav-btn today-btn" @click="viewOffset=0" title="回到今天">今天</button>
          <button class="nav-btn" @click="shiftWeek(1)" title="后一周">&raquo;</button>
        </span>
        <span class="date-range-label">{{ dateRangeLabel }}</span>
      </div>
      <div class="header-actions">
        <el-button @click="doExport">导出Excel</el-button>
      </div>
    </div>

    <div v-if="!plans.length && !loading" class="empty-hint">
      暂无预排总计划数据，请先在"预排总计划"中添加数据
    </div>

    <div v-else-if="!groups.length && !loading" class="empty-hint">
      暂无有效的缝制排期数据（需要设置缝制上线和下线日期）
    </div>

    <!-- Excel-style table -->
    <div v-else ref="bodyRef" class="excel-wrap">
      <table class="excel-table">
        <thead>
          <tr>
            <!-- 款号 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>款号</span>
                <TextFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="style_no" @filter="f => onTextFilter('style_no', f)"
                  :sortField="sortState.field==='style_no' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='style_no' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('style_no')" />
              </div>
            </th>
            <!-- 品名 -->
            <th class="fix" style="min-width:140px">
              <div class="col-header"><span>品名</span>
                <TextFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="product_name" @filter="f => onTextFilter('product_name', f)"
                  :sortField="sortState.field==='product_name' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='product_name' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('product_name')" />
              </div>
            </th>
            <!-- 计划数量 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>计划数量</span>
                <NumberFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="plan_qty"
                  @filter="f => onNumFilter('plan_qty', f)"
                  :sortField="sortState.field==='plan_qty' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='plan_qty' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('plan_qty')" />
              </div>
            </th>
            <!-- 交期 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>交期</span>
                <DateFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="due_date" @filter="f => onDateFilter('due_date', f)"
                  :sortField="sortState.field==='due_date' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='due_date' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('due_date', 'date')" />
              </div>
            </th>
            <!-- 目标日产量 -->
            <th class="fix" style="min-width:90px"><div class="col-header"><span>目标日产量</span></div></th>
            <!-- 缝制开始 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>缝制开始</span>
                <DateFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="sewing_start" @filter="f => onDateFilter('sewing_start', f)"
                  :sortField="sortState.field==='sewing_start' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='sewing_start' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('sewing_start', 'date')" />
              </div>
            </th>
            <!-- 缝制结束 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>缝制结束</span>
                <DateFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="sewing_end" @filter="f => onDateFilter('sewing_end', f)"
                  :sortField="sortState.field==='sewing_end' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='sewing_end' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('sewing_end', 'date')" />
              </div>
            </th>
            <!-- 车间 -->
            <th class="fix" style="min-width:70px">
              <div class="col-header"><span>车间</span>
                <TextFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="workshop" @filter="f => onTextFilter('workshop', f)"
                  :sortField="sortState.field==='workshop' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='workshop' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('workshop')" />
              </div>
            </th>
            <!-- 班组 -->
            <th class="fix" style="min-width:70px">
              <div class="col-header"><span>班组</span>
                <TextFilter :data="plans.filter(r => r.sewing_start && r.sewing_end)" field="line_team" @filter="f => onTextFilter('line_team', f)"
                  :sortField="sortState.field==='line_team' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='line_team' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('line_team')" />
              </div>
            </th>
            <!-- 合计 -->
            <th class="fix" style="min-width:80px"><div class="col-header"><span>合计</span></div></th>
            <!-- 类型 -->
            <th class="fix" style="min-width:60px"><div class="col-header"><span>类型</span></div></th>
            <!-- 日期列 -->
            <th v-for="d in visibleDateCols" :key="d" class="date-th" :class="{ 'today-col': d === today }">{{ dateLabel(d) }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in groups" :key="g.master.id">
            <!-- 计划行 -->
            <tr class="row-plan">
              <td class="fix">{{ g.master.style_no }}</td>
              <td class="fix">{{ g.master.product_name }}</td>
              <td class="fix num">{{ formatQty(g.master.plan_qty) }}</td>
              <td class="fix">{{ fmtDate(g.master.due_date) }}</td>
              <td class="fix num">{{ formatQty(calcDailyTarget(g.master)) }}</td>
              <td class="fix">{{ fmtDate(g.master.sewing_start) }}</td>
              <td class="fix">{{ fmtDate(g.master.sewing_end) }}</td>
              <td class="fix">{{ g.master.workshop || '' }}</td>
              <td class="fix">{{ g.master.line_team || '' }}</td>
              <td class="fix num sum-cell">{{ formatQty(g.planSum) }}</td>
              <td class="fix type-label plan-label">计划</td>
              <td v-for="d in visibleDateCols" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today }">
                {{ formatQty(calcPlanQty(g.master, d)) }}
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
    </div>
  </div>
</template>

<style scoped>
.sewing-daily { display: flex; flex-direction: column; height: 100%; }

.detail-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid var(--border); gap: 12px;
}
.header-left { display: flex; align-items: center; flex-shrink: 0; }
.header-nav { display: flex; align-items: center; gap: 8px; justify-content: center; flex: 1; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }

.nav-arrows { display: flex; align-items: center; gap: 4px; }
.nav-btn {
  padding: 6px 12px; background: var(--primary); color: #fff; border: none;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-weight: 500;
  transition: var(--transition); line-height: 1;
}
.nav-btn:hover { background: var(--primary-hover); }
.nav-btn.today-btn { font-size: 13px; font-weight: 600; padding: 6px 14px; }
.date-range-label {
  font-size: 14px; font-weight: 600; color: var(--text);
  min-width: 120px; text-align: center; margin-left: 4px;
}

.empty-hint {
  text-align: center; padding: 80px 40px; color: var(--text-tertiary); font-size: 14px;
}

.excel-wrap {
  flex: 1; overflow: auto;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--card);
}
.excel-wrap.dragging,
.excel-wrap.dragging td,
.excel-wrap.dragging th { user-select: none !important; }

.excel-table {
  border-collapse: collapse; font-size: 13px; color: var(--text);
  min-width: 100%; width: 100%;
}

.excel-table thead th {
  padding: 0; background: var(--card); color: var(--text-tertiary);
  font-size: 11px; font-weight: 500; letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;
  position: sticky; top: 0; z-index: 3;
}

.excel-table td {
  padding: 12px 16px; border-bottom: 1px solid var(--border-light);
  white-space: nowrap; text-align: center;
}

.col-header {
  display: flex; flex-direction: row; align-items: center;
  justify-content: flex-start; padding: 10px 14px; gap: 4px;
}
.col-header span {
  font-weight: 500; font-size: 11px; flex-shrink: 0;
  color: var(--text-tertiary); letter-spacing: 0.3px;
}

.row-plan { background: var(--card); }
tbody tr:hover td:not(.fix) { background: var(--primary-light); }

.fix {
  position: sticky; left: 0; z-index: 1; background: inherit;
}
.row-plan .fix { background: var(--card); }
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
.plan-label { color: var(--primary); }

.cell-num {
  text-align: center !important;
  font-variant-numeric: tabular-nums;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

.loading-overlay {
  position: absolute; inset: 0; background: rgba(255,255,255,.8);
  display: flex; align-items: center; justify-content: center; z-index: 10;
}
.loading-spinner {
  width: 28px; height: 28px; border: 2.5px solid var(--border);
  border-top-color: var(--primary); border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
