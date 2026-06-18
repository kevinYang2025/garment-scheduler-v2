<script setup>
import { ref, computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { useVirtualScroll } from '../composables/useVirtualScroll'
import DateFilter from '../components/DateFilter.vue'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'

const props = defineProps({ db: Object, initialData: Array })

const columns = [
  { field: 'order_date', label: '接单日期', width: 110, type: 'date' },
  { field: 'style_no', label: '款号', width: 150, type: 'text' },
  { field: 'product_name', label: '品名', width: 140, type: 'text' },
  { field: 'style_category', label: '款式分类', width: 110, type: 'select', options: [
    '半袖+长袖', '风帽衫', '复杂连衣', '拉链衫', '连衣', '内衣裤', '拼缝连衣', '梭织裤', '梭织上衣', '长裤'
  ]},
  { field: 'fabric_code', label: '面料代号', width: 280, type: 'text' },
  { field: 'plan_qty', label: '成衣计划数量', width: 100, type: 'number' },
  { field: 'due_date', label: '交期', width: 110, type: 'date' },
  { field: 'embroidery', label: '是否刺绣', width: 80, type: 'text' },
  { field: 'embroidery_daily_output', label: '刺绣日产量', width: 90, type: 'number' },
  { field: 'printing', label: '是否印花', width: 80, type: 'text' },
  { field: 'printing_daily_output', label: '印花日产量', width: 90, type: 'number' },
  { field: 'ironing_label', label: '是否烫标', width: 80, type: 'text' },
  { field: 'ironing_daily_output', label: '烫标日产量', width: 90, type: 'number' },
  { field: 'template', label: '是否用模板', width: 80, type: 'text' },
  { field: 'template_daily_output', label: '模板日产量', width: 90, type: 'number' },
  { field: 'tt_time', label: 'TT时间', width: 80, type: 'text' },
  { field: 'target_daily_output', label: '缝制目标日产量', width: 110, type: 'number' },
  { field: 'remarks', label: '备注', width: 120, type: 'text' },
]

const bodyRef = ref(null)
const styles = ref(props.initialData || [])
const searchKeyword = ref('')
const loading = ref(false)
let searchTimer = null

const editingId = ref(null)
const editForm = ref({})

// Batch operations
const selectedIds = ref(new Set())
const isAllSelected = computed(() => filteredStyles.value.length > 0 && filteredStyles.value.every(r => selectedIds.value.has(r.id)))
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
    selectedIds.value = new Set(filteredStyles.value.map(r => r.id))
  }
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.size} 条款式？`, '批量删除', { type: 'warning' })
    const ids = [...selectedIds.value]
    let ok = 0, fail = 0
    for (const id of ids) {
      try { await api.deleteStyle(id); ok++ } catch { fail++ }
    }
    selectedIds.value = new Set()
    ElMessage.success(`删除完成：${ok} 成功，${fail} 失败`)
    loadStyles()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('批量删除失败')
  }
}

const batchDialogVisible = ref(false)
const batchForm = ref({})
const batchFields = [
  { field: 'embroidery', label: '是否刺绣', type: 'select', options: ['', '是', '否'] },
  { field: 'embroidery_daily_output', label: '刺绣日产量', type: 'number' },
  { field: 'printing', label: '是否印花', type: 'select', options: ['', '是', '否'] },
  { field: 'printing_daily_output', label: '印花日产量', type: 'number' },
  { field: 'ironing_label', label: '是否烫标', type: 'select', options: ['', '是', '否'] },
  { field: 'ironing_daily_output', label: '烫标日产量', type: 'number' },
  { field: 'template', label: '是否用模板', type: 'select', options: ['', '是', '否'] },
  { field: 'template_daily_output', label: '模板日产量', type: 'number' },
  { field: 'tt_time', label: 'TT时间', type: 'text' },
  { field: 'target_daily_output', label: '缝制目标日产量', type: 'number' },
  { field: 'remarks', label: '备注', type: 'text' },
]

function openBatchEdit() {
  batchForm.value = {}
  batchDialogVisible.value = true
}

async function saveBatchEdit() {
  const fields = Object.entries(batchForm.value).filter(([, v]) => v !== '' && v !== undefined && v !== null)
  if (!fields.length) { ElMessage.warning('请至少修改一个字段'); return }
  const ids = [...selectedIds.value]
  let ok = 0, fail = 0
  for (const id of ids) {
    try {
      const row = styles.value.find(r => r.id === id)
      const payload = { ...row }
      for (const [k, v] of fields) payload[k] = v
      await api.saveStyle(payload)
      ok++
    } catch { fail++ }
  }
  selectedIds.value = new Set()
  batchDialogVisible.value = false
  ElMessage.success(`修改完成：${ok} 成功，${fail} 失败`)
  loadStyles()
}

// Filter states
const orderDateFilter = ref({ validDates: new Set(), hasEmpty: false })
const dueDateFilter = ref({ validDates: new Set(), hasEmpty: false })
const textFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

const precomputedOptions = shallowRef({})
function computeFilterOptions() {
  const fields = ['style_no', 'product_name', 'fabric_code', 'plan_qty', 'embroidery', 'embroidery_daily_output', 'printing', 'printing_daily_output', 'ironing_label', 'ironing_daily_output', 'template', 'template_daily_output', 'tt_time', 'target_daily_output', 'remarks']
  const result = {}
  for (const f of fields) {
    const map = {}
    let emptyCount = 0
    for (const row of styles.value) {
      const val = row[f]
      if (val === undefined || val === null || val === '') { emptyCount++; continue }
      const key = String(val)
      map[key] = (map[key] || 0) + 1
    }
    result[f] = { options: Object.entries(map).map(([text, count]) => ({ text, count })), emptyCount }
  }
  precomputedOptions.value = result
}

function onOrderDateFilter(f) { orderDateFilter.value = { validDates: f.validDates, hasEmpty: f.hasEmpty } }
function onDueDateFilter(f) { dueDateFilter.value = { validDates: f.validDates, hasEmpty: f.hasEmpty } }
function onTextFilter(field, f) {
  textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } }
}
function onSort(field, sortBy, dir) {
  sortState.value = { field, sortBy, dir }
}

function isFilterActive(field, type) {
  if (type === 'date') {
    if (field === 'order_date') return orderDateFilter.value.validDates.size > 0 || orderDateFilter.value.hasEmpty
    if (field === 'due_date') return dueDateFilter.value.validDates.size > 0 || dueDateFilter.value.hasEmpty
  }
  return !!textFilters.value[field]?.applied
}

const filteredStyles = computed(() => {
  return styles.value.filter(r => {
    if (orderDateFilter.value.validDates.size > 0 || orderDateFilter.value.hasEmpty) {
      const d = r.order_date ? (r.order_date.includes('T') ? r.order_date.slice(0,10) : r.order_date) : ''
      if (d && !orderDateFilter.value.validDates.has(d)) return false
      if (!d && !orderDateFilter.value.hasEmpty) return false
    }
    if (dueDateFilter.value.validDates.size > 0 || dueDateFilter.value.hasEmpty) {
      const d = r.due_date ? (r.due_date.includes('T') ? r.due_date.slice(0,10) : r.due_date) : ''
      if (d && !dueDateFilter.value.validDates.has(d)) return false
      if (!d && !dueDateFilter.value.hasEmpty) return false
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
    if (!sortState.value.field) return 0
    const { field, sortBy, dir } = sortState.value
    const mul = dir === 'asc' ? 1 : -1
    let va, vb
    if (sortBy === 'count') {
      va = a[field] || ''
      vb = b[field] || ''
      return va.localeCompare(vb, 'zh') * mul
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
})

// ============ 虚拟滚动 ============
const vs = useVirtualScroll(36, 8)
const vtTotalHeight = computed(() => filteredStyles.value.length * vs.rowHeight)
const vtStartIndex = computed(() => Math.max(0, Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows))
const vtVisibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
const vtVisibleRows = computed(() => filteredStyles.value.slice(vtStartIndex.value, vtStartIndex.value + vtVisibleCount.value))

async function loadStyles() {
  loading.value = true
  try {
    const { data } = await api.getStyles(searchKeyword.value || '')
    styles.value = data
    computeFilterOptions()
  } catch (e) {
    ElMessage.error('加载款式失败')
  } finally {
    loading.value = false
  }
}

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadStyles, 300)
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
    await api.saveStyle(editForm.value)
    ElMessage.success('保存成功')
    editingId.value = null
    loadStyles()
  } catch (e) {
    ElMessage.error('保存失败')
  }
}
async function remove(id) {
  try {
    await ElMessageBox.confirm('确定删除该款式?', '提示', { type: 'warning' })
    await api.deleteStyle(id)
    ElMessage.success('删除成功')
    loadStyles()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

const createDialogVisible = ref(false)
const createForm = ref({})
function openCreate() {
  createForm.value = {
    style_no: '', product_name: '', style_category: '', fabric_code: '',
    plan_qty: 0, due_date: '', order_date: '',
    embroidery: '', embroidery_daily_output: 0,
    printing: '', printing_daily_output: 0,
    ironing_label: '', ironing_daily_output: 0,
    template: '', template_daily_output: 0,
    tt_time: '', target_daily_output: 0, remarks: ''
  }
  createDialogVisible.value = true
}
async function saveNew() {
  try {
    await api.saveStyle(createForm.value)
    ElMessage.success('新增成功')
    createDialogVisible.value = false
    loadStyles()
  } catch (e) {
    ElMessage.error('保存失败')
  }
}

function scrollToTop() {
  if (vs.container.value) vs.container.value.scrollTop = 0
}

function fmtDate(v) {
  if (!v) return ''
  if (v.includes('T')) return v.slice(0, 10)
  return v
}

// Import / Export
const fileInputRef = ref(null)
async function exportExcel() {
  try {
    if (!filteredStyles.value.length) { ElMessage.warning('没有可导出的数据'); return }
    const XLSX = await import('xlsx')
    const header = columns.map(c => c.label)
    const data = filteredStyles.value.map(row => columns.map(c => {
      let v = row[c.field]
      if (v === null || v === undefined) return ''
      if (c.type === 'date' && v.includes && v.includes('T')) v = v.slice(0, 10)
      return v
    }))
    const ws = XLSX.utils.aoa_to_sheet([header, ...data])
    // Set column widths
    ws['!cols'] = columns.map(c => ({ wch: Math.max(c.label.length * 2, Math.floor(c.width / 8)) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '款式管理')
    XLSX.writeFile(wb, '款式管理.xlsx')
    ElMessage.success(`导出成功：${filteredStyles.value.length} 条`)
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
    const res = await api.importStyles(file)
    ElMessage.success(`导入完成：${res.data.imported} 条导入，${res.data.skipped} 条跳过`)
    loadStyles()
  } catch (err) {
    ElMessage.error('导入失败: ' + (err.response?.data?.error || err.message))
  }
  e.target.value = ''
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

onMounted(() => {
  if (props.initialData && props.initialData.length > 0) {
    setTimeout(() => { computeFilterOptions() }, 0)
  } else {
    loadStyles()
  }
  const body = vs.container.value
  if (body) {
    body.addEventListener('mousedown', onDragStart)
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }
})
onUnmounted(() => {
  clearTimeout(searchTimer)
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <div class="styles-page">
    <div class="toolbar">
      <el-input v-model="searchKeyword" placeholder="搜索款号、品名、面料代号、备注..." clearable @input="onSearchInput" style="width:320px" />
      <el-button type="primary" @click="openCreate">+ 新增款式</el-button>
      <el-button @click="exportExcel">导出 Excel</el-button>
      <el-button @click="triggerImport">导入 Excel</el-button>
      <input ref="fileInputRef" type="file" accept=".xlsx,.xls" style="display:none" @change="handleImport" />
    </div>

    <div v-if="!styles.length && !loading" class="empty-state">暂无款式数据，点击上方按钮新增</div>

    <!-- 批量操作栏 -->
    <div v-if="selectedCount > 0" class="batch-bar">
      <span class="batch-count">已选 {{ selectedCount }} 项</span>
      <el-button size="small" @click="openBatchEdit">批量修改</el-button>
      <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
      <el-button size="small" text @click="selectedIds.value = new Set()">取消选择</el-button>
    </div>

    <div class="excel-wrap">
      <div class="excel-body" :ref="el => vs.container.value = el" @scroll="vs.onScroll" @mousedown="onDragStart">
        <table class="excel-table">
          <thead>
            <tr>
              <th style="width:40px;text-align:center">
                <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" class="chk" />
              </th>
              <th v-for="(col, ci) in columns" :key="col.field" :style="{ width: col.width + 'px' }">
                <div class="col-header">
                  <DateFilter v-if="col.type==='date'" :data="styles" :field="col.field" :label="col.label" :active="isFilterActive(col.field, 'date')" @filter="col.field==='order_date'?onOrderDateFilter:onDueDateFilter" />
                  <NumberFilter v-else-if="col.type==='number'" :data="styles" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" :active="isFilterActive(col.field)" @filter="f => onTextFilter(col.field, f)" @sort="onSort" />
                  <TextFilter v-else :data="styles" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" :active="isFilterActive(col.field)" @filter="f => onTextFilter(col.field, f)" @sort="onSort" />
                </div>
              </th>
              <th style="width:120px">操作</th>
            </tr>
          </thead>
          <tbody>
          <!-- 顶部占位 -->
          <tr v-if="vtStartIndex > 0" :style="{ height: (vtStartIndex * vs.rowHeight) + 'px' }">
            <td :colspan="1 + columns.length + 1" style="padding:0;border:0"></td>
          </tr>
          <tr v-for="row in vtVisibleRows" :key="row.id" :class="{ 'editing-row': editingId === row.id, 'selected-row': selectedIds.has(row.id) }">
            <td class="chk-cell" style="width:40px">
              <input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggleSelect(row.id)" class="chk" />
            </td>
            <!-- 接单日期 -->
            <td :style="{ width: columns[0].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.order_date" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.order_date) }}</span></template>
            </td>
            <!-- 款号 -->
            <td :style="{ width: columns[1].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.style_no" /></template>
              <template v-else><span>{{ row.style_no }}</span></template>
            </td>
            <!-- 品名 -->
            <td :style="{ width: columns[2].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.product_name" /></template>
              <template v-else><span>{{ row.product_name }}</span></template>
            </td>
            <!-- 款式分类 -->
            <td :style="{ width: columns[3].width + 'px' }">
              <template v-if="editingId === row.id">
                <select class="inp" v-model="editForm.style_category">
                  <option value="">请选择</option>
                  <option v-for="opt in columns[3].options" :key="opt" :value="opt">{{ opt }}</option>
                </select>
              </template>
              <template v-else><span>{{ row.style_category }}</span></template>
            </td>
            <!-- 面料代号 -->
            <td :style="{ width: columns[4].width + 'px' }">
              <div class="wrap-cell">
                <template v-if="editingId === row.id"><input class="inp" v-model="editForm.fabric_code" /></template>
                <template v-else>{{ row.fabric_code }}</template>
              </div>
            </td>
            <!-- 成衣计划数量 -->
            <td class="num" :style="{ width: columns[5].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model.number="editForm.plan_qty" type="number" min="0" /></template>
              <template v-else><span>{{ row.plan_qty }}</span></template>
            </td>
            <!-- 交期 -->
            <td :style="{ width: columns[6].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.due_date" type="date" /></template>
              <template v-else><span>{{ fmtDate(row.due_date) }}</span></template>
            </td>
            <!-- 是否刺绣 -->
            <td :style="{ width: columns[7].width + 'px' }">
              <template v-if="editingId === row.id">
                <select class="inp-select" v-model="editForm.embroidery"><option value="">-</option><option>是</option><option>否</option></select>
              </template>
              <template v-else><span>{{ row.embroidery }}</span></template>
            </td>
            <!-- 刺绣日产量 -->
            <td class="num" :style="{ width: columns[8].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model.number="editForm.embroidery_daily_output" type="number" min="0" /></template>
              <template v-else><span>{{ row.embroidery_daily_output }}</span></template>
            </td>
            <!-- 是否印花 -->
            <td :style="{ width: columns[9].width + 'px' }">
              <template v-if="editingId === row.id">
                <select class="inp-select" v-model="editForm.printing"><option value="">-</option><option>是</option><option>否</option></select>
              </template>
              <template v-else><span>{{ row.printing }}</span></template>
            </td>
            <!-- 印花日产量 -->
            <td class="num" :style="{ width: columns[10].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model.number="editForm.printing_daily_output" type="number" min="0" /></template>
              <template v-else><span>{{ row.printing_daily_output }}</span></template>
            </td>
            <!-- 是否烫标 -->
            <td :style="{ width: columns[11].width + 'px' }">
              <template v-if="editingId === row.id">
                <select class="inp-select" v-model="editForm.ironing_label"><option value="">-</option><option>是</option><option>否</option></select>
              </template>
              <template v-else><span>{{ row.ironing_label }}</span></template>
            </td>
            <!-- 烫标日产量 -->
            <td class="num" :style="{ width: columns[12].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model.number="editForm.ironing_daily_output" type="number" min="0" /></template>
              <template v-else><span>{{ row.ironing_daily_output }}</span></template>
            </td>
            <!-- 是否用模板 -->
            <td :style="{ width: columns[13].width + 'px' }">
              <template v-if="editingId === row.id">
                <select class="inp-select" v-model="editForm.template"><option value="">-</option><option>是</option><option>否</option></select>
              </template>
              <template v-else><span>{{ row.template }}</span></template>
            </td>
            <!-- 模板日产量 -->
            <td class="num" :style="{ width: columns[14].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model.number="editForm.template_daily_output" type="number" min="0" /></template>
              <template v-else><span>{{ row.template_daily_output }}</span></template>
            </td>
            <!-- TT时间 -->
            <td :style="{ width: columns[15].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.tt_time" /></template>
              <template v-else><span>{{ row.tt_time }}</span></template>
            </td>
            <!-- 缝制目标日产量 -->
            <td class="num" :style="{ width: columns[16].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model.number="editForm.target_daily_output" type="number" min="0" /></template>
              <template v-else><span>{{ row.target_daily_output }}</span></template>
            </td>
            <!-- 备注 -->
            <td class="text-left" :style="{ width: columns[17].width + 'px' }">
              <template v-if="editingId === row.id"><input class="inp" v-model="editForm.remarks" /></template>
              <template v-else><span>{{ row.remarks }}</span></template>
            </td>
            <!-- 操作 -->
            <td class="action-cell" style="width:120px">
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
          <!-- 底部占位 -->
          <tr v-if="(vtStartIndex + vtVisibleRows.length) < filteredStyles.length" :style="{ height: ((filteredStyles.length - vtStartIndex - vtVisibleRows.length) * vs.rowHeight) + 'px' }">
            <td :colspan="1 + columns.length + 1" style="padding:0;border:0"></td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 新增款式弹窗 -->
    <el-dialog v-model="createDialogVisible" title="新增款式" width="800px" destroy-on-close>
      <el-form :model="createForm" label-width="110px" label-position="right">
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="款号"><el-input v-model="createForm.style_no" placeholder="请输入款号" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="品名"><el-input v-model="createForm.product_name" placeholder="请输入品名" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="款式分类">
            <el-select v-model="createForm.style_category" placeholder="请选择" style="width:100%" clearable>
              <el-option v-for="opt in columns.find(c=>c.field==='style_category').options" :key="opt" :label="opt" :value="opt" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="面料代号"><el-input v-model="createForm.fabric_code" placeholder="请输入面料代号" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="成衣计划数量"><el-input-number v-model="createForm.plan_qty" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="接单日期"><el-input v-model="createForm.order_date" type="date" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="交期"><el-input v-model="createForm.due_date" type="date" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="6"><el-form-item label="是否刺绣"><el-select v-model="createForm.embroidery" style="width:100%"><el-option label="" value="" /><el-option label="是" value="是" /><el-option label="否" value="否" /></el-select></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="刺绣日产量"><el-input-number v-model="createForm.embroidery_daily_output" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="是否印花"><el-select v-model="createForm.printing" style="width:100%"><el-option label="" value="" /><el-option label="是" value="是" /><el-option label="否" value="否" /></el-select></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="印花日产量"><el-input-number v-model="createForm.printing_daily_output" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="6"><el-form-item label="是否烫标"><el-select v-model="createForm.ironing_label" style="width:100%"><el-option label="" value="" /><el-option label="是" value="是" /><el-option label="否" value="否" /></el-select></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="烫标日产量"><el-input-number v-model="createForm.ironing_daily_output" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="是否用模板"><el-select v-model="createForm.template" style="width:100%"><el-option label="" value="" /><el-option label="是" value="是" /><el-option label="否" value="否" /></el-select></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="模板日产量"><el-input-number v-model="createForm.template_daily_output" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="TT时间"><el-input v-model="createForm.tt_time" placeholder="请输入TT时间" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="缝制目标日产量"><el-input-number v-model="createForm.target_daily_output" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="备注"><el-input v-model="createForm.remarks" type="textarea" :rows="2" placeholder="请输入备注" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveNew">确定新增</el-button>
      </template>
    </el-dialog>

    <!-- 批量修改弹窗 -->
    <el-dialog v-model="batchDialogVisible" title="批量修改" width="600px" destroy-on-close>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">将修改选中的 {{ selectedCount }} 条款式，留空的字段不会修改</p>
      <el-form label-width="100px" label-position="right">
        <el-row :gutter="16">
          <template v-for="f in batchFields" :key="f.field">
            <el-col :span="f.type === 'text' ? 24 : 12" style="margin-bottom:12px">
              <el-form-item :label="f.label">
                <select v-if="f.type === 'select'" class="inp-select" v-model="batchForm[f.field]">
                  <option value="">不修改</option>
                  <option v-for="o in f.options.slice(1)" :key="o" :value="o">{{ o || '清空' }}</option>
                </select>
                <el-input-number v-else-if="f.type === 'number'" v-model="batchForm[f.field]" style="width:100%" />
                <el-input v-else v-model="batchForm[f.field]" placeholder="不修改" />
              </el-form-item>
            </el-col>
          </template>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveBatchEdit">确认修改</el-button>
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
}
.selected-row td {
  background: var(--primary-light) !important;
}

/* 单表格容器：flex占满 + 内容滚动 */
.excel-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  background: var(--card);
  border: 1px solid var(--border);
  overflow: hidden;
  min-height: 0;
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

/* 表头：小灰字，左对齐，只有底部细线，sticky固定 */
.excel-table thead th {
  padding: 0;
  background: var(--card);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
  text-transform: none;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}

/* 数据行：大间距，只有底部细线，无竖线，自动换行 */
.excel-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  text-align: left;
  overflow: hidden;
  word-break: break-all;
  line-height: 1.5;
}

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
.wrap-cell { overflow: hidden; word-break: break-all; }

.action-cell {
  white-space: nowrap;
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
