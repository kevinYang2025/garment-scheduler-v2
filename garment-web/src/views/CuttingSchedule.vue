<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import TextFilter from '../components/TextFilter.vue'
import DateFilter from '../components/DateFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'

const rows = ref([])
const loading = ref(false)

// Filter states
const textFilters = ref({})
const dateFilters = ref({})
const numFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

// View navigation
const viewOffset = ref(0)
const WEEK_DAYS = 21

function onTextFilter(field, f) {
  textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } }
}
function onDateFilter(field, f) {
  dateFilters.value = { ...dateFilters.value, [field]: f }
}
function onNumFilter(field, f) {
  numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } }
}
function onSort(field, sortBy, dir) {
  sortState.value = { field, sortBy, dir }
}
function isFilterActive(field, type) {
  if (type === 'date') {
    const f = dateFilters.value[field]
    return !!(f && (f.validDates?.size > 0 || f.hasEmpty))
  }
  if (type === 'number') return !!numFilters.value[field]?.applied
  return !!textFilters.value[field]?.applied
}

// Date range for Gantt columns
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
    const y = dt.getFullYear()
    const mo = String(dt.getMonth() + 1).padStart(2, '0')
    const d = String(dt.getDate()).padStart(2, '0')
    cols.push(`${y}-${mo}-${d}`)
  }
  return cols
})

const today = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
})

const visibleDateCols = computed(() => {
  if (!dateCols.value.length) return []
  const startIdx = Math.max(0, viewOffset.value * 7)
  return dateCols.value.slice(startIdx, startIdx + WEEK_DAYS)
})

const dateRangeLabel = computed(() => {
  const cols = visibleDateCols.value
  if (!cols.length) return ''
  return `${cols[0]} ~ ${cols[cols.length - 1]}`
})

function shiftWeek(dir) { viewOffset.value += dir }
function dateLabel(d) {
  const parts = d.split('-')
  return `${parts[1]}/${parts[2]}`
}

// Filtered + sorted rows
const filteredRows = computed(() => {
  return rows.value.filter(r => {
    for (const [field, f] of Object.entries(dateFilters.value)) {
      if (!f) continue
      const d = r[field] ? (r[field].includes('T') ? r[field].slice(0, 10) : r[field]) : ''
      if (d && !f.validDates.has(d)) return false
      if (!d && !f.hasEmpty) return false
    }
    for (const [field, f] of Object.entries(textFilters.value)) {
      if (!f || !f.applied) continue
      const val = r[field] || ''
      const hasVal = !!val
      if (hasVal && !f.checked.has(val)) return false
      if (!hasVal && !f.includeEmpty) return false
    }
    return true
  }).sort((a, b) => {
    if (sortState.value.field) {
      const { field, sortBy, dir } = sortState.value
      const mul = dir === 'asc' ? 1 : -1
      if (sortBy === 'count') {
        const va = a[field] || 0, vb = b[field] || 0
        return (va - vb) * mul
      }
      const va = a[field] || '', vb = b[field] || ''
      return va.localeCompare(vb, 'zh') * mul
    }
    // Default: by cutting_start then style_no
    const as = a.cutting_start || '9999-99-99', bs = b.cutting_start || '9999-99-99'
    if (as !== bs) return as.localeCompare(bs)
    if (a.style_no !== b.style_no) return (a.style_no || '').localeCompare(b.style_no || '')
    return (a.color || '').localeCompare(b.color || '')
  })
})

async function load() {
  loading.value = true
  try {
    const { data } = await api.getCuttingSchedule()
    rows.value = data || []
    // Auto-advance view to show today
    if (dateCols.value.length) {
      const idx = dateCols.value.findIndex(d => d >= today.value)
      if (idx >= 0) viewOffset.value = Math.max(0, Math.floor((idx - 3) / 7))
    }
  } catch (e) {
    console.error('load cutting schedule error:', e)
    ElMessage.error('加载裁剪排程失败')
  }
  loading.value = false
}

async function doExport() {
  try {
    const resp = await api.exportCuttingSchedule()
    const url = URL.createObjectURL(resp.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `裁剪排程_${today.value}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error('导出失败')
  }
}

onMounted(() => { load() })
</script>

<template>
  <div class="cutting-schedule">
    <!-- 顶部操作栏 -->
    <div class="detail-header">
      <div class="header-left">
        <h3 style="margin:0">裁剪排程</h3>
        <span class="row-count">共 {{ filteredRows.length }} 行</span>
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
        <el-button @click="doExport">导出Excel</el-button>
        <el-button @click="load" :loading="loading">刷新</el-button>
      </div>
    </div>

    <div v-if="!rows.length && !loading" style="text-align:center;padding:60px;color:var(--text-tertiary)">
      暂无裁剪排程数据
    </div>

    <!-- Excel-style table -->
    <div v-else class="excel-wrap">
      <table class="excel-table">
        <thead>
          <tr>
            <th class="fix" style="min-width:160px">
              <div class="col-header"><span>款式</span>
                <TextFilter :data="rows" field="style_no" @filter="f => onTextFilter('style_no', f)"
                  :sortField="sortState.field==='style_no' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='style_no' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('style_no')" />
              </div>
            </th>
            <th class="fix" style="min-width:130px">
              <div class="col-header"><span>品名</span>
                <TextFilter :data="rows" field="product_name" @filter="f => onTextFilter('product_name', f)"
                  :sortField="sortState.field==='product_name' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='product_name' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('product_name')" />
              </div>
            </th>
            <th class="fix" style="min-width:120px">
              <div class="col-header"><span>颜色</span>
                <TextFilter :data="rows" field="color" @filter="f => onTextFilter('color', f)"
                  :sortField="sortState.field==='color' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='color' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('color')" />
              </div>
            </th>
            <th class="fix" style="min-width:60px">
              <div class="col-header"><span>规格</span>
                <TextFilter :data="rows" field="size_spec" @filter="f => onTextFilter('size_spec', f)"
                  :sortField="sortState.field==='size_spec' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='size_spec' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('size_spec')" />
              </div>
            </th>
            <th class="fix" style="min-width:80px">
              <div class="col-header"><span>原单量</span>
                <NumberFilter :data="rows" field="plan_qty"
                  @filter="f => onNumFilter('plan_qty', f)"
                  :sortField="sortState.field==='plan_qty' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='plan_qty' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('plan_qty')" />
              </div>
            </th>
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>裁剪上线</span>
                <DateFilter :data="rows" field="cutting_start" @filter="f => onDateFilter('cutting_start', f)"
                  :sortField="sortState.field==='cutting_start' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='cutting_start' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('cutting_start', 'date')" />
              </div>
            </th>
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>裁剪下线</span>
                <DateFilter :data="rows" field="cutting_end" @filter="f => onDateFilter('cutting_end', f)"
                  :sortField="sortState.field==='cutting_end' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='cutting_end' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)"
                  :active="isFilterActive('cutting_end', 'date')" />
              </div>
            </th>
            <th class="fix" style="min-width:80px"><div class="col-header"><span>合计</span></div></th>
            <th v-for="d in visibleDateCols" :key="d" class="date-th" :class="{ 'today-col': d === today }">{{ dateLabel(d) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in filteredRows" :key="i">
            <td class="fix">{{ r.style_no }}</td>
            <td class="fix">{{ r.product_name }}</td>
            <td class="fix">{{ r.color }}</td>
            <td class="fix">{{ r.size_spec }}</td>
            <td class="fix num">{{ r.plan_qty }}</td>
            <td class="fix">{{ r.cutting_start }}</td>
            <td class="fix">{{ r.cutting_end }}</td>
            <td class="fix num">{{ r.plan_qty }}</td>
            <td v-for="d in visibleDateCols" :key="d"
              class="date-cell"
              :class="{ 'in-range': r.cutting_start && r.cutting_end && d >= r.cutting_start && d <= r.cutting_end, 'today-col': d === today }">
              {{ r.cutting_start && r.cutting_end && d >= r.cutting_start && d <= r.cutting_end ? r.plan_qty : '' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.cutting-schedule { padding: 16px; height: 100%; display: flex; flex-direction: column; }
.detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 16px; flex-wrap: wrap; }
.header-left { display: flex; align-items: center; gap: 12px; }
.row-count { color: var(--text-tertiary); font-size: 13px; }
.header-nav { display: flex; align-items: center; gap: 8px; }
.nav-arrows { display: flex; gap: 4px; }
.nav-btn { background: var(--bg-secondary, #f5f5f5); border: 1px solid var(--border-color, #ddd); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 13px; }
.nav-btn:hover { background: var(--bg-hover, #e8e8e8); }
.today-btn { background: #7c3aed; color: white; border-color: #7c3aed; }
.today-btn:hover { background: #6d28d9; }
.date-range-label { font-size: 13px; color: var(--text-secondary); }
.header-actions { display: flex; gap: 8px; }

.excel-wrap { flex: 1; overflow: auto; border: 1px solid var(--border-color, #ddd); border-radius: 4px; }
.excel-table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 13px; }
.excel-table th, .excel-table td { border: 1px solid var(--border-color, #e0e0e0); padding: 4px 8px; white-space: nowrap; text-align: center; }
.excel-table th { background: #f0f0f0; font-weight: 600; position: sticky; top: 0; z-index: 2; }
.excel-table th.fix { position: sticky; left: auto; z-index: 3; background: #f0f0f0; }
.excel-table td.fix { position: sticky; left: auto; z-index: 1; background: white; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.date-th { min-width: 48px; font-size: 11px; padding: 4px 2px; }
.date-cell { min-width: 48px; font-size: 12px; }
.date-cell.in-range { background: #d4edda; }
.today-col { background: #f3e8ff !important; }
.col-header { display: flex; flex-direction: column; align-items: center; gap: 2px; }
</style>
