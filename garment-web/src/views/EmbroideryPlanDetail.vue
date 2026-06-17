<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import TextFilter from '../components/TextFilter.vue'
import { useVirtualScroll } from '../composables/useVirtualScroll'

// 虚拟滚动（行高 38px：10+14 padding + 13px font + 1px border）
const vs = useVirtualScroll(38, 8)
import NumberFilter from '../components/NumberFilter.vue'

const emit = defineEmits(['back'])

const planRows = ref([])
const dateRange = ref([])

// 筛选 & 排序
const textFilters = ref({})
const numFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

function onTextFilter(field, f) { textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } } }
function onNumFilter(field, f) { numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } } }
function isFilterActive(field) {
  return !!textFilters.value[field]?.applied || !!numFilters.value[field]?.applied
}
function onSort(field, sortBy, dir) { sortState.value = { field, sortBy, dir } }

const filteredPlanRows = computed(() => {
  let list = planRows.value.slice()
  for (const [field, f] of Object.entries(textFilters.value)) {
    if (!f || !f.applied) continue
    list = list.filter(r => {
      const val = r[field] || ''
      if (val && !f.checked.has(val)) return false
      if (!val && !f.includeEmpty) return false
      return true
    })
  }
  for (const [field, f] of Object.entries(numFilters.value)) {
    if (!f || !f.applied) continue
    list = list.filter(r => {
      const v = parseInt(r[field]) || 0
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
      if (sortBy === 'number') { va = parseInt(a[field]) || 0; vb = parseInt(b[field]) || 0 }
      else { va = a[field] || ''; vb = b[field] || '' }
      return va < vb ? -mul : va > vb ? mul : 0
    })
  }
  return list
})

// 日期窗口导航
const viewOffset = ref(0)
function shiftWeek(dir) { viewOffset.value += dir * 7 }

const _d = new Date()
const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`

// 可见日期列：从前一周到后三周，自行生成
const visibleDates = computed(() => {
  const d = new Date(today + 'T00:00:00')
  const ws = new Date(d); ws.setDate(ws.getDate() - 7 + viewOffset.value)
  const we = new Date(d); we.setDate(we.getDate() + 21 + viewOffset.value)
  const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
  const dates = []
  const cur = new Date(ws)
  while (cur <= we) { dates.push(fmt(cur)); cur.setDate(cur.getDate() + 1) }
  return dates
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

// 按款号分组 + 折叠汇总
const groupedRows = computed(() => {
  const styleGroups = {}
  for (const r of filteredPlanRows.value) {
    if (!styleGroups[r.style_no]) styleGroups[r.style_no] = { product_name: r.product_name, rows: [] }
    styleGroups[r.style_no].rows.push(r)
  }
  const result = []
  let lastStyle = ''
  for (const r of filteredPlanRows.value) {
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
    const { data } = await api.getEmbroideryDailyPlan()
    planRows.value = data.rows || []
    dateRange.value = data.dateRange || []
  } catch (e) {
    console.error('加载刺绣排程失败:', e)
    ElMessage.error('加载刺绣排程失败')
  }
}

async function saveActual(row, date) {
  const dd = row.dateData.find(d => d.date === date)
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
    await api.post('/schedule/embroidery-daily-plan/plan', {
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

// 导出
function doExport() {
  try {
    const XLSX = require('xlsx')  // fallback
  } catch {}
  // 简易CSV导出
  const headers = ['款号', '品名', '颜色', '尺码', '原单量', '合计(计划)', '合计(实际)', '合计(差异)', ...visibleDates.value.map(d => d.slice(5))]
  const lines = [headers.join(',')]
  for (const row of planRows.value) {
    const line = [
      row.style_no, row.product_name, row.color, row.size_spec,
      row.order_qty, row.totalPlan, row.totalActual, row.totalDiff,
      ...visibleDates.value.map(d => {
        const dd = row.dateData?.find(x => x.date === d)
        return dd ? dd.plan : ''
      })
    ]
    lines.push(line.map(v => `"${v ?? ''}"`).join(','))
  }
  const bom = '﻿'
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `刺绣排程_${today}.csv`; a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('导出成功')
}

// 导入实际产量
const importDialogVisible = ref(false)
const importFile = ref(null)
const importing = ref(false)
const importMode = ref('skip')
const importPreview = ref(null)

function onImportFileChange(e) { importFile.value = e.target.files[0] }

async function doImport() {
  if (!importFile.value) return
  if (importing.value) return
  importing.value = true
  try {
    const XLSX = await import('xlsx')
    const data = await importFile.value.arrayBuffer()
    const wb = XLSX.read(data, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    if (rows.length < 2) { importing.value = false; return ElMessage.error('格式不正确') }
    // 解析为实际产量记录
    const records = []
    for (const r of rows) {
      const styleNo = r['款号'] || r['style_no'] || ''
      const color = r['颜色'] || r['color'] || ''
      const sizeSpec = r['尺码'] || r['size_spec'] || r['规格'] || ''
      const date = r['日期'] || r['date'] || r['production_date'] || ''
      const qty = parseInt(r['数量'] || r['qty'] || r['completed_qty'] || 0)
      if (styleNo && date && qty > 0) {
        records.push({ style_no: styleNo, color, size_spec: sizeSpec, production_date: date, completed_qty: qty, schedule_type: 'secondary' })
      }
    }
    importPreview.value = records
  } catch (e) {
    ElMessage.error('文件解析失败: ' + (e.message || '请检查格式'))
    importPreview.value = null
  }
  importing.value = false
}

async function confirmImport() {
  if (!importPreview.value?.length) return
  importing.value = true
  try {
    const { data } = await api.importSchedule('secondary', importPreview.value, importMode.value)
    ElMessage.success(`导入完成: ${data.imported} 条, 跳过 ${data.skipped} 条`)
    importDialogVisible.value = false
    importPreview.value = null; importFile.value = null
    await load()
  } catch (e) { ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message)) }
  importing.value = false
}

// 新增排程弹窗
const createDialogVisible = ref(false)
const createForm = ref({ style_no: '', product_name: '', color: '', size_spec: '', plan_qty: 0, embroidery_start: '', embroidery_end: '' })

function openCreate() {
  createForm.value = { style_no: '', product_name: '', color: '', size_spec: '', plan_qty: 0, embroidery_start: today, embroidery_end: today }
  createDialogVisible.value = true
}

async function createSchedule() {
  if (!createForm.value.style_no) { ElMessage.warning('请填写款号'); return }
  try {
    await api.post('/schedule/secondary', {
      style_no: createForm.value.style_no,
      product_name: createForm.value.product_name,
      color: createForm.value.color,
      size_spec: createForm.value.size_spec,
      plan_qty: createForm.value.plan_qty,
      plan_start: createForm.value.embroidery_start,
      plan_end: createForm.value.embroidery_end,
      secondary_type: 'embroidery',
    })
    createDialogVisible.value = false
    ElMessage.success('新增成功')
    await load()
  } catch (e) { ElMessage.error('新增失败: ' + (e.response?.data?.error || e.message)) }
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
  <div class="embroidery-detail">
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
        <el-button type="primary" @click="importDialogVisible = true">导入实际产量</el-button>
        <el-button @click="doExport">导出Excel</el-button>
        <el-button type="success" @click="openCreate">+ 新增排程</el-button>
      </div>
    </div>

    <div v-if="!planRows.length" style="text-align:center;padding:60px;color:var(--text-tertiary)">
      暂无刺绣排程数据
      <div style="margin-top:12px;font-size:12px;color:var(--text-tertiary)">
        需要：1. 款式管理中有刺绣款式 2. 面料装柜清单存在该款式 3. 预排总计划有刺绣日期
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
    <div class="data-source-hint">数据来源：基础数据/款式管理 → 面料装柜清单 → 分色分尺码 → 预排总计划</div>

    <!-- 新增排程弹窗 -->
    <el-dialog v-model="createDialogVisible" title="新增刺绣排程" width="520px">
      <el-form :model="createForm" label-width="90px" size="small">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="款号" required><el-input v-model="createForm.style_no" placeholder="例：C3-E402" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="品名"><el-input v-model="createForm.product_name" placeholder="例：彩条长袖/前片刺绣" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="颜色"><el-input v-model="createForm.color" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="尺码"><el-input v-model="createForm.size_spec" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="原单量"><el-input-number v-model="createForm.plan_qty" :min="0" style="width:100%" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="刺绣上线"><el-input v-model="createForm.embroidery_start" type="date" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="刺绣下线"><el-input v-model="createForm.embroidery_end" type="date" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible=false">取消</el-button>
        <el-button type="primary" @click="createSchedule">创建</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入实际产量" width="600px">
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
          <el-table-column label="款号" width="100"><template #default="{row}">{{ row.style_no }}</template></el-table-column>
          <el-table-column label="颜色" width="60"><template #default="{row}">{{ row.color }}</template></el-table-column>
          <el-table-column label="尺码" width="60"><template #default="{row}">{{ row.size_spec }}</template></el-table-column>
          <el-table-column label="日期" width="95"><template #default="{row}">{{ row.production_date }}</template></el-table-column>
          <el-table-column label="数量" width="60"><template #default="{row}">{{ row.completed_qty }}</template></el-table-column>
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
.embroidery-detail { display: flex; flex-direction: column; height: 100%; }

.detail-header { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); gap: 12px; }
.header-left { display: flex; align-items: center; flex-shrink: 0; }
.header-nav { display: flex; align-items: center; gap: 8px; justify-content: center; flex: 1; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; margin-left: auto; }
.data-source-hint { font-size: 11px; color: var(--text-tertiary); background: var(--bg); padding: 4px 8px; border-radius: var(--radius-sm); margin-top: auto; }

.nav-arrows { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.nav-btn {
  padding: 6px 12px; background: var(--primary); color: #fff; border: none;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-weight: 500;
  transition: var(--transition); line-height: 1; white-space: nowrap; flex-shrink: 0;
}
.nav-btn:hover { background: var(--primary-dark); }
.nav-btn.today-btn { font-weight: 600; padding: 6px 14px; }
.date-range-label { font-size: 14px; font-weight: 600; color: var(--text); min-width: 120px; text-align: center; margin-left: 4px; white-space: nowrap; }

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
.editing-row .fix { background: #fff3cd !important; }
.row-diff td { border-bottom: 2px solid var(--border); }
.first-group td { border-top: 2px solid var(--primary); }
.collapse-btn { cursor: pointer; user-select: none; margin-right: 4px; font-size: 10px; color: var(--text-tertiary); transition: color 0.15s; }
.collapse-btn:hover { color: var(--primary); }
.collapsed-row { background: #f8f5ff !important; opacity: 0.85; }
.collapsed-row .fix { background: #f8f5ff !important; }

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
