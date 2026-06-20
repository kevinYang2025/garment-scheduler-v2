<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import DateFilter from '../components/DateFilter.vue'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'
import { useVirtualScroll } from '../composables/useVirtualScroll'

// 虚拟滚动（行高 40px：12+12 padding + 13px font + 1px border）
const vs = useVirtualScroll(40, 8)

const columns = [
  { field: 'inbound_date', label: '入库日期', width: 110, type: 'date' },
  { field: 'supplier', label: '供应商', width: 120, type: 'text' },
  { field: 'customer', label: '客户', width: 120, type: 'text' },
  { field: 'style_no', label: '款号', width: 180, type: 'text' },
  { field: 'pot_no', label: '锅号', width: 140, type: 'text' },
  { field: 'fabric_name', label: '面料名称', width: 140, type: 'text' },
  { field: 'width', label: '幅宽', width: 80, type: 'text' },
  { field: 'weight', label: '克重', width: 80, type: 'number' },
  { field: 'color', label: '颜色', width: 150, type: 'text' },
  { field: 'qty', label: '数量', width: 90, type: 'number' },
  { field: 'unit', label: '单位', width: 70, type: 'text' },
  { field: 'total_pcs', label: '总匹数', width: 80, type: 'number' },
  { field: 'unit2', label: '单位2', width: 70, type: 'text' },
  { field: 'loading_date', label: '装柜日期', width: 110, type: 'date' },
  { field: 'loading_qty', label: '装柜数量', width: 100, type: 'number' },
  { field: 'garment_qty', label: '成衣计划数量', width: 100, type: 'number' },
  { field: 'remark', label: '备注', width: 150, type: 'text' },
]

const records = ref([])
const searchKeyword = ref('')
const loading = ref(false)
let searchTimer = null

// Filter states
const inboundDateFilter = ref({ validDates: new Set(), hasEmpty: false })
const loadingDateFilter = ref({ validDates: new Set(), hasEmpty: false })
const textFilters = ref({})
const numFilters = ref({})
const dateFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })
const precomputedOptions = ref({})

function computeFilterOptions() {
  const opts = {}
  for (const col of columns) {
    if (col.type === 'text') {
      const map = new Map()
      let emptyCount = 0
      for (const r of records.value) {
        const v = String(r[col.field] || '')
        if (!v) { emptyCount++; continue }
        map.set(v, (map.get(v) || 0) + 1)
      }
      opts[col.field] = { options: [...map.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count), emptyCount }
    } else if (col.type === 'number') {
      const map = new Map()
      let emptyCount = 0
      for (const r of records.value) {
        const v = r[col.field]
        const key = v != null ? String(v) : ''
        if (!key) { emptyCount++; continue }
        map.set(key, (map.get(key) || 0) + 1)
      }
      opts[col.field] = { options: [...map.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => parseFloat(a.text) - parseFloat(b.text)), emptyCount }
    } else if (col.type === 'date') {
      const dates = new Set()
      let hasEmpty = false
      for (const r of records.value) {
        const d = (r[col.field] || '').slice(0, 10)
        if (!d) { hasEmpty = true; continue }
        dates.add(d)
      }
      opts[col.field] = { dates, hasEmpty }
    }
  }
  precomputedOptions.value = opts
}

function onInboundDateFilter(f) { inboundDateFilter.value = { validDates: f.validDates, hasEmpty: f.hasEmpty }; dateFilters.value = { ...dateFilters.value, inbound_date: { ...f, applied: true } } }
function onLoadingDateFilter(f) { loadingDateFilter.value = { validDates: f.validDates, hasEmpty: f.hasEmpty }; dateFilters.value = { ...dateFilters.value, loading_date: { ...f, applied: true } } }
function onTextFilter(field, f) { textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } } }
function onNumFilter(field, f) { numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } } }

function isFilterActive(field, type) {
  if (type === 'date') {
    const df = dateFilters.value[field]
    return df && (df.validDates?.size > 0 || df.hasEmpty)
  }
  return !!textFilters.value[field]?.applied || !!numFilters.value[field]?.applied
}
function onSort(field, sortBy, dir) { sortState.value = { field, sortBy, dir } }

const editingId = ref(null)
const editForm = ref({})

// Batch operations
const selectedIds = ref(new Set())
const isAllSelected = computed(() => filteredRecords.value.length > 0 && filteredRecords.value.every(r => selectedIds.value.has(r.id)))
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
    selectedIds.value = new Set(filteredRecords.value.map(r => r.id))
  }
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.size} 条记录？`, '批量删除', { type: 'warning' })
    const ids = [...selectedIds.value]
    let ok = 0, fail = 0
    for (const id of ids) {
      try { await api.delete(`/fabric-loading/${id}`); ok++ } catch { fail++ }
    }
    selectedIds.value = new Set()
    ElMessage.success(`删除完成：${ok} 成功，${fail} 失败`)
    loadRecords()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('批量删除失败')
  }
}

async function batchInbound() {
  const count = selectedIds.value.size
  if (count === 0) return
  try {
    await ElMessageBox.confirm(
      `确定将选中的 ${count} 条装柜记录批量入库到面料库？`,
      '批量入库',
      { type: 'warning', confirmButtonText: '确认入库', cancelButtonText: '取消' }
    )
    const ids = [...selectedIds.value]
    const { data } = await api.batchInbound(ids)
    if (data.ok) {
      let msg = `批量入库完成：${data.imported} 条成功`
      if (data.errors?.length > 0) msg += `，${data.errors.length} 条跳过（已入库/不存在）`
      ElMessage.success(msg)
    } else {
      ElMessage.error(data.error || '批量入库失败')
    }
    selectedIds.value = new Set()
    loadRecords()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('批量入库失败')
  }
}

const filteredRecords = computed(() => {
  let list = records.value
  // 关键字搜索
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    list = list.filter(r =>
      (r.style_no || '').toLowerCase().includes(kw) ||
      (r.fabric_name || '').toLowerCase().includes(kw) ||
      (r.supplier || '').toLowerCase().includes(kw) ||
      (r.customer || '').toLowerCase().includes(kw) ||
      (r.color || '').toLowerCase().includes(kw) ||
      (r.pot_no || '').toLowerCase().includes(kw) ||
      (r.remark || '').toLowerCase().includes(kw)
    )
  }
  // 列级筛选
  for (const [field, f] of Object.entries(textFilters.value)) {
    if (!f.applied) continue
    if (f.validValues && f.validValues.size > 0) {
      list = list.filter(r => {
        const v = String(r[field] || '')
        return f.validValues.has(v) || (f.hasEmpty && !v)
      })
    }
  }
  for (const [field, f] of Object.entries(dateFilters.value)) {
    if (!f.applied) continue
    if (f.validDates && f.validDates.size > 0) {
      list = list.filter(r => {
        const d = (r[field] || '').slice(0, 10)
        return f.validDates.has(d) || (f.hasEmpty && !d)
      })
    }
  }
  for (const [field, f] of Object.entries(numFilters.value)) {
    if (!f.applied) continue
    if (f.checked && f.checked.size > 0) {
      list = list.filter(r => {
        const v = r[field]
        const key = v != null ? String(v) : ''
        return f.checked.has(key) || (f.includeEmpty && !key)
      })
    }
  }
  // 排序
  if (sortState.value.field) {
    const { field, sortBy, dir } = sortState.value
    const d = dir === 'asc' ? 1 : -1
    if (sortBy === 'count') {
      const countMap = new Map()
      for (const r of list) {
        const v = r[field] ?? ''
        countMap.set(v, (countMap.get(v) || 0) + 1)
      }
      list = [...list].sort((a, b) => (countMap.get(a[field] ?? '') - countMap.get(b[field] ?? '')) * d)
    } else {
      list = [...list].sort((a, b) => {
        if (sortBy === 'date') {
          return ((a[field] || '').localeCompare(b[field] || '')) * d
        }
        const av = a[field] ?? '', bv = b[field] ?? ''
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * d
        return String(av).localeCompare(String(bv)) * d
      })
    }
  }
  return list
})

// 虚拟滚动切片
const totalRows = computed(() => filteredRecords.value.length)
const visibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
const startIndex = computed(() => {
  const idx = Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows
  return idx < 0 ? 0 : (idx > totalRows.value ? totalRows.value : idx)
})
const visibleRows = computed(() => filteredRecords.value.slice(startIndex.value, startIndex.value + visibleCount.value))
const topPad = computed(() => startIndex.value * vs.rowHeight)
const bottomPad = computed(() => Math.max(0, (totalRows.value - startIndex.value - visibleRows.value.length) * vs.rowHeight))

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadRecords(), 300)
}

async function loadRecords() {
  loading.value = true
  try {
    const { data } = await api.get('/fabric-loading', { params: { keyword: searchKeyword.value } })
    records.value = data || []
    nextTick(() => computeFilterOptions())
  } catch { ElMessage.error('加载失败') }
  loading.value = false
}

function fmtDate(d) {
  if (!d) return ''
  if (typeof d === 'string' && d.includes('T')) return d.slice(0, 10)
  if (typeof d === 'string' && d.includes('-')) return d
  // Excel 序列号转日期
  const num = Number(d)
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const js = new Date((num - 25569) * 86400000)
    return `${js.getUTCFullYear()}-${String(js.getUTCMonth()+1).padStart(2,'0')}-${String(js.getUTCDate()).padStart(2,'0')}`
  }
  return d
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
    await api.put(`/fabric-loading/${editForm.value.id}`, editForm.value)
    ElMessage.success('修改成功')
    editingId.value = null
    await loadRecords()
  } catch { ElMessage.error('修改失败') }
}

async function remove(id) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    await api.delete(`/fabric-loading/${id}`)
    ElMessage.success('删除成功')
    await loadRecords()
  } catch (e) { if (e !== 'cancel') ElMessage.error('删除失败') }
}

// Create
const createDialogVisible = ref(false)
const createForm = ref({})
function openCreate() {
  createForm.value = {
    inbound_date: '', supplier: '', customer: '', style_no: '', pot_no: '',
    fabric_name: '', width: '', weight: '', color: '', qty: 0, unit: 'KG',
    total_pcs: 0, unit2: '匹', loading_date: '', loading_qty: 0, garment_qty: 0, remark: ''
  }
  createDialogVisible.value = true
}
async function doCreate() {
  if (!createForm.value.style_no) { ElMessage.warning('请输入款号'); return }
  try {
    await api.post('/fabric-loading', createForm.value)
    ElMessage.success('新增成功')
    createDialogVisible.value = false
    await loadRecords()
  } catch { ElMessage.error('新增失败') }
}

// Export
async function exportExcel() {
  window.open('/api/fabric-loading/export', '_blank')
}

// Import
const importDialogVisible = ref(false)
const importFile = ref(null)
const importPreview = ref(null)
const importing = ref(false)

function triggerImport() {
  importFile.value = null
  importPreview.value = null
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xlsx,.xls'
  input.onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    importFile.value = file
    importDialogVisible.value = true
    await doImportParse()
  }
  input.click()
}
function onImportFileChange(e) { importFile.value = e.target.files[0] }

async function doImportParse() {
  if (!importFile.value) return
  if (importFile.value.size > 5 * 1024 * 1024) { ElMessage.warning('文件大小不能超过 5MB'); return }
  importing.value = true
  try {
    const XLSX = await import('xlsx')
    const data = await importFile.value.arrayBuffer()
    const wb = XLSX.read(data, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
    if (rows.length < 2) { importing.value = false; return ElMessage.error('格式不正确') }
    const headers = rows[0]
    const headerMap = {
      '入库日期': 'inbound_date', '供应商': 'supplier', '客户': 'customer',
      '款号': 'style_no', '锅号': 'pot_no', '面料名称': 'fabric_name',
      '幅宽': 'width', '克重': 'weight', '颜色': 'color',
      '数量': 'qty', '单位': 'unit', '总匹数': 'total_pcs',
      '单位2': 'unit2', '装柜日期': 'loading_date', '装柜数量': 'loading_qty', '成衣计划数量': 'garment_qty', '备注': 'remark'
    }
    const colMap = {}
    headers.forEach((h, i) => { if (headerMap[h]) colMap[i] = headerMap[h] })
    const records = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c == null)) continue
      const item = {}
      for (const [col, key] of Object.entries(colMap)) {
        let val = row[Number(col)]
        if (val && typeof val === 'object' && val.result !== undefined) val = val.result
        if (val instanceof Date) {
          item[key] = `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`
        } else {
          item[key] = val != null ? String(val).trim() : ''
        }
      }
      if (item.style_no || item.fabric_name) records.push(item)
    }
    importPreview.value = records
  } catch (e) { ElMessage.error('解析失败: ' + e.message) }
  importing.value = false
}

async function confirmImport() {
  if (!importPreview.value?.length) return
  importing.value = true
  try {
    const { data } = await api.post('/fabric-loading/import', { records: importPreview.value })
    ElMessage.success(`导入完成: ${data.imported} 条`)
    importDialogVisible.value = false
    importPreview.value = null
    importFile.value = null
    await loadRecords()
  } catch (e) { ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message)) }
  importing.value = false
}

function scrollToTop() {
  // [2026-06-20 段16 C-1] 用 composable ref 替代 querySelector
  if (vs.container.value) vs.container.value.scrollTop = 0
}

// [2026-06-19] 裁剪参数设置弹窗
const cutParamDialogVisible = ref(false)
const cutParamList = ref([])   // 当前款号的所有 color/size 行
const cutParamStyle = ref('')  // 当前款号
const cutParamLoading = ref(false)

async function openCutParam(row) {
  if (!row.style_no) { ElMessage.warning('该行款号为空'); return }
  cutParamStyle.value = row.style_no
  cutParamDialogVisible.value = true
  cutParamLoading.value = true
  try {
    const { data } = await api.get('/style-color-size', { params: { style_no: row.style_no } })
    // 仅显示分色分尺码(已有 row),且不重复
    cutParamList.value = (data || []).map(r => ({
      id: r.id,
      color: r.color,
      size_spec: r.size_spec,
      plan_qty: r.plan_qty || 0,
      cutting_param: r.cutting_param > 0 ? r.cutting_param : (r.plan_qty || 0),
    }))
  } catch (e) {
    ElMessage.error('加载分色分尺码失败')
    cutParamList.value = []
  }
  cutParamLoading.value = false
}

async function saveCutParam() {
  // 校验: 全部 cutting_param ≥ plan_qty
  for (const r of cutParamList.value) {
    if (parseInt(r.cutting_param) > 0 && parseInt(r.cutting_param) < parseInt(r.plan_qty)) {
      ElMessage.error(`颜色 ${r.color} 规格 ${r.size_spec} 的裁剪参数不能小于原单量`)
      return
    }
  }
  cutParamSaving.value = true
  let ok = 0, fail = 0
  for (const r of cutParamList.value) {
    if (!r.id) continue
    try {
      await api.put(`/style-color-size/${r.id}`, { cutting_param: parseInt(r.cutting_param) || 0 })
      ok++
    } catch (e) { fail++ }
  }
  cutParamSaving.value = false
  if (fail === 0) {
    ElMessage.success(`已保存 ${ok} 行裁剪参数`)
    cutParamDialogVisible.value = false
  } else {
    ElMessage.warning(`保存 ${ok} 成功, ${fail} 失败`)
  }
}

const cutParamSaving = ref(false)

// Drag-to-scroll
let dragging = false, dragX = 0, dragY = 0, dragSL = 0, dragST = 0, dragWrap = null
function onDragStart(e) {
  if (e.target.tagName !== 'TD' && e.target.tagName !== 'TH') return
  dragWrap = e.currentTarget
  dragging = true
  dragX = e.pageX; dragY = e.pageY
  dragSL = dragWrap.scrollLeft; dragST = dragWrap.scrollTop
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
  dragging = false; dragWrap = null
}

onMounted(() => {
  loadRecords()
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
})
onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <div class="fabric-loading-page">
    <div class="toolbar">
      <el-input v-model="searchKeyword" placeholder="搜索款号、面料名称、供应商、客户、颜色..." clearable @input="onSearchInput" style="width:360px" />
      <el-button type="primary" @click="openCreate">+ 新增记录</el-button>
      <el-button @click="exportExcel">导出 Excel</el-button>
      <el-button @click="triggerImport">导入 Excel</el-button>
    </div>

    <div v-if="!records.length && !loading" class="empty-state">暂无数据，点击上方按钮新增或导入</div>

    <div v-if="selectedCount > 0" class="batch-bar">
      <span class="batch-count">已选 {{ selectedCount }} 项</span>
      <el-button size="small" type="primary" @click="batchInbound">📦 批量入库到面料库</el-button>
      <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
      <el-button size="small" text @click="selectedIds = new Set()">取消选择</el-button>
    </div>

    <div class="excel-wrap">
      <div class="excel-body" :ref="el => vs.container.value = el" @scroll="vs.onScroll" @mousedown="onDragStart">
        <table class="excel-table">
          <thead>
            <tr>
              <th style="width:40px;text-align:center">
                <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" class="chk" />
              </th>
              <th v-for="col in columns" :key="col.field" :style="{ width: col.width + 'px', minWidth: col.width + 'px' }">
                <div class="col-header">
                  <DateFilter v-if="col.type==='date'" :data="records" :field="col.field" :label="col.label" @filter="col.field==='inbound_date'?onInboundDateFilter:onLoadingDateFilter" :active="isFilterActive(col.field, 'date')" />
                  <NumberFilter v-else-if="col.type==='number'" :data="records" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" @filter="f => onNumFilter(col.field, f)" @sort="onSort" :active="isFilterActive(col.field)" />
                  <TextFilter v-else :data="records" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" @filter="f => onTextFilter(col.field, f)" @sort="onSort" :active="isFilterActive(col.field)" />
                </div>
              </th>
              <th style="width:120px">操作</th>
            </tr>
          </thead>
          <tbody>
          <tr v-if="topPad > 0" :style="{ height: topPad + 'px' }"><td :colspan="columns.length + 2" style="padding:0;border:0"></td></tr>
          <tr v-for="row in visibleRows" :key="row.id" :class="{ 'editing-row': editingId === row.id, 'selected-row': selectedIds.has(row.id) }">
            <td class="chk-cell" style="width:40px">
              <input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggleSelect(row.id)" class="chk" />
            </td>
            <td v-for="col in columns" :key="col.field" :style="{ width: col.width + 'px', minWidth: col.width + 'px' }"
                :class="{ 'num': col.type === 'number', 'wrap-cell': col.field === 'fabric_name' }">
              <template v-if="editingId === row.id">
                <input v-if="col.type === 'date'" class="inp" v-model="editForm[col.field]" type="date" />
                <input v-else-if="col.type === 'number'" class="inp" v-model.number="editForm[col.field]" type="number" min="0" />
                <input v-else class="inp" v-model="editForm[col.field]" />
              </template>
              <template v-else>
                <span v-if="col.type === 'date'">{{ fmtDate(row[col.field]) }}</span>
                <span v-else-if="col.type === 'number'">{{ row[col.field] }}</span>
                <span v-else>{{ row[col.field] }}</span>
              </template>
            </td>
            <td class="action-cell" style="width:180px">
              <template v-if="editingId === row.id">
                <el-button size="small" text type="primary" @click="saveEdit">保存</el-button>
                <el-button size="small" text @click="cancelEdit">取消</el-button>
              </template>
              <template v-else>
                <el-button size="small" text @click="startEdit(row)">编辑</el-button>
                <el-button size="small" text @click="openCutParam(row)">裁剪参数</el-button>
                <el-button size="small" text type="danger" @click="remove(row.id)">删除</el-button>
              </template>
            </td>
          </tr>
          <tr v-if="bottomPad > 0" :style="{ height: bottomPad + 'px' }"><td :colspan="columns.length + 2" style="padding:0;border:0"></td></tr>
        </tbody>
        </table>
      </div>
    </div>
    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 新增弹窗 -->
    <el-dialog v-model="createDialogVisible" title="新增装柜记录" width="900px" destroy-on-close>
      <el-form :model="createForm" label-width="90px" label-position="right">
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="入库日期"><el-input v-model="createForm.inbound_date" type="date" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="供应商"><el-input v-model="createForm.supplier" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="客户"><el-input v-model="createForm.customer" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="款号"><el-input v-model="createForm.style_no" placeholder="必填" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="锅号"><el-input v-model="createForm.pot_no" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="面料名称"><el-input v-model="createForm.fabric_name" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="6"><el-form-item label="幅宽"><el-input v-model="createForm.width" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="克重"><el-input-number v-model="createForm.weight" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="颜色"><el-input v-model="createForm.color" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="数量(KG)"><el-input-number v-model="createForm.qty" :min="0" :precision="1" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="6"><el-form-item label="总匹数"><el-input-number v-model="createForm.total_pcs" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="装柜日期"><el-input v-model="createForm.loading_date" type="date" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="装柜数量"><el-input-number v-model="createForm.loading_qty" :min="0" :precision="1" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="成衣计划数量"><el-input-number v-model="createForm.garment_qty" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="备注"><el-input v-model="createForm.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible=false">取消</el-button>
        <el-button type="primary" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入 Excel" width="600px">
      <div v-if="importFile" style="margin-bottom:12px;font-size:13px;color:var(--text-secondary)">
        📄 {{ importFile.name }}（{{ (importFile.size / 1024).toFixed(1) }} KB）
      </div>
      <div v-if="importPreview?.length" style="max-height:300px;overflow:auto">
        <div style="margin-bottom:4px;font-size:12px;color:var(--text-secondary)">共 {{ importPreview.length }} 条</div>
        <el-table :data="importPreview" size="small" border max-height="220">
          <el-table-column label="款号" width="140"><template #default="{row}">{{ row.style_no }}</template></el-table-column>
          <el-table-column label="面料名称" width="160"><template #default="{row}">{{ row.fabric_name }}</template></el-table-column>
          <el-table-column label="颜色" width="120"><template #default="{row}">{{ row.color }}</template></el-table-column>
          <el-table-column label="数量" width="80"><template #default="{row}">{{ row.qty }}</template></el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmImport" :loading="importing" :disabled="!importPreview?.length">确认导入</el-button>
      </template>
    </el-dialog>

    <!-- [2026-06-19] 裁剪参数设置弹窗 -->
    <el-dialog v-model="cutParamDialogVisible" :title="`裁剪参数 - ${cutParamStyle}`" width="640px" destroy-on-close>
      <p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px">
        裁剪参数必须 ≥ 原单量(系统规定裁剪数不能低于原单数)。保存后写入分色分尺码,二次加工排程将按此数计算。
      </p>
      <el-table :data="cutParamList" v-loading="cutParamLoading" border size="small" max-height="380">
        <el-table-column prop="color" label="颜色" width="120" />
        <el-table-column prop="size_spec" label="规格" width="80" />
        <el-table-column prop="plan_qty" label="原单量" width="80" align="right" />
        <el-table-column label="裁剪参数" width="160">
          <template #default="{ row }">
            <el-input-number v-model="row.cutting_param" :min="0" size="small" controls-position="right" style="width:100%" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="cutParamDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="cutParamSaving" @click="saveCutParam">保存裁剪参数</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.fabric-loading-page { display: flex; flex-direction: column; height: 100%; }

.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }

.batch-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--primary-light); border-radius: var(--radius); margin-bottom: 12px; }
.batch-count { font-size: 13px; color: var(--primary); font-weight: 600; }

.empty-state { text-align: center; padding: 60px; color: var(--text-tertiary); }

.excel-wrap { flex: 1; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); display: flex; flex-direction: column; }
.excel-wrap.dragging,
.excel-wrap.dragging td,
.excel-wrap.dragging th,
.excel-wrap.dragging input { user-select: none !important; }

.excel-body { overflow: auto; flex: 1; }
.excel-body::-webkit-scrollbar { height: 8px; width: 8px; }
.excel-body::-webkit-scrollbar-thumb { background: #c4c4c4; border-radius: 4px; }
.excel-body::-webkit-scrollbar-thumb:hover { background: #a0a0a0; }
.excel-body::-webkit-scrollbar-track { background: #f0f0f0; }

.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); min-width: 100%; width: 100%; }
.excel-table thead th { padding: 0; background: var(--card); color: var(--text-tertiary); font-size: 11px; font-weight: 500; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap; position: sticky; top: 0; z-index: 3; }
.excel-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-light); white-space: nowrap; text-align: center; }

.col-header { display: flex; align-items: center; justify-content: center; padding: 10px 8px; }
.col-header span { font-weight: 500; font-size: 11px; }

.num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }

.chk-cell { text-align: center !important; }
.chk { width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary); }

tr.selected-row { background: var(--primary-light) !important; }
tr.editing-row { background: var(--primary-light) !important; }
tbody tr:hover td { background: var(--primary-light); }

.action-cell { text-align: center !important; white-space: nowrap; }
.wrap-cell { white-space: normal !important; word-break: break-all; line-height: 1.4; }

.inp { width: 100%; border: 1px solid var(--border); text-align: left; font-size: 13px; padding: 4px 8px; background: var(--card); border-radius: 4px; font-family: inherit; }
.inp:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 2px rgba(0,0,0,.06); }
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
