<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const treeData = ref([])
const loading = ref(false)

// 单条弹窗
const dialogVisible = ref(false)
const dialogMode = ref('add')
const dialogForm = ref({ name: '', type: 'workshop', parent_id: null, parentName: '' })

// 批量添加弹窗
const batchAddVisible = ref(false)
const batchAddTeamId = ref(null)
const batchAddNames = ref('')

// 批量编辑模式
const batchEditMode = ref(false)
const batchEditChanges = ref({}) // { 'type:id': newName }

// 导入
const importVisible = ref(false)
const importFile = ref(null)
const importResult = ref(null)
const importing = ref(false)

// 用于下拉选择班组
const allTeams = computed(() => {
  const teams = []
  for (const w of treeData.value) {
    for (const t of (w.children || [])) {
      teams.push({ id: t.id, label: `${w.name} / ${t.name}` })
    }
  }
  return teams
})

async function loadTree() {
  loading.value = true
  try {
    const { data } = await api.getSewingWorkshopTree()
    treeData.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error('加载数据失败')
  }
  loading.value = false
}

function typeLabel(type) {
  return { workshop: '车间', team: '班组', category: '款式分类' }[type] || type
}

function childType(type) {
  return { workshop: 'team', team: 'category' }[type] || null
}

function canAddChild(type) {
  return type === 'workshop' || type === 'team'
}

// ====== 单条新增/编辑 ======
function openAdd(row) {
  dialogMode.value = 'add'
  if (row) {
    dialogForm.value = { name: '', type: childType(row.type), parent_id: row.id, parentName: row.name }
  } else {
    dialogForm.value = { name: '', type: 'workshop', parent_id: null, parentName: '' }
  }
  dialogVisible.value = true
}

function openEdit(row) {
  dialogMode.value = 'edit'
  dialogForm.value = { id: row.id, name: row.name, type: row.type }
  dialogVisible.value = true
}

async function saveNode() {
  const f = dialogForm.value
  if (!f.name.trim()) { ElMessage.warning('请输入名称'); return }
  try {
    if (dialogMode.value === 'add') {
      await api.addSewingWorkshopNode({ type: f.type, name: f.name.trim(), parent_id: f.parent_id })
      ElMessage.success('新增成功')
    } else {
      await api.updateSewingWorkshopNode(f.id, { type: f.type, name: f.name.trim() })
      ElMessage.success('修改成功')
    }
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

// ====== 批量添加 ======
function openBatchAdd() {
  batchAddTeamId.value = null
  batchAddNames.value = ''
  batchAddVisible.value = true
}

async function saveBatchAdd() {
  if (!batchAddTeamId.value) { ElMessage.warning('请选择班组'); return }
  const names = batchAddNames.value.split('\n').map(s => s.trim()).filter(Boolean)
  if (!names.length) { ElMessage.warning('请输入至少一个款式分类名称'); return }
  try {
    const items = names.map(name => ({ line_id: batchAddTeamId.value, name }))
    const { data } = await api.batchAddCategories(items)
    ElMessage.success(`成功添加 ${data.added} 个款式分类`)
    batchAddVisible.value = false
    loadTree()
  } catch (e) {
    ElMessage.error('批量添加失败：' + (e.response?.data?.error || e.message))
  }
}

// ====== 批量编辑 ======
function startBatchEdit() {
  batchEditMode.value = true
  batchEditChanges.value = {}
}

function cancelBatchEdit() {
  batchEditMode.value = false
  batchEditChanges.value = {}
}

function onBatchEditInput(row, val) {
  batchEditChanges.value[`${row.type}:${row.id}`] = val
}

function getBatchEditValue(row) {
  const key = `${row.type}:${row.id}`
  return batchEditChanges.value[key] !== undefined ? batchEditChanges.value[key] : row.name
}

async function saveBatchEdit() {
  const items = []
  for (const [key, newName] of Object.entries(batchEditChanges.value)) {
    const [type, id] = key.split(':')
    if (newName && newName.trim()) {
      items.push({ id: Number(id), type, name: newName.trim() })
    }
  }
  if (!items.length) { batchEditMode.value = false; return }
  try {
    const { data } = await api.batchUpdateNodes(items)
    ElMessage.success(`成功修改 ${data.updated} 条`)
    batchEditMode.value = false
    batchEditChanges.value = {}
    loadTree()
  } catch (e) {
    ElMessage.error('批量修改失败：' + (e.response?.data?.error || e.message))
  }
}

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
  } catch (e) {
    ElMessage.error('导出失败')
  }
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

onMounted(loadTree)
</script>

<template>
  <div class="workshop-manage">
    <div class="wm-header">
      <h2>缝制车间管理</h2>
      <div class="wm-actions">
        <el-button v-if="!batchEditMode" type="primary" @click="openAdd(null)">新增车间</el-button>
        <el-button v-if="!batchEditMode" type="success" @click="openBatchAdd">批量添加</el-button>
        <el-button v-if="!batchEditMode" type="warning" @click="startBatchEdit">批量编辑</el-button>
        <template v-if="batchEditMode">
          <el-button type="primary" @click="saveBatchEdit">保存修改</el-button>
          <el-button @click="cancelBatchEdit">取消编辑</el-button>
          <span class="batch-hint">直接点击名称可编辑，修改后点保存</span>
        </template>
        <el-divider v-if="!batchEditMode" direction="vertical" />
        <el-button v-if="!batchEditMode" @click="doExport">导出Excel</el-button>
        <el-button v-if="!batchEditMode" @click="openImport">导入Excel</el-button>
      </div>
    </div>

    <el-table
      :data="treeData"
      row-key="id"
      :tree-props="{ children: 'children' }"
      v-loading="loading"
      border
      stripe
      default-expand-all
      style="width: 100%"
    >
      <el-table-column prop="name" label="名称" min-width="300">
        <template #default="{ row }">
          <span class="type-tag" :class="row.type">{{ typeLabel(row.type) }}</span>
          <el-input
            v-if="batchEditMode"
            :model-value="getBatchEditValue(row)"
            size="small"
            style="width: 240px"
            @input="val => onBatchEditInput(row, val)"
          />
          <span v-else class="node-name">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="120">
        <template #default="{ row }">{{ typeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column v-if="!batchEditMode" label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canAddChild(row.type)" size="small" type="primary" text @click="openAdd(row)">
            新增{{ typeLabel(childType(row.type)) }}
          </el-button>
          <el-button size="small" type="warning" text @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" text @click="deleteNode(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 单条新增/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'add' ? '新增' + typeLabel(dialogForm.type) : '编辑' + typeLabel(dialogForm.type)"
      width="400px"
    >
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

    <!-- 批量添加弹窗 -->
    <el-dialog v-model="batchAddVisible" title="批量添加款式分类" width="500px">
      <el-form label-width="80px">
        <el-form-item label="选择班组" required>
          <el-select v-model="batchAddTeamId" filterable placeholder="选择班组" style="width:100%">
            <el-option v-for="t in allTeams" :key="t.id" :label="t.label" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类名称">
          <el-input
            v-model="batchAddNames"
            type="textarea"
            :rows="8"
            placeholder="每行一个款式分类名称&#10;例如：&#10;T恤类&#10;卫衣类&#10;裤类"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchAddVisible = false">取消</el-button>
        <el-button type="primary" @click="saveBatchAdd">确认添加</el-button>
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
  max-width: 960px;
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
.batch-hint {
  font-size: 12px;
  color: #e6a23c;
  margin-left: 4px;
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
.node-name {
  font-size: 14px;
}
</style>
