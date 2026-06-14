<script setup>
import { ref, computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import TextFilter from '../components/TextFilter.vue'

const treeData = ref([])
const loading = ref(false)

// 筛选排序
const textFilters = ref({})
const sortState = ref({ field: '', dir: 'asc' })
const precomputedOptions = shallowRef({})

// 行内编辑
const editingId = ref(null)
const editingName = ref('')

// 新增弹窗
const dialogVisible = ref(false)
const dialogForm = ref({ name: '', type: 'workshop', parent_id: null, parentName: '' })

// 导入
const importVisible = ref(false)
const importFile = ref(null)
const importResult = ref(null)
const importing = ref(false)

// 拖动滚动
const bodyRef = ref(null)
let dragging = false
let dragWrap = null
let dragX = 0, dragY = 0, dragSL = 0, dragST = 0

// ====== 扁平化树 ======
const typeMap = { workshop: '车间', team: '班组', category: '款式分类' }

const flatRows = computed(() => {
  const rows = []
  function walk(nodes, depth, parentWorkshop, parentTeam) {
    for (const node of (nodes || [])) {
      const row = { ...node, depth, parentWorkshop, parentTeam, typeText: typeMap[node.type] || node.type }
      if (node.type === 'workshop') {
        row.parentWorkshop = node.name
        rows.push(row)
        walk(node.children, depth + 1, node.name, null)
      } else if (node.type === 'team') {
        row.parentTeam = node.name
        rows.push(row)
        walk(node.children, depth + 1, parentWorkshop, node.name)
      } else {
        rows.push(row)
      }
    }
  }
  walk(treeData.value, 0, '', '')
  return rows
})

const filteredRows = computed(() => {
  return flatRows.value.filter(r => {
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
    const { field, dir } = sortState.value
    const mul = dir === 'asc' ? 1 : -1
    const va = a[field] || ''
    const vb = b[field] || ''
    return va.localeCompare(vb, 'zh') * mul
  })
})

function computeFilterOptions() {
  const fields = ['name', 'typeText']
  const result = {}
  for (const f of fields) {
    const map = {}
    let emptyCount = 0
    for (const row of flatRows.value) {
      const val = row[f]
      if (val === undefined || val === null || val === '') { emptyCount++; continue }
      map[String(val)] = (map[String(val)] || 0) + 1
    }
    result[f] = { options: Object.entries(map).map(([text, count]) => ({ text, count })), emptyCount }
  }
  precomputedOptions.value = result
}

function onTextFilter(field, f) {
  textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } }
}
function onSort({ field, dir }) {
  sortState.value = { field, dir }
}

// ====== 通用 ======
async function loadTree() {
  loading.value = true
  try {
    const { data } = await api.getSewingWorkshopTree()
    treeData.value = Array.isArray(data) ? data : []
    computeFilterOptions()
  } catch {
    ElMessage.error('加载数据失败')
  }
  loading.value = false
}

function typeLabel(type) {
  return typeMap[type] || type
}

function childType(type) {
  return { workshop: 'team', team: 'category' }[type] || null
}

function canAddChild(type) {
  return type === 'workshop' || type === 'team'
}

// ====== 行内编辑 ======
function startEdit(row) {
  editingId.value = row.id
  editingName.value = row.name
}
function cancelEdit() {
  editingId.value = null
  editingName.value = ''
}
async function saveEdit(row) {
  if (!editingName.value.trim()) { ElMessage.warning('名称不能为空'); return }
  if (editingName.value.trim() === row.name) { cancelEdit(); return }
  try {
    await api.updateSewingWorkshopNode(row.id, { type: row.type, name: editingName.value.trim() })
    ElMessage.success('修改成功')
    cancelEdit()
    loadTree()
  } catch (e) {
    ElMessage.error('修改失败：' + (e.response?.data?.error || e.message))
  }
}

// ====== 新增 ======
function openAdd(row) {
  if (row) {
    dialogForm.value = { name: '', type: childType(row.type), parent_id: row.id, parentName: row.name }
  } else {
    dialogForm.value = { name: '', type: 'workshop', parent_id: null, parentName: '' }
  }
  dialogVisible.value = true
}

async function saveNode() {
  const f = dialogForm.value
  if (!f.name.trim()) { ElMessage.warning('请输入名称'); return }
  try {
    await api.addSewingWorkshopNode({ type: f.type, name: f.name.trim(), parent_id: f.parent_id })
    ElMessage.success('新增成功')
    dialogVisible.value = false
    loadTree()
  } catch (e) {
    ElMessage.error('操作失败：' + (e.response?.data?.error || e.message))
  }
}

// ====== 删除 ======
async function deleteNode(row) {
  const childCount = row.children?.length || 0
  const msg = childCount > 0
    ? `确定删除「${row.name}」？将同时删除其下 ${childCount} 个子项。`
    : `确定删除「${row.name}」？`
  try { await ElMessageBox.confirm(msg, '删除确认', { type: 'warning' }) } catch { return }
  try {
    await api.deleteSewingWorkshopNode(row.id, row.type)
    ElMessage.success('删除成功')
    loadTree()
  } catch (e) {
    ElMessage.error('删除失败：' + (e.response?.data?.error || e.message))
  }
}

// ====== 拖动滚动 ======
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

// ====== 导出 ======
async function doExport() {
  try {
    const { data } = await api.exportSewingWorkshopTree()
    const url = URL.createObjectURL(new Blob([data]))
    const a = document.createElement('a')
    a.href = url
    a.download = '车间班组款式分类.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  } catch { ElMessage.error('导出失败') }
}

// ====== 导入 ======
function openImport() {
  importFile.value = null
  importResult.value = null
  importVisible.value = true
}

function onImportFileChange(e) {
  importFile.value = e.target.files[0]
  importResult.value = null
}

async function doImport() {
  if (!importFile.value) return
  importing.value = true
  try {
    const { data } = await api.importSewingWorkshopTree(importFile.value)
    importResult.value = data
    ElMessage.success(`导入完成：新增 ${data.added} 条，跳过 ${data.skipped} 条`)
    loadTree()
  } catch (e) {
    ElMessage.error('导入失败：' + (e.response?.data?.error || e.message))
  }
  importing.value = false
}

onMounted(() => {
  loadTree()
  // Drag-to-scroll on body (same pattern as Styles.vue)
  const body = bodyRef.value
  if (body) {
    body.addEventListener('mousedown', onDragStart)
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }
})
onUnmounted(() => {
  if (bodyRef.value) bodyRef.value.removeEventListener('mousedown', onDragStart)
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <div class="workshop-manage">
    <div class="wm-header">
      <h2>缝制车间管理</h2>
      <div class="wm-actions">
        <el-button type="primary" @click="openAdd(null)">新增车间</el-button>
        <el-divider direction="vertical" />
        <el-button @click="doExport">导出Excel</el-button>
        <el-button @click="openImport">导入Excel</el-button>
      </div>
    </div>

    <div class="excel-wrap">
      <div class="excel-body" ref="bodyRef" v-loading="loading">
        <table class="excel-table">
          <colgroup>
            <col style="min-width:300px" />
            <col style="width:120px" />
            <col style="width:260px" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <div class="col-header">
                  <TextFilter :data="flatRows" field="name" label="名称" :precomputed="precomputedOptions.name" @filter="f => onTextFilter('name', f)" @sort="onSort" />
                </div>
              </th>
              <th style="width:120px">
                <div class="col-header">
                  <TextFilter :data="flatRows" field="typeText" label="类型" :precomputed="precomputedOptions.typeText" @filter="f => onTextFilter('typeText', f)" @sort="onSort" />
                </div>
              </th>
              <th style="width:260px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.id" :class="{ 'editing-row': editingId === row.id }">
              <td>
                <span :style="{ paddingLeft: row.depth * 24 + 'px' }">
                  <span class="type-tag" :class="row.type">{{ typeLabel(row.type) }}</span>
                  <template v-if="editingId === row.id">
                    <input class="inp" v-model="editingName" @keyup.enter="saveEdit(row)" @keyup.escape="cancelEdit" style="width:200px" />
                  </template>
                  <template v-else>
                    <span class="node-name">{{ row.name }}</span>
                  </template>
                </span>
              </td>
              <td>{{ typeLabel(row.type) }}</td>
              <td class="action-cell">
                <template v-if="editingId === row.id">
                  <el-button size="small" type="primary" text @click="saveEdit(row)">保存</el-button>
                  <el-button size="small" text @click="cancelEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button v-if="canAddChild(row.type)" size="small" type="primary" text @click="openAdd(row)">
                    新增{{ typeLabel(childType(row.type)) }}
                  </el-button>
                  <el-button size="small" type="warning" text @click="startEdit(row)">编辑</el-button>
                  <el-button size="small" type="danger" text @click="deleteNode(row)">删除</el-button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增弹窗（仅新增用） -->
    <el-dialog v-model="dialogVisible" :title="'新增' + typeLabel(dialogForm.type)" width="400px">
      <el-form label-width="80px">
        <el-form-item v-if="dialogForm.parentName" label="上级">
          <el-input :model-value="dialogForm.parentName" readonly />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="dialogForm.name" :placeholder="'请输入' + typeLabel(dialogForm.type) + '名称'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveNode">确定</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importVisible" title="导入Excel" width="500px">
      <div style="margin-bottom:12px;font-size:13px;color:#666">
        Excel格式：列顺序为「车间」「班组」「款式分类」，首行为表头。同名分类自动跳过。
      </div>
      <div style="margin-bottom:12px">
        <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
        <span v-if="importFile" style="margin-left:8px;color:#409eff">{{ importFile.name }}</span>
      </div>
      <div v-if="importResult" style="margin-bottom:12px;color:#67c23a">
        导入完成：新增 {{ importResult.added }} 条，跳过 {{ importResult.skipped }} 条
      </div>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" @click="doImport" :loading="importing" :disabled="!importFile">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workshop-manage {
  max-width: 1100px;
}
.wm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}
.wm-header h2 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
.wm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.excel-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.excel-body {
  overflow: auto;
  max-height: calc(100vh - 200px);
}

.excel-table td, .excel-table th {
  cursor: default;
}
.excel-table td *, .excel-table th * {
  cursor: text;
}

.excel-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.excel-table th {
  background: #f5f7fa;
  border-bottom: 2px solid var(--border);
  text-align: left;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 2;
}
.excel-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  text-align: left;
  overflow: hidden;
  word-break: break-all;
  line-height: 1.5;
}
.excel-body tbody tr:hover td { background: var(--primary-light); }
.editing-row td {
  background: var(--primary-light) !important;
  box-shadow: inset 3px 0 0 var(--primary);
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

.type-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  margin-right: 8px;
  color: #fff;
}
.type-tag.workshop { background: #409eff; }
.type-tag.team { background: #67c23a; }
.type-tag.category { background: #e6a23c; }
.node-name { font-size: 14px; }

.inp {
  border: 1px solid var(--primary);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 14px;
  outline: none;
}
.inp:focus { box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2); }

.action-cell { white-space: nowrap; }
</style>
