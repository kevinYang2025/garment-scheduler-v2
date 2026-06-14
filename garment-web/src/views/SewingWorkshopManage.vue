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

// 行内编辑（支持多行）
const editingMap = ref({}) // { [rowKey]: newName }
const editingKeys = computed(() => Object.keys(editingMap.value))
const isEditing = (key) => key in editingMap.value

// 新增弹窗
const dialogVisible = ref(false)
const dialogForm = ref({ name: '', type: 'workshop', parent_id: null, parentName: '' })

// 导入
const importVisible = ref(false)
const importFile = ref(null)
const importResult = ref(null)
const importing = ref(false)

// 批量选择
const selectedIds = ref(new Set())
const isAllSelected = computed(() => {
  if (filteredRows.value.length === 0) return false
  return filteredRows.value.every(r => selectedIds.value.has(rowKey(r)))
})
const isIndeterminate = computed(() => {
  const n = filteredRows.value.filter(r => selectedIds.value.has(rowKey(r))).length
  return n > 0 && n < filteredRows.value.length
})
function toggleAll() {
  const s = new Set(selectedIds.value)
  if (isAllSelected.value) {
    filteredRows.value.forEach(r => s.delete(rowKey(r)))
  } else {
    filteredRows.value.forEach(r => s.add(rowKey(r)))
  }
  selectedIds.value = s
}
function toggleRow(row) {
  const s = new Set(selectedIds.value)
  const k = rowKey(row)
  if (s.has(k)) s.delete(k); else s.add(k)
  selectedIds.value = s
}

// 批量编辑弹窗（快捷操作：前缀/后缀/替换）
const batchEditVisible = ref(false)
const batchEditForm = ref({ mode: 'prefix', text: '', text2: '' })
const batchEditModes = [
  { value: 'prefix', label: '加前缀' },
  { value: 'suffix', label: '加后缀' },
  { value: 'replace', label: '替换文本' },
  { value: 'rename', label: '统一重命名' },
]

// 拖动滚动
const bodyRef = ref(null)
let dragging = false
let dragWrap = null
let dragX = 0, dragY = 0, dragSL = 0, dragST = 0

// ====== 扁平化树 → 三列表格 ======
const typeMap = { workshop: '车间', team: '班组', category: '款式分类' }
function rowKey(row) { return row.type + '-' + row.id }

const flatRows = computed(() => {
  const rows = []
  function walk(nodes, pw, pt) {
    for (const node of (nodes || [])) {
      if (node.type === 'workshop') {
        rows.push({ ...node, workshopName: node.name, teamName: '', categoryName: '' })
        walk(node.children, node.name, '')
      } else if (node.type === 'team') {
        rows.push({ ...node, workshopName: pw, teamName: node.name, categoryName: '' })
        walk(node.children, pw, node.name)
      } else {
        rows.push({ ...node, workshopName: pw, teamName: pt, categoryName: node.name })
      }
    }
  }
  walk(treeData.value, '', '')
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
  const fields = ['workshopName', 'teamName', 'categoryName']
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

// 名称验证
const nameRules = {
  workshop: { re: /^\d+$/, tip: '车间名称只能是数字（如 1、2、12）' },
  team: { re: /^\d+(-\d+)?班$/, tip: '班组名称格式：数字+班（如 1班、2-2班）' },
}
function validateName(type, name) {
  const rule = nameRules[type]
  if (!rule) return true // category 无限制
  if (!rule.re.test(name)) { ElMessage.warning(rule.tip); return false }
  return true
}

// ====== 行内编辑 ======
function startEdit(row) {
  editingMap.value = { [rowKey(row)]: row.name }
}
function cancelEdit() {
  editingMap.value = {}
}
function getEditingName(key) {
  return editingMap.value[key] ?? ''
}
function setEditingName(key, val) {
  editingMap.value = { ...editingMap.value, [key]: val }
}
async function saveEdit(row) {
  const k = rowKey(row)
  const newName = (editingMap.value[k] || '').trim()
  if (!newName) { ElMessage.warning('名称不能为空'); return }
  if (!validateName(row.type, newName)) return
  if (newName === row.name) { cancelEdit(); return }
  try {
    await api.updateSewingWorkshopNode(row.id, { type: row.type, name: newName })
    ElMessage.success('修改成功')
    cancelEdit()
    loadTree()
  } catch (e) {
    ElMessage.error('修改失败：' + (e.response?.data?.error || e.message))
  }
}
async function saveAllEdits() {
  const keys = Object.keys(editingMap.value)
  let changed = 0
  for (const k of keys) {
    const row = flatRows.value.find(r => rowKey(r) === k)
    if (!row) continue
    const newName = editingMap.value[k].trim()
    if (!newName || newName === row.name) continue
    if (!validateName(row.type, newName)) continue
    try {
      await api.updateSewingWorkshopNode(row.id, { type: row.type, name: newName })
      changed++
    } catch (e) {
      ElMessage.error(`「${row.name}」修改失败：${e.response?.data?.error || e.message}`)
    }
  }
  if (changed) ElMessage.success(`修改 ${changed} 项成功`)
  cancelEdit()
  loadTree()
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
  if (!validateName(f.type, f.name.trim())) return
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

// ====== 批量操作 ======
async function batchDelete() {
  const keys = [...selectedIds.value]
  if (!keys.length) return
  const msg = `确定删除选中的 ${keys.length} 项？子节点将一并删除。`
  try { await ElMessageBox.confirm(msg, '批量删除', { type: 'warning' }) } catch { return }
  try {
    for (const k of keys) {
      const row = flatRows.value.find(r => rowKey(r) === k)
      if (row) await api.deleteSewingWorkshopNode(row.id, row.type)
    }
    ElMessage.success(`删除 ${keys.length} 项成功`)
    selectedIds.value = new Set()
    loadTree()
  } catch (e) {
    ElMessage.error('删除失败：' + (e.response?.data?.error || e.message))
    loadTree()
  }
}

function openBatchEdit() {
  if (!selectedIds.value.size) { ElMessage.warning('请先选择要编辑的行'); return }
  // 所有选中行进入行内编辑
  const map = {}
  for (const k of selectedIds.value) {
    const row = flatRows.value.find(r => rowKey(r) === k)
    if (row) map[k] = row.name
  }
  editingMap.value = map
}

// 快捷批量操作（前缀/后缀/替换）
function openBatchEditDialog() {
  if (!selectedIds.value.size) { ElMessage.warning('请先选择要编辑的行'); return }
  batchEditForm.value = { mode: 'prefix', text: '', text2: '' }
  batchEditVisible.value = true
}
async function doBatchEdit() {
  const { mode, text } = batchEditForm.value
  if (!text.trim()) { ElMessage.warning('请输入内容'); return }
  const keys = [...selectedIds.value]
  try {
    for (const k of keys) {
      const row = flatRows.value.find(r => rowKey(r) === k)
      if (!row) continue
      let newName = row.name
      if (mode === 'prefix') newName = text.trim() + row.name
      else if (mode === 'suffix') newName = row.name + text.trim()
      else if (mode === 'replace') newName = row.name.replaceAll(text.trim(), batchEditForm.value.text2 || '')
      else if (mode === 'rename') newName = text.trim()
      if (newName !== row.name) {
        await api.updateSewingWorkshopNode(row.id, { type: row.type, name: newName })
      }
    }
    ElMessage.success(`批量编辑完成`)
    batchEditVisible.value = false
    selectedIds.value = new Set()
    loadTree()
  } catch (e) {
    ElMessage.error('批量编辑失败：' + (e.response?.data?.error || e.message))
    loadTree()
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
        <template v-if="editingKeys.length">
          <el-button type="primary" @click="saveAllEdits">保存全部 ({{ editingKeys.length }})</el-button>
          <el-button @click="cancelEdit">取消</el-button>
        </template>
        <template v-else>
          <el-button type="primary" @click="openAdd(null)">新增车间</el-button>
          <el-button v-if="selectedIds.size" type="warning" @click="openBatchEdit">批量编辑 ({{ selectedIds.size }})</el-button>
          <el-button v-if="selectedIds.size" type="danger" @click="batchDelete">批量删除 ({{ selectedIds.size }})</el-button>
          <el-divider v-if="!selectedIds.size" direction="vertical" />
          <el-button @click="doExport">导出Excel</el-button>
          <el-button @click="openImport">导入Excel</el-button>
        </template>
      </div>
    </div>

    <div class="excel-wrap">
      <div class="excel-body" ref="bodyRef" v-loading="loading">
        <table class="excel-table">
          <colgroup>
            <col style="width:40px" />
            <col style="min-width:200px" />
            <col style="min-width:200px" />
            <col style="min-width:200px" />
            <col style="width:260px" />
          </colgroup>
          <thead>
            <tr>
              <th style="text-align:center">
                <el-checkbox :model-value="isAllSelected" :indeterminate="isIndeterminate" @change="toggleAll" />
              </th>
              <th>
                <div class="col-header">
                  <TextFilter :data="flatRows" field="workshopName" label="车间" :precomputed="precomputedOptions.workshopName" @filter="f => onTextFilter('workshopName', f)" @sort="onSort" />
                </div>
              </th>
              <th>
                <div class="col-header">
                  <TextFilter :data="flatRows" field="teamName" label="班组" :precomputed="precomputedOptions.teamName" @filter="f => onTextFilter('teamName', f)" @sort="onSort" />
                </div>
              </th>
              <th>
                <div class="col-header">
                  <TextFilter :data="flatRows" field="categoryName" label="款式分类" :precomputed="precomputedOptions.categoryName" @filter="f => onTextFilter('categoryName', f)" @sort="onSort" />
                </div>
              </th>
              <th style="width:260px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="rowKey(row)" :class="{ 'editing-row': isEditing(rowKey(row)) }">
              <td style="text-align:center">
                <el-checkbox :model-value="selectedIds.has(rowKey(row))" @change="toggleRow(row)" />
              </td>
              <!-- 车间列 -->
              <td>
                <template v-if="row.type === 'workshop'">
                  <span class="type-tag workshop">车间</span>
                  <template v-if="isEditing(rowKey(row))">
                    <input class="inp" :model-value="getEditingName(rowKey(row))" @input="setEditingName(rowKey(row), $event.target.value)" @keyup.enter="saveEdit(row)" @keyup.escape="cancelEdit" style="width:160px" />
                  </template>
                  <template v-else>
                    <span class="node-name">{{ row.workshopName }}</span>
                  </template>
                </template>
                <template v-else>
                  <span class="node-name" style="color:var(--text-secondary)">{{ row.workshopName }}</span>
                </template>
              </td>
              <!-- 班组列 -->
              <td>
                <template v-if="row.type === 'team'">
                  <span class="type-tag team">班组</span>
                  <template v-if="isEditing(rowKey(row))">
                    <input class="inp" :model-value="getEditingName(rowKey(row))" @input="setEditingName(rowKey(row), $event.target.value)" @keyup.enter="saveEdit(row)" @keyup.escape="cancelEdit" style="width:160px" />
                  </template>
                  <template v-else>
                    <span class="node-name">{{ row.teamName }}</span>
                  </template>
                </template>
                <template v-else-if="row.teamName">
                  <span class="node-name" style="color:var(--text-secondary)">{{ row.teamName }}</span>
                </template>
              </td>
              <!-- 款式分类列 -->
              <td>
                <template v-if="row.type === 'category'">
                  <span class="type-tag category">款式分类</span>
                  <template v-if="isEditing(rowKey(row))">
                    <input class="inp" :model-value="getEditingName(rowKey(row))" @input="setEditingName(rowKey(row), $event.target.value)" @keyup.enter="saveEdit(row)" @keyup.escape="cancelEdit" style="width:160px" />
                  </template>
                  <template v-else>
                    <span class="node-name">{{ row.categoryName }}</span>
                  </template>
                </template>
              </td>
              <!-- 操作列 -->
              <td class="action-cell">
                <template v-if="isEditing(rowKey(row))">
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

    <!-- 新增弹窗 -->
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

    <!-- 批量编辑弹窗 -->
    <el-dialog v-model="batchEditVisible" :title="'批量编辑 (' + selectedIds.size + ' 项)'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="操作">
          <el-select v-model="batchEditForm.mode" style="width:100%">
            <el-option v-for="m in batchEditModes" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="batchEditForm.mode === 'replace'" label="查找">
          <el-input v-model="batchEditForm.text" placeholder="要替换的文本" />
        </el-form-item>
        <el-form-item v-if="batchEditForm.mode === 'replace'" label="替换为">
          <el-input v-model="batchEditForm.text2" placeholder="替换后的文本（留空则删除）" />
        </el-form-item>
        <el-form-item v-if="batchEditForm.mode === 'rename'" label="新名称">
          <el-input v-model="batchEditForm.text" placeholder="统一重命名为" />
        </el-form-item>
        <el-form-item v-if="batchEditForm.mode === 'prefix'" label="前缀">
          <el-input v-model="batchEditForm.text" placeholder="在名称前添加" />
        </el-form-item>
        <el-form-item v-if="batchEditForm.mode === 'suffix'" label="后缀">
          <el-input v-model="batchEditForm.text" placeholder="在名称后添加" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchEditVisible = false">取消</el-button>
        <el-button type="primary" @click="doBatchEdit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workshop-manage {
  max-width: 1200px;
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
