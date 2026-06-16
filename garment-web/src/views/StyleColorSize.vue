<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import DateFilter from '../components/DateFilter.vue'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'

const records = ref([])
const loading = ref(true)
const searchKeyword = ref('')
let searchTimer = null

// 表格列定义
const columns = [
  { field: 'order_date', label: '订单日期', width: 110, type: 'date' },
  { field: 'style_no', label: '款式', width: 200, type: 'text' },
  { field: 'due_date', label: '交期', width: 110, type: 'date' },
  { field: 'product_name', label: '产品名', width: 100, type: 'text' },
  { field: 'size_spec', label: '规格', width: 80, type: 'text' },
  { field: 'color', label: '颜色', width: 150, type: 'text' },
  { field: 'plan_qty', label: '原单量', width: 100, type: 'number' },
]

// 编辑
const editingId = ref(null)
const editForm = ref({})

// 勾选
const selectedIds = ref(new Set())
const isAllSelected = computed(() => filteredRecords.value.length > 0 && filteredRecords.value.every(r => selectedIds.value.has(r.id)))
const selectedCount = computed(() => selectedIds.value.size)

// 筛选状态
const orderDateFilter = ref({ validDates: new Set(), hasEmpty: false })
const dueDateFilter = ref({ validDates: new Set(), hasEmpty: false })
const textFilters = ref({})
const numFilters = ref({})
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

function onOrderDateFilter(f) { orderDateFilter.value = { validDates: f.validDates, hasEmpty: f.hasEmpty } }
function onDueDateFilter(f) { dueDateFilter.value = { validDates: f.validDates, hasEmpty: f.hasEmpty } }
function onTextFilter(field, f) { textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } } }
function onNumFilter(field, f) { numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } } }

function isFilterActive(field, type) {
  if (type === 'date') {
    if (field === 'order_date') return orderDateFilter.value.validDates.size > 0 || orderDateFilter.value.hasEmpty
    if (field === 'due_date') return dueDateFilter.value.validDates.size > 0 || dueDateFilter.value.hasEmpty
  }
  return !!textFilters.value[field]?.applied || !!numFilters.value[field]?.applied
}
function onSort(field, sortBy, dir) { sortState.value = { field, sortBy, dir } }

// 导入
const importDialogVisible = ref(false)
const importFile = ref(null)
const importPreview = ref(null)
const importing = ref(false)

function toggleSelect(id) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedIds.value = s
}
function toggleSelectAll() {
  if (isAllSelected.value) selectedIds.value = new Set()
  else selectedIds.value = new Set(filteredRecords.value.map(r => r.id))
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.size} 条记录？`, '批量删除', { type: 'warning' })
    const ids = [...selectedIds.value]
    let ok = 0, fail = 0
    for (const id of ids) {
      try { await api.delete(`/style-color-size/${id}`); ok++ } catch { fail++ }
    }
    selectedIds.value = new Set()
    ElMessage.success(`删除完成：${ok} 成功，${fail} 失败`)
    loadRecords()
  } catch (e) { if (e !== 'cancel') ElMessage.error('批量删除失败') }
}

const filteredRecords = computed(() => {
  let list = records.value
  // 关键字搜索
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    list = list.filter(r =>
      (r.style_no || '').toLowerCase().includes(kw) ||
      (r.product_name || '').toLowerCase().includes(kw) ||
      (r.color || '').toLowerCase().includes(kw) ||
      (r.size_spec || '').toLowerCase().includes(kw)
    )
  }
  // 日期筛选
  if (orderDateFilter.value.validDates.size > 0 || orderDateFilter.value.hasEmpty) {
    list = list.filter(r => {
      const d = (r.order_date || '').slice(0, 10)
      if (d && orderDateFilter.value.validDates.has(d)) return true
      if (!d && orderDateFilter.value.hasEmpty) return true
      return false
    })
  }
  if (dueDateFilter.value.validDates.size > 0 || dueDateFilter.value.hasEmpty) {
    list = list.filter(r => {
      const d = (r.due_date || '').slice(0, 10)
      if (d && dueDateFilter.value.validDates.has(d)) return true
      if (!d && dueDateFilter.value.hasEmpty) return true
      return false
    })
  }
  // 文本筛选
  for (const [field, f] of Object.entries(textFilters.value)) {
    if (!f.applied) continue
    if (f.validValues && f.validValues.size > 0) {
      list = list.filter(r => {
        const v = String(r[field] || '')
        return f.validValues.has(v) || (f.hasEmpty && !v)
      })
    }
  }
  // 数字筛选
  for (const [field, f] of Object.entries(numFilters.value)) {
    if (!f.applied) continue
    if (f.min !== undefined && f.min !== null) list = list.filter(r => Number(r[field]) >= f.min)
    if (f.max !== undefined && f.max !== null) list = list.filter(r => Number(r[field]) <= f.max)
  }
  // 排序
  if (sortState.value.field) {
    const { field, sortBy, dir } = sortState.value
    const d = dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      if (sortBy === 'count') {
        const ac = list.filter(x => x[field] === a[field]).length
        const bc = list.filter(x => x[field] === b[field]).length
        return (ac - bc) * d
      }
      if (sortBy === 'date') {
        return ((a[field] || '').localeCompare(b[field] || '')) * d
      }
      const av = a[field] ?? '', bv = b[field] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * d
      return String(av).localeCompare(String(bv)) * d
    })
  }
  return list
})

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadRecords(), 300)
}

async function loadRecords() {
  loading.value = true
  try {
    const { data } = await api.get('/style-color-size', { params: { keyword: searchKeyword.value } })
    records.value = data || []
    nextTick(() => computeFilterOptions())
  } catch { ElMessage.error('加载失败') }
  loading.value = false
}

function fmtDate(d) {
  if (!d) return ''
  if (typeof d === 'string' && d.includes('T')) return d.slice(0, 10)
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
    await api.put(`/style-color-size/${editForm.value.id}`, editForm.value)
    ElMessage.success('修改成功')
    editingId.value = null
    await loadRecords()
  } catch { ElMessage.error('修改失败') }
}

async function remove(id) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    await api.delete(`/style-color-size/${id}`)
    ElMessage.success('删除成功')
    await loadRecords()
  } catch (e) { if (e !== 'cancel') ElMessage.error('删除失败') }
}

// 导出
function exportExcel() {
  window.open('/api/style-color-size/export', '_blank')
}

// 新增
const createDialogVisible = ref(false)
const createForm = ref({})

function openCreate() {
  createForm.value = {
    order_date: '', style_no: '', due_date: '', product_name: '',
    size_spec: '', color: '', plan_qty: 0,
  }
  createDialogVisible.value = true
}

async function doCreate() {
  if (!createForm.value.style_no) { ElMessage.warning('请输入款式'); return }
  try {
    await api.post('/style-color-size', createForm.value)
    ElMessage.success('新增成功')
    createDialogVisible.value = false
    await loadRecords()
  } catch { ElMessage.error('新增失败') }
}

// 导入
function triggerImport() { importDialogVisible.value = true; importFile.value = null; importPreview.value = null }
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
      '订单日期': 'order_date', '款式': 'style_no', '交期': 'due_date',
      '产品名': 'product_name', '规格': 'size_spec', '颜色': 'color', '原单量': 'plan_qty',
    }
    const colMap = {}
    headers.forEach((h, i) => { if (headerMap[h]) colMap[i] = headerMap[h] })
    const parsed = []
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
      if (item.style_no || item.color) parsed.push(item)
    }
    importPreview.value = parsed
  } catch (e) { ElMessage.error('解析失败: ' + e.message) }
  importing.value = false
}

async function confirmImport() {
  if (!importPreview.value?.length) return
  importing.value = true
  try {
    const { data } = await api.post('/style-color-size/import', { records: importPreview.value })
    ElMessage.success(`导入完成: ${data.imported} 条`)
    importDialogVisible.value = false
    importPreview.value = null
    importFile.value = null
    await loadRecords()
  } catch (e) { ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message)) }
  importing.value = false
}

// 拖拽滚动
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
  <div class="scs-page">
    <div class="toolbar">
      <el-input v-model="searchKeyword" placeholder="搜索款式、产品名、颜色、规格..." clearable @input="onSearchInput" style="width:300px" />
      <el-button type="primary" @click="openCreate">+ 新增记录</el-button>
      <el-button @click="exportExcel">导出 Excel</el-button>
      <el-button @click="triggerImport">导入 Excel</el-button>
    </div>

    <div v-if="!records.length && !loading" class="empty-state">暂无数据，点击上方按钮导入</div>

    <div v-if="selectedCount > 0" class="batch-bar">
      <span class="batch-count">已选 {{ selectedCount }} 项</span>
      <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
      <el-button size="small" text @click="selectedIds = new Set()">取消选择</el-button>
    </div>

    <div class="excel-wrap">
      <div class="excel-body" @mousedown="onDragStart">
        <table class="excel-table">
          <thead>
            <tr>
              <th style="width:40px;text-align:center">
                <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" class="chk" />
              </th>
              <th v-for="col in columns" :key="col.field" :style="{ width: col.width + 'px', minWidth: col.width + 'px' }">
                <div class="col-header">
                  <DateFilter v-if="col.type==='date' && col.field==='order_date'" :data="records" :field="col.field" :label="col.label" @filter="onOrderDateFilter" :active="isFilterActive('order_date', 'date')" />
                  <DateFilter v-else-if="col.type==='date' && col.field==='due_date'" :data="records" :field="col.field" :label="col.label" @filter="onDueDateFilter" :active="isFilterActive('due_date', 'date')" />
                  <NumberFilter v-else-if="col.type==='number'" :data="records" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" @filter="f => onNumFilter(col.field, f)" @sort="onSort" :active="isFilterActive(col.field)" />
                  <TextFilter v-else :data="records" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" @filter="f => onTextFilter(col.field, f)" @sort="onSort" :active="isFilterActive(col.field)" />
                </div>
              </th>
              <th style="width:120px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRecords" :key="row.id" :class="{ 'editing-row': editingId === row.id, 'selected-row': selectedIds.has(row.id) }">
              <td class="chk-cell" style="width:40px">
                <input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggleSelect(row.id)" class="chk" />
              </td>
              <td v-for="col in columns" :key="col.field" :style="{ width: col.width + 'px', minWidth: col.width + 'px' }"
                  :class="{ 'num': col.type === 'number' }">
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
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增弹窗 -->
    <el-dialog v-model="createDialogVisible" title="新增分色分尺码" width="700px" destroy-on-close>
      <el-form :model="createForm" label-width="80px" label-position="right">
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="订单日期"><el-input v-model="createForm.order_date" type="date" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="交期"><el-input v-model="createForm.due_date" type="date" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="产品名"><el-input v-model="createForm.product_name" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="款式" required><el-input v-model="createForm.style_no" placeholder="必填" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="规格"><el-input v-model="createForm.size_spec" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="原单量"><el-input-number v-model="createForm.plan_qty" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="24"><el-form-item label="颜色"><el-input v-model="createForm.color" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入分色分尺码 Excel" width="600px">
      <div style="margin-bottom:12px">
        <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
        <span v-if="importFile" style="margin-left:8px;color:var(--primary-dark)">{{ importFile.name }}</span>
      </div>
      <div style="margin-bottom:8px;font-size:12px;color:var(--text-secondary)">
        Excel 表头必须包含：订单日期、款式、交期、产品名、规格、颜色、原单量
      </div>
      <div v-if="importFile" style="margin-bottom:12px">
        <el-button @click="doImportParse" type="primary" :loading="importing">解析预览</el-button>
      </div>
      <div v-if="importPreview?.length" style="max-height:300px;overflow:auto">
        <div style="margin-bottom:4px;font-size:12px;color:var(--text-secondary)">共 {{ importPreview.length }} 条</div>
        <el-table :data="importPreview.slice(0, 20)" size="small" border max-height="220">
          <el-table-column label="款式" width="160"><template #default="{row}">{{ row.style_no }}</template></el-table-column>
          <el-table-column label="产品名" width="80"><template #default="{row}">{{ row.product_name }}</template></el-table-column>
          <el-table-column label="规格" width="60"><template #default="{row}">{{ row.size_spec }}</template></el-table-column>
          <el-table-column label="颜色" width="120"><template #default="{row}">{{ row.color }}</template></el-table-column>
          <el-table-column label="原单量" width="80"><template #default="{row}">{{ row.plan_qty }}</template></el-table-column>
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
.scs-page { display: flex; flex-direction: column; height: 100%; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.batch-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--primary-light); border-radius: var(--radius); margin-bottom: 12px; }
.batch-count { font-size: 13px; color: var(--primary); font-weight: 600; }
.empty-state { text-align: center; padding: 60px; color: var(--text-tertiary); }
.excel-wrap { flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
.excel-wrap.dragging, .excel-wrap.dragging td, .excel-wrap.dragging th, .excel-wrap.dragging input { user-select: none !important; }
.excel-body { overflow: auto; flex: 1; }
.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); min-width: 100%; width: 100%; }
.excel-table thead th { padding: 0; background: var(--card); color: var(--text-tertiary); font-size: 11px; font-weight: 500; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap; position: sticky; top: 0; z-index: 3; }
.excel-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-light); white-space: nowrap; text-align: center; }
.col-header { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px; }
.chk-cell { text-align: center; }
.chk { width: 15px; height: 15px; cursor: pointer; accent-color: var(--primary); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.inp { width: 100%; border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 12px; text-align: inherit; background: #fff; }
.inp:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-light); }
.editing-row { background: var(--primary-light); }
.selected-row { background: #ede9fe; }
.action-cell { white-space: nowrap; }
.excel-table tbody tr:hover { background: #f8f9ff; }
</style>
