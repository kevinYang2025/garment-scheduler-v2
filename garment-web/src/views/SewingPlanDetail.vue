<script setup>
// Excel列映射严格按照用户提供的《缝制排程模板.xlsx》调整
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import DateFilter from '../components/DateFilter.vue'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'
import StylePicker from '../components/StylePicker.vue'

const emit = defineEmits(['back'])

const masters = ref([])
const dailyData = ref({})
const dialogVisible = ref(false)
const form = ref({})
const selectedStyle = ref(null)

// Inline edit
const editingId = ref(null)
const editForm = ref({})

function startEdit(g) {
  editingId.value = g.master.id
  editForm.value = { ...g.master }
}
function cancelEdit() {
  editingId.value = null
  editForm.value = {}
}

// 缝制结束 = 缝制开始 + ceil(裁床计划数量 / 目标日产量) 天
function calcPlanEnd(start, qty, daily) {
  if (!start || !qty || !daily) return ''
  const days = Math.ceil(qty / daily)
  const d = new Date(start + 'T00:00:00')
  d.setDate(d.getDate() + days - 1)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// 编辑时自动计算缝制结束
watch(() => [editForm.value.plan_start, editForm.value.cutting_plan_qty, editForm.value.daily_target], () => {
  if (!editingId.value) return
  const v = calcPlanEnd(editForm.value.plan_start, editForm.value.cutting_plan_qty, editForm.value.daily_target)
  if (v) editForm.value.plan_end = v
})

// 新增弹窗自动计算缝制结束
watch(() => [form.value.plan_start, form.value.cutting_plan_qty, form.value.daily_target], () => {
  const v = calcPlanEnd(form.value.plan_start, form.value.cutting_plan_qty, form.value.daily_target)
  if (v) form.value.plan_end = v
})
async function saveEdit() {
  try {
    console.log('saveEdit sending:', JSON.stringify(editForm.value).slice(0, 300))
    await api.updateSchedule('sewing', editForm.value.id, editForm.value)
    ElMessage.success('修改成功')
    editingId.value = null
    await load()
    await loadAllDaily()
  } catch (e) {
    console.error('saveEdit error:', e, e.response?.data)
    ElMessage.error('修改失败: ' + (e.response?.data?.detail || e.message))
  }
}

const importDialogVisible = ref(false)
const importFile = ref(null)
const importPreview = ref(null)
const importing = ref(false)
const importMode = ref('skip')

// Filter states
const textFilters = ref({})
const dateFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

function onTextFilter(field, f) {
  textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } }
}
function onDateFilter(field, f) {
  dateFilters.value = { ...dateFilters.value, [field]: { validDates: f.validDates, hasEmpty: f.hasEmpty } }
}
function onSort(field, sortBy, dir) {
  sortState.value = { field, sortBy, dir }
}

// Filtered & sorted masters
const filteredMasters = computed(() => {
  let list = masters.value.slice()

  // Text filters
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

  // Date filters
  for (const [field, f] of Object.entries(dateFilters.value)) {
    if (!f || ((!f.validDates || f.validDates.size === 0) && !f.hasEmpty)) continue
    list = list.filter(r => {
      const d = r[field] ? (r[field].includes('T') ? r[field].slice(0,10) : r[field]) : ''
      if (d && f.validDates && !f.validDates.has(d)) return false
      if (!d && !f.hasEmpty) return false
      return true
    })
  }

  // Sort
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
        va = a[field] ? (a[field].includes('T') ? a[field].slice(0,10) : a[field]) : ''
        vb = b[field] ? (b[field].includes('T') ? b[field].slice(0,10) : b[field]) : ''
        return va.localeCompare(vb) * mul
      }
      va = a[field] || ''
      vb = b[field] || ''
      return va.localeCompare(vb, 'zh') * mul
    })
  }

  return list
})

// Compute date range
const dateCols = computed(() => {
  if (!masters.value.length) return []
  let min = null, max = null
  for (const m of masters.value) {
    if (m.plan_start && (!min || m.plan_start < min)) min = m.plan_start
    if (m.plan_end && (!max || m.plan_end > max)) max = m.plan_end
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

const groups = computed(() => {
  return filteredMasters.value.map(m => {
    const dd = dailyData.value[m.id] || []
    const planSum = dateCols.value.reduce((s, date) => s + dailyQty(m.id, date, 'plan'), 0)
    const actualSum = dd.reduce((s, r) => s + (r.actual || 0), 0)
    return { master: m, daily: dd, planSum, actualSum }
  })
})

async function load() {
  try {
    const { data } = await api.getSchedule('sewing')
    masters.value = data || []
  } catch { ElMessage.error('加载排程失败') }
}

async function loadAllDaily() {
  const ids = masters.value.filter(m => !dailyData.value[m.id]).map(m => m.id)
  if (!ids.length) return
  const results = await Promise.allSettled(
    ids.map(id => api.getScheduleDaily('sewing', id).then(r => ({ id, data: r.data })))
  )
  for (const r of results) {
    if (r.status === 'fulfilled') dailyData.value[r.value.id] = r.value.data || []
  }
}

function dailyQty(masterId, date, rt) {
  const dd = dailyData.value[masterId]
  const apiRow = dd ? dd.find(d => d.date === date) : null

  if (rt === 'plan') {
    // API数据优先
    if (apiRow && apiRow.plan) return apiRow.plan
    // 按目标日产量自动分配，总数不超过计划数
    const m = masters.value.find(x => x.id === masterId)
    const totalQty = m && (m.cutting_plan_qty || m.plan_qty)
    if (m && m.plan_start && m.plan_end && m.daily_target && totalQty && date >= m.plan_start && date <= m.plan_end) {
      // 计算该款在计划范围内的第几天（从0开始）
      const sd = new Date(m.plan_start + 'T00:00:00')
      const cd = new Date(date + 'T00:00:00')
      const dayIdx = Math.floor((cd - sd) / 86400000)
      const fullDays = Math.floor(totalQty / m.daily_target)
      const remainder = totalQty % m.daily_target
      if (dayIdx < fullDays) return m.daily_target
      if (dayIdx === fullDays && remainder > 0) return remainder
      return 0
    }
    return 0
  }

  // 实际行只从API数据读取
  return apiRow ? (apiRow.actual || 0) : 0
}

function formatQty(v) { return v != null ? v.toLocaleString() : '0' }
function colorFor(v) { if (v > 0) return 'var(--success)'; if (v < 0) return 'var(--danger)'; return 'var(--text-tertiary)' }

// 今天日期（本地时间）
const _td = new Date()
const today = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,'0')}-${String(_td.getDate()).padStart(2,'0')}`

// 日期窗口：默认显示 today-7 到 today+21，箭头滚动切换
const viewOffset = ref(0)
function shiftWeek(dir) { viewOffset.value += dir * 7 }

const visibleDateCols = computed(() => {
  const d = new Date(today + 'T00:00:00')
  const ws = new Date(d); ws.setDate(ws.getDate() - 7 + viewOffset.value)
  const we = new Date(d); we.setDate(we.getDate() + 21 + viewOffset.value)
  const wsStr = `${ws.getFullYear()}-${String(ws.getMonth()+1).padStart(2,'0')}-${String(ws.getDate()).padStart(2,'0')}`
  const weStr = `${we.getFullYear()}-${String(we.getMonth()+1).padStart(2,'0')}-${String(we.getDate()).padStart(2,'0')}`
  return dateCols.value.filter(c => c >= wsStr && c <= weStr)
})

// 日差异：当天实际-当天计划，仅<=今天有效
function dailyDiffVal(masterId, date) {
  if (date > today) return null
  return dailyQty(masterId, date, 'actual') - dailyQty(masterId, date, 'plan')
}

// 日差异合计：截止今天的所有日差异之和
function dailyDiffSum(masterId) {
  let sum = 0
  for (const d of dateCols.value) {
    if (d > today) break
    sum += dailyQty(masterId, d, 'actual') - dailyQty(masterId, d, 'plan')
  }
  return sum
}
function dateLabel(d) { return d ? d.slice(5) : '' }

function openCreate() {
  form.value = { style_id: null, style_no: '', product_name: '', color: '', size_spec: '',
    plan_qty: 0, cutting_plan_qty: 0, due_date: '', daily_target: 0,
    plan_start: '', plan_end: '', workshop: '', line_team: '' }
  selectedStyle.value = null
  dialogVisible.value = true
}

function onStyleSelect(style) {
  selectedStyle.value = style
  form.value.style_id = style.id
  form.value.style_no = style.style_no
  form.value.product_name = style.product_name
  form.value.color = style.color
  form.value.size_spec = style.size_spec
  form.value.cutting_plan_qty = style.plan_qty || 0
  form.value.due_date = style.due_date || ''
}

async function create() {
  if (!selectedStyle.value) { ElMessage.warning('请先选择款式'); return }
  try {
    await api.createSchedule('sewing', { ...form.value, schedule_type: 'sewing' })
    dialogVisible.value = false
    ElMessage.success('创建成功')
    await load()
    await loadAllDaily()
  } catch (e) { ElMessage.error('创建失败') }
}

async function remove(id) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    await api.deleteSchedule('sewing', id)
    dailyData.value[id] = null
    await load()
  } catch (e) { if (e !== 'cancel') ElMessage.error('删除失败') }
}

async function updateDailyActual(masterId, date, val) {
  if (date > today) { ElMessage.warning('不能填写未来日期的实际产量'); return }
  try {
    const m = masters.value.find(x => x.id === masterId)
    await api.saveActual({
      schedule_type: 'sewing', style_id: m?.style_id || 0, style_no: m?.style_no || '',
      color: '', size_spec: '', production_date: date,
      completed_qty: parseInt(val) || 0, defect_qty: 0,
      workshop: m?.workshop || '', line_team: m?.line_team || '', remark: ''
    })
    const { data } = await api.getScheduleDaily('sewing', masterId)
    dailyData.value[masterId] = data || []
  } catch { ElMessage.error('更新失败') }
}

function doExport() { window.open('/api/schedule/sewing/export', '_blank') }

function onImportFileChange(e) { importFile.value = e.target.files[0] }

async function doImport() {
  if (!importFile.value) return
  if (importing.value) return  // 防止重复提交
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
    let cur = null
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c == null)) continue
      const rt = String(row[10] || '').trim()
      if (rt === '计划' || rt === 'PLAN') {
        cur = {
          '车间': row[0], '班组': row[1], '款号': row[2], '品名': row[3],
          '裁床计划数量': parseInt(row[4]) || 0, '交期': row[5],
          '目标日产量': parseInt(row[6]) || 0, '缝制开始日期': row[7], '缝制结束日期': row[8],
          '每日明细': {}
        }
        for (let j = 12; j < row.length; j++) {
          const date = headers[j - 1]  // 表头日期在L列(11)，数据值在M列(12)开始
          if (date && String(date).match(/^\d{4}-\d{2}-\d{2}$/)) {
            cur['每日明细'][date] = { PLAN: parseInt(row[j]) || 0, ACTUAL: 0 }
          }
        }
        records.push(cur)
      } else if ((rt === '实际QC1' || rt === 'ACTUAL') && cur) {
        for (let j = 12; j < row.length; j++) {
          const date = headers[j - 1]
          if (date && String(date).match(/^\d{4}-\d{2}-\d{2}$/)) {
            if (!cur['每日明细'][date]) cur['每日明细'][date] = {}
            cur['每日明细'][date].ACTUAL = parseInt(row[j]) || 0
          }
        }
      }
    }
    importPreview.value = records
  } catch (e) { ElMessage.error('解析失败: ' + e.message) }
  importing.value = false
}

async function confirmImport() {
  if (!importPreview.value?.length) return
  importing.value = true
  try {
    const { data } = await api.importSchedule('sewing', importPreview.value, importMode.value)
    ElMessage.success(`导入完成: ${data.imported} 条, 跳过 ${data.skipped} 条`)
    importDialogVisible.value = false
    importPreview.value = null
    importFile.value = null
    await load()
    await loadAllDaily()
  } catch (e) { ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message)) }
  importing.value = false
}

// Drag-to-scroll on empty td areas
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
  e.preventDefault()
}
function onDragMove(e) {
  if (!dragging || !dragWrap) return
  dragWrap.scrollLeft = dragSL - (e.pageX - dragX)
  dragWrap.scrollTop = dragST - (e.pageY - dragY)
}
function onDragEnd() { dragging = false; dragWrap = null }

onMounted(async () => {
  await load()
  await loadAllDaily()
  // Drag-to-scroll on body
  const body = bodyRef.value
  if (body) {
    body.addEventListener('mousedown', onDragStart)
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }
})
onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <div class="sewing-detail">
    <!-- 顶部操作栏 -->
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="emit('back')"><span style="margin-right:4px">←</span> 返回</el-button>
      </div>
      <div class="header-actions">
        <el-button type="primary" @click="importDialogVisible = true">导入Excel</el-button>
        <el-button @click="doExport">导出Excel</el-button>
        <el-button type="success" @click="openCreate">+ 新增排程</el-button>
      </div>
    </div>

    <div v-if="!masters.length" style="text-align:center;padding:60px;color:var(--text-tertiary)">
      暂无排程数据，点击"新增排程"或"导入Excel"开始
    </div>

    <!-- Excel-style table -->
    <div v-else ref="bodyRef" class="excel-wrap">
      <table class="excel-table">
        <thead>
          <tr>
            <!-- 车间 -->
            <th class="fix" style="min-width:70px">
              <div class="col-header"><span>车间</span>
                <TextFilter :data="masters" field="workshop" @filter="f => onTextFilter('workshop', f)"
                  :sortField="sortState.field==='workshop' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='workshop' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 班组 -->
            <th class="fix" style="min-width:70px">
              <div class="col-header"><span>班组</span>
                <TextFilter :data="masters" field="line_team" @filter="f => onTextFilter('line_team', f)"
                  :sortField="sortState.field==='line_team' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='line_team' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 款号 -->
            <th class="fix" style="width:80px"><span>状态</span></th>
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>款号</span>
                <TextFilter :data="masters" field="style_no" @filter="f => onTextFilter('style_no', f)"
                  :sortField="sortState.field==='style_no' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='style_no' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 品名 -->
            <th class="fix" style="min-width:140px">
              <div class="col-header"><span>品名</span>
                <TextFilter :data="masters" field="product_name" @filter="f => onTextFilter('product_name', f)"
                  :sortField="sortState.field==='product_name' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='product_name' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 裁床计划数量 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>裁床计划数量</span>
                <NumberFilter :data="masters" field="cutting_plan_qty"
                  @filter="f => onTextFilter('cutting_plan_qty', f)"
                  :sortField="sortState.field==='cutting_plan_qty' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='cutting_plan_qty' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 交期 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>交期</span>
                <DateFilter :data="masters" field="due_date" @filter="f => onDateFilter('due_date', f)"
                  :sortField="sortState.field==='due_date' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='due_date' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 目标日产量 -->
            <th class="fix" style="min-width:90px">
              <div class="col-header"><span>目标日产量</span>
                <NumberFilter :data="masters" field="daily_target"
                  @filter="f => onTextFilter('daily_target', f)"
                  :sortField="sortState.field==='daily_target' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='daily_target' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 缝制开始日期 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>缝制开始</span>
                <DateFilter :data="masters" field="plan_start" @filter="f => onDateFilter('plan_start', f)"
                  :sortField="sortState.field==='plan_start' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='plan_start' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 缝制结束日期 -->
            <th class="fix" style="min-width:100px">
              <div class="col-header"><span>缝制结束</span>
                <DateFilter :data="masters" field="plan_end" @filter="f => onDateFilter('plan_end', f)"
                  :sortField="sortState.field==='plan_end' ? sortState.sortBy : ''"
                  :sortDir="sortState.field==='plan_end' ? sortState.dir : 'asc'"
                  @sort="e => onSort(e.field, e.sortBy, e.dir)" />
              </div>
            </th>
            <!-- 合计 -->
            <th class="fix" style="min-width:80px"><div class="col-header"><span>合计</span></div></th>
            <!-- 类型标签 -->
            <th class="fix" style="min-width:80px"><div class="col-header"><span class="arrow-btn" @click="shiftWeek(-1)" title="往前一周">‹</span><span class="arrow-btn today-btn" @click="viewOffset=0" title="回到今天">◎</span></div></th>
            <!-- 日期列 -->
            <th v-for="d in visibleDateCols" :key="d" class="date-th" :class="{ 'today-col': d === today }">{{ dateLabel(d) }}</th>
            <!-- 操作 -->
            <th class="fix" style="min-width:60px"><div class="col-header"><span>操作</span><span class="arrow-btn" @click="shiftWeek(1)" title="往后一周">›</span></div></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(g, gi) in groups" :key="g.master.id">
            <!-- 计划行 -->
            <tr class="row-plan" :class="{ 'editing-row': editingId === g.master.id }">
              <td class="fix">
                <template v-if="editingId === g.master.id"><input class="inp" v-model="editForm.workshop" /></template>
                <template v-else>{{ g.master.workshop || '' }}</template>
              </td>
              <td class="fix">
                <template v-if="editingId === g.master.id"><input class="inp" v-model="editForm.line_team" /></template>
                <template v-else>{{ g.master.line_team || '' }}</template>
              </td>
              <td class="fix" style="width:80px">
                <el-tag v-if="g.master.task_status === 'COMPLETED'" type="success" size="small">已完成</el-tag>
                <el-tag v-else-if="g.master.task_status === 'IN_PROGRESS'" type="primary" size="small">进行中</el-tag>
                <el-tag v-else type="info" size="small">待生产</el-tag>
                <div v-if="g.master.progress_pct > 0" class="progress-mini">
                  <div class="progress-bar" :style="{ width: g.master.progress_pct + '%' }"></div>
                </div>
              </td>
              <td class="fix">{{ g.master.style_no }}</td>
              <td class="fix">{{ g.master.product_name }}</td>
              <td class="fix num">
                <template v-if="editingId === g.master.id"><input class="inp" v-model.number="editForm.cutting_plan_qty" type="number" min="1" style="text-align:right" /></template>
                <template v-else>{{ formatQty(g.master.cutting_plan_qty || g.master.plan_qty) }}</template>
              </td>
              <td class="fix">
                <template v-if="editingId === g.master.id"><input class="inp" v-model="editForm.due_date" type="date" /></template>
                <template v-else>{{ g.master.due_date || '' }}</template>
              </td>
              <td class="fix num">
                <template v-if="editingId === g.master.id"><input class="inp" v-model.number="editForm.daily_target" type="number" min="1" style="text-align:right" /></template>
                <template v-else>{{ formatQty(g.master.daily_target) }}</template>
              </td>
              <td class="fix">
                <template v-if="editingId === g.master.id"><input class="inp" v-model="editForm.plan_start" type="date" /></template>
                <template v-else>{{ g.master.plan_start || '' }}</template>
              </td>
              <td class="fix">
                <template v-if="editingId === g.master.id"><span style="color:var(--text-secondary)">{{ editForm.plan_end || '自动计算' }}</span></template>
                <template v-else>{{ g.master.plan_end || '' }}</template>
              </td>
              <td class="fix num sum-cell">{{ formatQty(g.planSum) }}</td>
              <td class="fix type-label plan-label">计划</td>
              <td v-for="d in visibleDateCols" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today }">
                {{ formatQty(dailyQty(g.master.id, d, 'plan')) }}
              </td>
              <td class="fix">
                <template v-if="editingId === g.master.id">
                  <el-button size="small" text type="primary" @click="saveEdit">保存</el-button>
                  <el-button size="small" text @click="cancelEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button size="small" text @click="startEdit(g)">编辑</el-button>
                  <el-button size="small" text type="danger" @click="remove(g.master.id)">删除</el-button>
                </template>
              </td>
            </tr>
            <!-- 实际QC1行 -->
            <tr class="row-actual">
              <td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td>
              <td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td>
              <td class="fix num sum-cell">{{ formatQty(g.actualSum) }}</td>
              <td class="fix type-label" style="color:var(--success)">实际QC1</td>
              <td v-for="d in visibleDateCols" :key="'a'+d" class="cell-num cell-edit" :class="{ 'today-col': d === today }">
                <input type="number" class="inp-qty" :value="dailyQty(g.master.id, d, 'actual')"
                  :disabled="d > today"
                  @change="e => updateDailyActual(g.master.id, d, e.target.value)" min="0" />
              </td>
              <td class="fix"></td>
            </tr>
            <!-- 日差异行 -->
            <tr class="row-diff">
              <td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td>
              <td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td><td class="fix"></td>
              <td class="fix num sum-cell" :style="{color: colorFor(dailyDiffSum(g.master.id))}">
                {{ dailyDiffSum(g.master.id) > 0 ? '+' : '' }}{{ formatQty(dailyDiffSum(g.master.id)) }}
              </td>
              <td class="fix type-label" style="color:var(--warning)">日差异</td>
              <td v-for="d in visibleDateCols" :key="'dd'+d" class="cell-num" :class="{ 'today-col': d === today }"
                :style="{color: colorFor(dailyDiffVal(g.master.id, d))}">
                <template v-if="dailyDiffVal(g.master.id, d) != null">{{ dailyDiffVal(g.master.id, d) > 0 ? '+' : '' }}{{ formatQty(dailyDiffVal(g.master.id, d)) }}</template>
                <template v-else>—</template>
              </td>
              <td class="fix"></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 新增弹窗 -->
    <el-dialog v-model="dialogVisible" title="新增排程" width="520px">
      <el-form :model="form" label-width="90px" size="small">
        <el-form-item label="选择款式" required>
          <StylePicker :model-value="selectedStyle" @select="onStyleSelect" />
        </el-form-item>
        <el-form-item v-if="selectedStyle" label="已选款式">
          <span style="color:var(--primary-dark)">
            {{ selectedStyle.style_no }} - {{ selectedStyle.product_name }} {{ selectedStyle.color }} {{ selectedStyle.size_spec }}
          </span>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="车间"><el-input v-model="form.workshop" placeholder="例：一车间" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="班组"><el-input v-model="form.line_team" placeholder="例：1班" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="裁床计划数量"><el-input-number v-model="form.cutting_plan_qty" :min="1" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="目标日产量"><el-input-number v-model="form.daily_target" :min="1" :step="100" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="交期"><el-input v-model="form.due_date" type="date" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="缝制上线"><el-input v-model="form.plan_start" type="date" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="缝制下线"><span style="line-height:32px;color:var(--text-secondary)">{{ form.plan_end || '自动计算' }}</span></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" @click="create">创建</el-button></template>
    </el-dialog>

    <!-- 导入弹窗 -->
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
          <el-table-column label="车间" width="60"><template #default="{row}">{{ row['车间'] }}</template></el-table-column>
          <el-table-column label="班组" width="60"><template #default="{row}">{{ row['班组'] }}</template></el-table-column>
          <el-table-column label="款号" width="100"><template #default="{row}">{{ row['款号'] }}</template></el-table-column>
          <el-table-column label="品名" width="130"><template #default="{row}">{{ row['品名'] }}</template></el-table-column>
          <el-table-column label="裁床计划数量" width="100"><template #default="{row}">{{ row['裁床计划数量'] }}</template></el-table-column>
          <el-table-column label="开始" width="95"><template #default="{row}">{{ row['缝制开始日期'] }}</template></el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmImport" :loading="importing" :disabled="!importPreview?.length">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.sewing-detail { display: flex; flex-direction: column; height: 100%; }

.detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.header-left { display: flex; align-items: center; }
.header-actions { display: flex; gap: 8px; }

.excel-wrap {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  cursor: grab;
}
.excel-wrap:active { cursor: grabbing; }

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

.row-plan { background: var(--card); }
.row-actual { background: var(--bg); }
.row-diff { background: var(--card); }

tbody tr:hover td:not(.fix) { background: var(--primary-light); }
.editing-row td { background: var(--primary-light) !important; box-shadow: inset 3px 0 0 var(--primary); }
.editing-row td.fix:not(:first-child) { background: var(--primary-light) !important; }

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
/* 今天列高亮 */
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

.cell-edit { padding: 2px; }

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

.inp-qty {
  width: 56px;
  border: 1px solid transparent;
  text-align: right;
  font-size: 12px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  padding: 2px 4px;
  background: transparent;
  border-radius: 2px;
}
.inp-qty:focus {
  border-color: var(--primary);
  background: var(--card);
  outline: none;
  box-shadow: 0 0 0 2px rgba(0,0,0,.06);
}
.inp-qty:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
  opacity: 0.4;
}

.arrow-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-secondary);
  transition: all .15s;
  user-select: none;
  flex-shrink: 0;
}
.arrow-btn:hover {
  background: var(--primary-light);
  color: var(--primary);
}
.today-btn {
  font-size: 12px;
  color: var(--primary);
  font-weight: 800;
}
.today-btn:hover {
  background: var(--primary);
  color: white;
}
.progress-mini {
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  margin-top: 2px;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
  transition: width .3s ease;
}
</style>
