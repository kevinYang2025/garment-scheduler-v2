<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'
import DateFilter from '../components/DateFilter.vue'
import { useVirtualScroll } from '../composables/useVirtualScroll'

// 虚拟滚动（行高 38px：10+14 padding + 13px font + 1px border）
const vs = useVirtualScroll(38, 8)

const emit = defineEmits(['back'])

const planRows = ref([])
const dateRange = ref([])

// 导入相关
const importDialogVisible = ref(false)
const importFile = ref(null)
const importPreview = ref(null)
const importing = ref(false)
const importMode = ref('skip')

// 新增排程相关
const dialogVisible = ref(false)
const form = ref({})

// 筛选排序
const textFilters = ref({})
const numFilters = ref({})
const dateFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

function onTextFilter(field, f) { textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } } }
function onNumFilter(field, f) { numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } } }
function onDateFilter(field, f) { dateFilters.value = { ...dateFilters.value, [field]: { validDates: f.validDates, hasEmpty: f.hasEmpty } } }
function isFilterActive(field, type) {
  if (type === 'date') { const df = dateFilters.value[field]; return df && (df.validDates?.size > 0 || df.hasEmpty) }
  return !!textFilters.value[field]?.applied || !!numFilters.value[field]?.applied
}
function onSort(field, sortBy, dir) { sortState.value = { field, sortBy, dir } }

const filteredRows = computed(() => {
  let list = planRows.value.filter(r => r.order_qty > 0)  // 过滤空行
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
      const d = r[field] || ''
      if (d && f.validDates && !f.validDates.has(d)) return false
      if (!d && !f.hasEmpty) return false
      return true
    })
  }
  if (sortState.value.field) {
    const { field, sortBy, dir } = sortState.value; const mul = dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      let va, vb
      if (sortBy === 'number') { va = parseInt(a[field]) || 0; vb = parseInt(b[field]) || 0; return (va - vb) * mul }
      va = a[field] || ''; vb = b[field] || ''
      return va.localeCompare(vb, 'zh') * mul
    })
  }
  return list
})

// 日期窗口导航
const viewOffset = ref(0)
function shiftWeek(dir) { viewOffset.value += dir * 7 }

const _d = new Date()
const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`

// 可见日期列 — 直接按窗口计算，不受API dateRange限制
const visibleDates = computed(() => {
  const d = new Date(today + 'T00:00:00')
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
  if (!visibleDates.value.length) return ''
  return visibleDates.value[0].slice(5) + ' ~ ' + visibleDates.value[visibleDates.value.length - 1].slice(5)
})

// 款号折叠
const expandedSet = ref(new Set())
function toggleCollapse(styleNo) {
  if (expandedSet.value.has(styleNo)) {
    expandedSet.value.delete(styleNo)
  } else {
    expandedSet.value.add(styleNo)
  }
  expandedSet.value = new Set(expandedSet.value)
}
function isCollapsed(styleNo) { return !expandedSet.value.has(styleNo) }
function groupRowCount(styleNo) { return planRows.value.filter(r => r.style_no === styleNo).length }

// 按款号分组 + 预构建日期Map + 折叠汇总
const groupedRows = computed(() => {
  const styleGroups = {}
  for (const r of filteredRows.value) {
    if (!styleGroups[r.style_no]) styleGroups[r.style_no] = { product_name: r.product_name, rows: [] }
    styleGroups[r.style_no].rows.push(r)
  }
  const result = []
  let lastStyle = ''
  for (const r of filteredRows.value) {
    const firstOfGroup = r.style_no !== lastStyle
    lastStyle = r.style_no
    if (firstOfGroup && !expandedSet.value.has(r.style_no)) {
      const group = styleGroups[r.style_no]
      const totalOrder = group.rows.reduce((s, x) => s + x.order_qty, 0)
      const totalPlan = group.rows.reduce((s, x) => s + x.totalPlan, 0)
      const totalActual = group.rows.reduce((s, x) => s + x.totalActual, 0)
      const dateMap = {}
      for (const rr of group.rows) {
        for (const dd of rr.dateData) {
          if (!dateMap[dd.date]) dateMap[dd.date] = { date: dd.date, plan: 0, actual: 0, diff: 0 }
          dateMap[dd.date].plan += dd.plan
          dateMap[dd.date].actual += dd.actual
          dateMap[dd.date].diff += dd.diff
        }
      }
      result.push({
        style_no: r.style_no, product_name: r.product_name,
        color: '', size_spec: '',
        order_qty: totalOrder, totalPlan, totalActual, totalDiff: totalActual - totalPlan,
        dateMap, firstOfGroup: true, collapsed: true,
      })
      continue
    }
    if (!firstOfGroup && !expandedSet.value.has(r.style_no)) continue
    const dateMap = {}
    for (const dd of r.dateData) { dateMap[dd.date] = dd }
    result.push({ ...r, firstOfGroup, dateMap })
  }
  return result
})

// 虚拟滚动切片：把 groupedRows 展开成 1 行（汇总/折叠）或 3 行（计划/实际/差异）
const tableRows = computed(() => {
  const out = []
  for (const r of groupedRows.value) {
    const k = `${r.style_no}|${r.color}|${r.size_spec}`
    if (r.collapsed) {
      out.push({ ...r, _key: `sum_${k}`, _type: 'summary' })
    } else {
      out.push({ ...r, _key: `${k}|plan`, _type: 'plan' })
      out.push({ ...r, _key: `${k}|actual`, _type: 'actual' })
      out.push({ ...r, _key: `${k}|diff`, _type: 'diff' })
    }
  }
  return out
})
const vtStartIndex = computed(() => Math.max(0, Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows))
const vtVisibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
const vtVisibleRows = computed(() => tableRows.value.slice(vtStartIndex.value, vtStartIndex.value + vtVisibleCount.value))

async function load() {
  try {
    const { data } = await api.getTemplateDailyPlan()
    planRows.value = data.rows || []
    dateRange.value = data.dateRange || []
  } catch (e) {
    console.error('加载模板排程失败:', e)
    ElMessage.error('加载模板排程失败')
  }
}

function doExport() {
  // 导出CSV
  if (!planRows.value.length) { ElMessage.warning('暂无数据'); return }
  const headers = ['款号', '品名', '颜色', '尺码', '原单量', '合计', '类型', ...dateRange.value]
  const csvRows = [headers.join(',')]
  for (const row of groupedRows.value) {
    const planLine = [row.style_no, row.product_name, row.color, row.size_spec, row.order_qty, row.totalPlan, '计划']
    for (const d of dateRange.value) {
      const dd = row.dateMap[d]
      planLine.push(dd ? dd.plan : '')
    }
    csvRows.push(planLine.join(','))
    const actLine = ['', '', '', '', '', row.totalActual, '实际']
    for (const d of dateRange.value) {
      const dd = row.dateMap[d]
      actLine.push(dd ? dd.actual : '')
    }
    csvRows.push(actLine.join(','))
  }
  const bom = '\uFEFF'
  const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = '模板排程.csv'; a.click()
  URL.revokeObjectURL(url)
}

function openCreate() {
  form.value = { style_no: '', color: '', size_spec: '', plan_qty: 0, plan_start: '', plan_end: '', daily_target: 0 }
  dialogVisible.value = true
}

async function create() {
  if (!form.value.style_no) { ElMessage.warning('款号不能为空'); return }
  try {
    await api.confirmTemplatePlan({
      style_no: form.value.style_no, color: form.value.color, size_spec: form.value.size_spec,
      plan_start: form.value.plan_start, plan_end: form.value.plan_end,
      plan_qty: form.value.plan_qty, daily_target: form.value.daily_target,
    })
    dialogVisible.value = false
    ElMessage.success('创建成功')
    await load()
  } catch (e) { ElMessage.error('创建失败') }
}

function onImportFileChange(e) { importFile.value = e.target.files[0] }

async function doImport() {
  if (!importFile.value || importing.value) return
  if (importFile.value.size > 5 * 1024 * 1024) { ElMessage.warning('文件大小不能超过 5 MB'); return }
  importing.value = true
  try {
    const XLSX = await import('xlsx')
    const data = await importFile.value.arrayBuffer()
    const wb = XLSX.read(data, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
    if (rows.length < 2) { importing.value = false; return ElMessage.error('格式不正确') }
    const headers = rows[0]
    const records = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c == null)) continue
      records.push({
        '款号': row[0], '颜色': row[1], '尺码': row[2],
        '原单量': parseInt(row[3]) || 0, '模板日产量': parseInt(row[4]) || 0,
        '模板开始': row[5], '模板结束': row[6],
      })
    }
    importPreview.value = records
  } catch (e) { ElMessage.error('解析失败: ' + e.message) }
  importing.value = false
}

async function confirmImport() {
  if (!importPreview.value?.length) return
  importing.value = true
  try {
    for (const rec of importPreview.value) {
      await api.confirmTemplatePlan({
        style_no: rec['款号'], color: rec['颜色'], size_spec: rec['尺码'],
        plan_start: rec['模板开始'], plan_end: rec['模板结束'],
        plan_qty: rec['原单量'], daily_target: rec['模板日产量'],
      })
    }
    ElMessage.success(`导入完成: ${importPreview.value.length} 条`)
    importDialogVisible.value = false
    importPreview.value = null
    importFile.value = null
    await load()
  } catch (e) { ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message)) }
  importing.value = false
}

async function saveActual(row, date) {
  const dd = row.dateMap[date]
  if (!dd) return
  try {
    await api.post('/schedule/sewing-daily-plan/actual', {
      style_no: row.style_no,
      color: row.color,
      size_spec: row.size_spec,
      production_date: date,
      completed_qty: dd.actual,
      schedule_type: 'secondary'
    })
    dd.diff = dd.actual - dd.plan
    row.totalActual = row.dateData.reduce((s, d) => s + d.actual, 0)
    row.totalDiff = row.totalActual - row.totalPlan
  } catch (e) {
    console.error('保存实际产量失败:', e)
  }
}

function dateLabel(d) { return d ? d.slice(5) : '' }

// 编辑模式
const editingKey = ref(null)
const editForm = ref({})

function startEdit(row) {
  editingKey.value = `${row.style_no}|${row.color}|${row.size_spec}`
  editForm.value = {
    order_qty: row.order_qty,
    totalPlan: row.totalPlan,
    datePlans: {}
  }
  for (const d of visibleDates.value) {
    const dd = row.dateMap[d]
    editForm.value.datePlans[d] = dd ? dd.plan : 0
  }
}

function isEditing(row) {
  return editingKey.value === `${row.style_no}|${row.color}|${row.size_spec}`
}

function cancelEdit() {
  editingKey.value = null
  editForm.value = {}
}

async function savePlanEdit(row) {
  row.order_qty = editForm.value.order_qty
  let newTotal = 0
  for (const d of visibleDates.value) {
    const dd = row.dateMap[d]
    const newPlan = parseInt(editForm.value.datePlans[d]) || 0
    if (dd) {
      dd.plan = newPlan
      dd.diff = dd.actual - newPlan
    }
    newTotal += newPlan
  }
  row.totalPlan = newTotal
  row.totalDiff = row.totalActual - row.totalPlan

  try {
    await api.post('/schedule/template-daily-plan/plan', {
      style_no: row.style_no,
      color: row.color,
      size_spec: row.size_spec,
      order_qty: row.order_qty,
      datePlans: editForm.value.datePlans,
    })
    ElMessage.success('保存成功')
  } catch (e) {
    console.error('保存计划失败:', e)
    ElMessage.error('保存失败')
  }
  editingKey.value = null
  editForm.value = {}
}

// Drag-to-scroll 已删除（虚拟滚动用滚轮/触摸板即可）

function scrollToTop() {
  const el = document.querySelector('.vt-container, .excel-body, .excel-wrap')
  if (el) el.scrollTop = 0
}

onMounted(async () => {
  await load()
})
</script>

<template>
  <div class="template-detail">
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="emit('back')"><span style="margin-right:4px">←</span> 返回</el-button>
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
      </div>
    </div>

    <div v-if="!planRows.length" style="text-align:center;padding:60px;color:var(--text-tertiary)">
      暂无模板排程数据
      <div style="margin-top:12px;font-size:12px;color:var(--text-tertiary)">
        需要：1. 款式管理中有模板款式 2. 面料装柜清单存在该款式 3. 预排总计划有模板日期
      </div>
    </div>

    <div v-else ref="vs.container" class="excel-wrap" @scroll="vs.onScroll">
      <table class="excel-table">
        <thead>
          <tr>
            <th class="fix" style="min-width:95px"><div class="col-header"><span>款号</span>
              <TextFilter :data="planRows" field="style_no" @filter="f => onTextFilter('style_no', f)"
                :sortField="sortState.field==='style_no' ? sortState.sortBy : ''" :sortDir="sortState.field==='style_no' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('style_no')" />
            </div></th>
            <th class="fix" style="min-width:120px"><div class="col-header"><span>品名</span>
              <TextFilter :data="planRows" field="product_name" @filter="f => onTextFilter('product_name', f)"
                :sortField="sortState.field==='product_name' ? sortState.sortBy : ''" :sortDir="sortState.field==='product_name' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('product_name')" />
            </div></th>
            <th class="fix" style="min-width:65px"><div class="col-header"><span>颜色</span>
              <TextFilter :data="planRows" field="color" @filter="f => onTextFilter('color', f)"
                :sortField="sortState.field==='color' ? sortState.sortBy : ''" :sortDir="sortState.field==='color' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('color')" />
            </div></th>
            <th class="fix" style="min-width:60px"><div class="col-header"><span>尺码</span>
              <TextFilter :data="planRows" field="size_spec" @filter="f => onTextFilter('size_spec', f)"
                :sortField="sortState.field==='size_spec' ? sortState.sortBy : ''" :sortDir="sortState.field==='size_spec' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('size_spec')" />
            </div></th>
            <th class="fix" style="min-width:70px"><div class="col-header"><span>原单量</span>
              <NumberFilter :data="planRows" field="order_qty" @filter="f => onNumFilter('order_qty', f)"
                :sortField="sortState.field==='order_qty' ? sortState.sortBy : ''" :sortDir="sortState.field==='order_qty' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('order_qty')" />
            </div></th>
            <th class="fix" style="min-width:70px"><div class="col-header"><span>合计</span></div></th>
            <th class="fix" style="min-width:50px"><div class="col-header"><span>类型</span></div></th>
            <th v-for="d in visibleDates" :key="d" class="date-th" :class="{ 'today-col': d === today }">{{ dateLabel(d) }}</th>
            <th class="fix" style="min-width:80px"><div class="col-header"><span>操作</span></div></th>
          </tr>
        </thead>
        <tbody>
          <!-- 顶部占位 -->
          <tr v-if="vtStartIndex > 0" :style="{ height: (vtStartIndex * vs.rowHeight) + 'px' }">
            <td :colspan="8 + visibleDates.length" style="padding:0;border:0"></td>
          </tr>
          <template v-for="row in vtVisibleRows" :key="row._key">
            <!-- 折叠汇总行 -->
            <tr v-if="row._type === 'summary'" class="row-plan collapsed-row" :class="{ 'group-start': row.firstOfGroup }">
              <td class="fix first-group">
                <span class="collapse-btn" @click="toggleCollapse(row.style_no)">▶</span>
                {{ row.style_no }}
              </td>
              <td class="fix first-group">{{ row.product_name }}</td>
              <td class="fix" colspan="2" style="text-align:left;color:var(--text-tertiary);font-size:12px">共 {{ groupRowCount(row.style_no) }} 条颜色尺码</td>
              <td class="fix num">{{ row.order_qty?.toLocaleString() }}</td>
              <td class="fix num sum-cell">{{ row.totalPlan?.toLocaleString() }}</td>
              <td class="fix type-label plan-label">汇总</td>
              <td v-for="d in visibleDates" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today }">{{ (row.dateMap[d] || {}).plan || '' }}</td>
              <td class="fix"></td>
            </tr>
            <!-- 展开：计划行 -->
            <tr v-else-if="row._type === 'plan'" class="row-plan" :class="{ 'group-start': row.firstOfGroup, 'editing-row': isEditing(row) }">
              <td class="fix" :class="{ 'first-group': row.firstOfGroup }">
                <span v-if="row.firstOfGroup" class="collapse-btn" @click="toggleCollapse(row.style_no)">▼</span>
                {{ row.firstOfGroup ? row.style_no : '' }}
              </td>
              <td class="fix" :class="{ 'first-group': row.firstOfGroup }">{{ row.firstOfGroup ? row.product_name : '' }}</td>
              <td class="fix">{{ row.color }}</td>
              <td class="fix">{{ row.size_spec }}</td>
              <td class="fix num">
                <template v-if="isEditing(row)"><input class="cell-inp" type="number" min="0" v-model.number="editForm.order_qty" style="width:60px" /></template>
                <template v-else>{{ row.order_qty?.toLocaleString() }}</template>
              </td>
              <td class="fix num sum-cell">{{ row.totalPlan?.toLocaleString() }}</td>
              <td class="fix type-label plan-label">计划</td>
              <td v-for="d in visibleDates" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today, 'editable-cell': isEditing(row) }">
                <template v-if="isEditing(row)"><input class="cell-inp" type="number" min="0" v-model.number="editForm.datePlans[d]" /></template>
                <template v-else>{{ (row.dateMap[d] || {}).plan || '' }}</template>
              </td>
              <td class="fix">
                <template v-if="isEditing(row)">
                  <el-button size="small" text type="primary" @click="savePlanEdit(row)">保存</el-button>
                  <el-button size="small" text @click="cancelEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button size="small" text type="primary" @click="startEdit(row)">编辑</el-button>
                </template>
              </td>
            </tr>
            <!-- 实际行 -->
            <tr v-else-if="row._type === 'actual'" class="row-actual">
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix num sum-cell">{{ row.totalActual?.toLocaleString() }}</td>
              <td class="fix type-label actual-label">实际</td>
              <td v-for="d in visibleDates" :key="'a'+d" class="cell-num editable-cell" :class="{ 'today-col': d === today }">
                <input
                  class="cell-inp"
                  type="number"
                  min="0"
                  :value="(row.dateMap[d] || {}).actual || ''"
                  @change="e => {
                    const dd = row.dateMap[d]
                    if (dd) { dd.actual = parseInt(e.target.value) || 0 }
                    saveActual(row, d)
                  }"
                />
              </td>
              <td class="fix"></td>
            </tr>
            <!-- 差异行 -->
            <tr v-else class="row-diff">
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix num sum-cell" :class="{ 'diff-pos': row.totalDiff > 0, 'diff-neg': row.totalDiff < 0 }">{{ row.totalDiff > 0 ? '+' : '' }}{{ row.totalDiff?.toLocaleString() }}</td>
              <td class="fix type-label diff-label">差异</td>
              <td v-for="d in visibleDates" :key="'f'+d" class="cell-num" :class="{ 'today-col': d === today }">
                <span :class="{ 'diff-pos': (row.dateMap[d] || {}).diff > 0, 'diff-neg': (row.dateMap[d] || {}).diff < 0 }">
                  {{ (() => { const v = (row.dateMap[d] || {}).diff; return v > 0 ? '+' + v : v; })() || '' }}
                </span>
              </td>
              <td class="fix"></td>
            </tr>
          </template>
          <!-- 底部占位 -->
          <tr v-if="(vtStartIndex + vtVisibleRows.length) < tableRows.length" :style="{ height: ((tableRows.length - vtStartIndex - vtVisibleRows.length) * vs.rowHeight) + 'px' }">
            <td :colspan="8 + visibleDates.length" style="padding:0;border:0"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>
  </div>

  <!-- 新增排程弹窗 -->
  <el-dialog v-model="dialogVisible" title="新增模板排程" width="520px">
    <el-form :model="form" label-width="90px" size="small">
      <el-row :gutter="12">
        <el-col :span="12"><el-form-item label="款号"><el-input v-model="form.style_no" placeholder="例：NTJ62633" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="颜色"><el-input v-model="form.color" placeholder="例：K 黑" /></el-form-item></el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12"><el-form-item label="尺码"><el-input v-model="form.size_spec" placeholder="例：140" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="原单量"><el-input-number v-model="form.plan_qty" :min="1" style="width:100%" /></el-form-item></el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12"><el-form-item label="模板上线"><el-input v-model="form.plan_start" type="date" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="模板日产量"><el-input-number v-model="form.daily_target" :min="1" :step="100" style="width:100%" /></el-form-item></el-col>
      </el-row>
    </el-form>
    <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" @click="create">创建</el-button></template>
  </el-dialog>

  <!-- 导入Excel弹窗 -->
  <el-dialog v-model="importDialogVisible" title="导入Excel" width="600px">
    <div style="margin-bottom:12px">
      <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
      <span v-if="importFile" style="margin-left:8px;color:var(--primary-dark)">{{ importFile.name }}</span>
    </div>
    <div v-if="importFile" style="margin-bottom:12px">
      <el-button @click="doImport" type="primary" :loading="importing">解析预览</el-button>
      <el-radio-group v-model="importMode" style="margin-left:12px">
        <el-radio value="skip">跳过重复</el-radio>
        <el-radio value="overwrite">覆盖已有</el-radio>
      </el-radio-group>
    </div>
    <div v-if="importPreview?.length" style="max-height:300px;overflow:auto">
      <div style="margin-bottom:4px;font-size:12px;color:var(--text-secondary)">共 {{ importPreview.length }} 条</div>
      <el-table :data="importPreview" size="small" border max-height="220">
        <el-table-column label="款号" width="100"><template #default="{row}">{{ row['款号'] }}</template></el-table-column>
        <el-table-column label="颜色" width="80"><template #default="{row}">{{ row['颜色'] }}</template></el-table-column>
        <el-table-column label="尺码" width="60"><template #default="{row}">{{ row['尺码'] }}</template></el-table-column>
        <el-table-column label="原单量" width="80"><template #default="{row}">{{ row['原单量'] }}</template></el-table-column>
        <el-table-column label="开始" width="95"><template #default="{row}">{{ row['模板开始'] }}</template></el-table-column>
      </el-table>
    </div>
    <template #footer>
      <el-button @click="importDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="confirmImport" :loading="importing" :disabled="!importPreview?.length">确认导入</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.template-detail { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); gap: 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: center; flex-shrink: 0; }
.header-nav { display: flex; align-items: center; gap: 8px; justify-content: center; flex: 1; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
.data-source-hint { font-size: 11px; color: var(--text-tertiary); background: var(--bg); padding: 4px 8px; border-radius: var(--radius-sm); }

.nav-arrows { display: flex; align-items: center; gap: 4px; }
.nav-btn {
  padding: 6px 12px; background: var(--primary); color: #fff; border: none;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-weight: 500;
  transition: var(--transition); line-height: 1;
}
.nav-btn:hover { background: var(--primary-dark); }
.nav-btn.today-btn { font-weight: 600; padding: 6px 14px; }
.date-range-label { font-size: 14px; font-weight: 600; color: var(--text); min-width: 120px; text-align: center; margin-left: 4px; }

.excel-wrap {
  flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card);
}
.excel-wrap.dragging, .excel-wrap.dragging td, .excel-wrap.dragging th { user-select: none !important; }

.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); min-width: 100%; }
.excel-table thead th {
  padding: 0; background: var(--card); color: var(--text-tertiary); font-size: 11px; font-weight: 500;
  letter-spacing: 0.3px; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;
  position: sticky; top: 0; z-index: 3;
}
.excel-table td {
  padding: 10px 14px; border-bottom: 1px solid var(--border-light); white-space: nowrap; text-align: center;
}
.excel-table td:nth-child(1),
.excel-table td:nth-child(2),
.excel-table td:nth-child(3) { text-align: left; }
.excel-table th:nth-child(1),
.excel-table th:nth-child(2),
.excel-table th:nth-child(3) { text-align: left; }
.col-header {
  display: flex; flex-direction: row; align-items: center;
  justify-content: flex-start; padding: 10px 14px; gap: 4px;
}
.col-header span { font-weight: 500; font-size: 11px; flex-shrink: 0; color: var(--text-tertiary); letter-spacing: 0.3px; }

.row-plan { background: #f5f0ff; }
.row-actual { background: #f0fff4; }
.row-diff { background: #fffaf0; }
.editing-row { background: #fff3cd !important; }
.collapsed-row { background: #f8f5ff !important; opacity: 0.85; }
.editing-row .fix { background: #fff3cd !important; }
.row-diff td { border-bottom: 2px solid var(--border); }
.first-group td { border-top: 2px solid var(--primary); }
.collapse-btn { cursor: pointer; user-select: none; margin-right: 4px; font-size: 10px; color: var(--text-tertiary); transition: color 0.15s; }
.collapse-btn:hover { color: var(--primary); }

tbody tr:hover td:not(.fix) { background: var(--primary-light); }

.fix { position: sticky; left: 0; z-index: 1; background: inherit; }
.row-plan .fix { background: #f5f0ff; }
.row-actual .fix { background: #f0fff4; }
.row-diff .fix { background: #fffaf0; }
.excel-table thead .fix { z-index: 4; background: var(--card); }

.date-th { min-width: 50px; width: 50px; }
.excel-table .today-col {
  background: #e0d4ff !important; box-shadow: inset 3px 0 0 var(--primary); text-align: center !important;
}
.excel-table thead .today-col {
  background: #e0d4ff !important; color: var(--primary) !important; font-weight: 700 !important;
}
.num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }
.sum-cell { font-weight: 700; }
.type-label { font-weight: 600; font-size: 12px; }
.plan-label { color: #7c3aed; }
.actual-label { color: #059669; }
.diff-label { color: #d97706; }
.diff-pos { color: #059669; font-weight: 600; }
.diff-neg { color: #dc2626; font-weight: 600; }
.cell-num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }
.editable-cell { padding: 2px 4px !important; }
.cell-inp {
  width: 48px; padding: 4px 6px; border: 1px solid transparent; border-radius: 4px;
  text-align: center; font-size: 13px; font-variant-numeric: tabular-nums;
  font-family: 'Helvetica Neue', Arial, sans-serif; background: transparent;
  transition: border-color 0.15s;
}
.cell-inp:hover { border-color: var(--border); }
.cell-inp:focus { border-color: var(--primary); outline: none; background: #fff; }
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
