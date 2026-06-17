<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import StylePicker from '../components/StylePicker.vue'
import DailyScheduleTable from '../components/DailyScheduleTable.vue'
import PrintingPlanDetail from './PrintingPlanDetail.vue'
import EmbroideryPlanDetail from './EmbroideryPlanDetail.vue'
import TemplatePlanDetail from './TemplatePlanDetail.vue'
import IroningPlanDetail from './IroningPlanDetail.vue'
import { useVirtualScroll } from '../composables/useVirtualScroll'

// 虚拟滚动（行高 50px：el-table 默认小号行高）
const vs = useVirtualScroll(50, 8)

const props = defineProps({
  secondaryType: { type: String, required: true },
  db: Object,
})

const emit = defineEmits(['back'])

// 排程元数据
const secondaryMeta = {
  printing: { label: '印花排程', icon: '🎨' },
  embroidery: { label: '刺绣排程', icon: '🧵' },
  template: { label: '模板排程', icon: '📐' },
  ironing: { label: '烫标排程', icon: '🔥' },
}

const meta = computed(() => secondaryMeta[props.secondaryType] || { label: '', icon: '' })

// TODO: 权限判断接口，后续对接实际权限系统
// 每个排程模块独立权限：view/edit/import/export
function hasPermission(perm) {
  // eslint-disable-next-line no-unused-vars
  const _p = perm
  return true
}

// ========== 排程列表 ==========
const masters = ref([])
const dialogVisible = ref(false)
const form = ref({})
const selectedStyle = ref(null)
const expandedSet = ref(new Set())
const expandedRows = computed(() => Array.from(expandedSet.value))
const editingId = ref(null)
const editForm = ref({})

// 虚拟滚动切片：每个 master = 1 行（不含展开行；展开行作为附加 tr 紧跟主行）
const vtStartIndex = computed(() => Math.max(0, Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows))
const vtVisibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
const vtVisibleRows = computed(() => masters.value.slice(vtStartIndex.value, vtStartIndex.value + vtVisibleCount.value))

const defaultForm = () => ({
  style_id: null, style_no: '', product_name: '', color: '', size_spec: '',
  plan_qty: 0, plan_start: '', plan_end: '',
  workshop: '', line_team: '', secondary_type: props.secondaryType,
})

async function load() {
  try {
    const { data } = await api.getSchedule('secondary', props.secondaryType)
    masters.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error('加载排程失败')
  }
}

function onStyleSelect(style) {
  selectedStyle.value = style
  form.value.style_id = style.id
  form.value.style_no = style.style_no
  form.value.product_name = style.product_name
  form.value.color = style.color
  form.value.size_spec = style.size_spec
  form.value.plan_qty = style.plan_qty
}

async function create() {
  try {
    if (!form.value.style_id) {
      ElMessage.warning('请先选择款式')
      return
    }
    if (!form.value.plan_start || !form.value.plan_end) {
      ElMessage.warning('请填写计划上线和下线日期')
      return
    }
    form.value.secondary_type = props.secondaryType
    await api.createSchedule('secondary', form.value)
    dialogVisible.value = false
    ElMessage.success('创建成功')
    load()
  } catch {
    ElMessage.error('创建失败')
  }
}

async function remove(id) {
  try {
    await ElMessageBox.confirm('确定删除该排程?', '提示', { type: 'warning' })
    await api.deleteSchedule('secondary', id)
    ElMessage.success('删除成功')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

function toggleExpand(row) {
  if (expandedSet.value.has(row.id)) {
    expandedSet.value.delete(row.id)
  } else {
    expandedSet.value.add(row.id)
  }
  expandedSet.value = new Set(expandedSet.value)
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
    await api.updateSchedule('secondary', editForm.value.id, editForm.value)
    ElMessage.success('保存成功')
    editingId.value = null
    load()
  } catch {
    ElMessage.error('保存失败')
  }
}

function openCreate() {
  form.value = defaultForm()
  selectedStyle.value = null
  dialogVisible.value = true
}

// ========== 导入功能 ==========
const importDialogVisible = ref(false)
const importFile = ref(null)
const importData = ref([])
const importMode = ref('skip')
const importLoading = ref(false)

// Excel列映射严格按照用户提供的《二次加工排程模板.xlsx》调整
const ALLOWED_COLUMNS = ['款号', '品名', '颜色', '规格', '计划数量', '计划上线', '计划下线', '工序类型', '车间', '班组']

const previewColumns = computed(() => {
  if (!importData.value.length) return []
  const rawKeys = Object.keys(importData.value[0])
  return rawKeys.filter(k => ALLOWED_COLUMNS.includes(k))
})

function handleFileSelect(file) {
  importFile.value = file
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(e.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (!json.length) {
        ElMessage.warning('文件为空或无有效数据')
        importData.value = []
        return
      }
      importData.value = json
    } catch {
      ElMessage.error('文件解析失败，请检查文件格式')
      importData.value = []
    }
  }
  reader.onerror = () => {
    ElMessage.error('文件读取失败，请重试')
    importData.value = []
  }
  reader.readAsArrayBuffer(file)
}

function openImport() {
  importFile.value = null
  importData.value = []
  importMode.value = 'skip'
  importDialogVisible.value = true
}

async function doImport() {
  if (!importData.value.length) {
    ElMessage.warning('没有可导入的数据')
    return
  }
  importLoading.value = true
  try {
    const { data } = await api.importSchedule('secondary', importData.value, importMode.value)
    if (data.errors && data.errors.length > 0) {
      ElMessage.warning(`导入完成：成功 ${data.imported} 条，跳过 ${data.skipped} 条，失败 ${data.errors.length} 条`)
    } else {
      ElMessage.success(`导入成功：${data.imported} 条，跳过 ${data.skipped} 条`)
    }
    importDialogVisible.value = false
    load()
  } catch (e) {
    console.error('导入失败', e)
    ElMessage.error('导入失败，请检查文件格式和数据内容')
  }
  importLoading.value = false
}

// ========== 导出功能 ==========
async function doExport() {
  try {
    const XLSX = await import('xlsx')
    const { data } = await api.exportSchedule('secondary', props.secondaryType)
    if (!Array.isArray(data) || !data.length) {
      ElMessage.warning('没有可导出的数据')
      return
    }

    // Excel列映射严格按照用户提供的《二次加工排程模板.xlsx》调整
    const exportRows = data.map(r => ({
      '款号': r['款号'] || '',
      '品名': r['品名'] || '',
      '颜色': r['颜色'] || '',
      '规格': r['规格'] || '',
      '计划数量': r['计划数量'] || 0,
      '计划上线': r['计划上线'] || '',
      '计划下线': r['计划下线'] || '',
      '工序类型': r['工序类型'] || '',
      '车间': r['车间'] || '',
      '班组': r['班组'] || '',
    }))

    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '排程数据')

    // 设置列宽
    ws['!cols'] = [
      { wch: 10 }, { wch: 15 }, { wch: 8 }, { wch: 8 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
      { wch: 8 }, { wch: 8 },
    ]

    const _d = new Date()
    const today = `${_d.getFullYear()}${String(_d.getMonth()+1).padStart(2,'0')}${String(_d.getDate()).padStart(2,'0')}`
    const filename = `${meta.value.label}_${today}.xlsx`
    XLSX.writeFile(wb, filename)
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败')
  }
}

watch(() => props.secondaryType, () => {
  expandedSet.value = new Set()
  editingId.value = null
  editForm.value = {}
  load()
})
function scrollToTop() {
  const el = document.querySelector('.vt-container, .excel-body, .excel-wrap')
  if (el) el.scrollTop = 0
}

onMounted(load)
</script>

<template>
  <PrintingPlanDetail v-if="secondaryType === 'printing'" @back="emit('back')" />
  <EmbroideryPlanDetail v-else-if="secondaryType === 'embroidery'" @back="emit('back')" />
  <IroningPlanDetail v-else-if="secondaryType === 'ironing'" @back="emit('back')" />
  <TemplatePlanDetail v-else-if="secondaryType === 'template'" @back="emit('back')" />
  <div v-else class="secondary-detail">
    <!-- 顶部操作栏 -->
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="emit('back')">
          <span style="margin-right:4px">←</span> 返回
        </el-button>
        <h2>{{ meta.icon }} {{ meta.label }}</h2>
      </div>
      <div class="header-actions">
        <!-- 权限控制点：导入 -->
        <el-button
          v-if="hasPermission(`secondary:${secondaryType}:import`)"
          type="primary"
          @click="openImport"
        >
          导入Excel
        </el-button>
        <!-- 权限控制点：导出 -->
        <el-button
          v-if="hasPermission(`secondary:${secondaryType}:export`)"
          @click="doExport"
        >
          导出Excel
        </el-button>
        <!-- 权限控制点：新增 -->
        <el-button
          v-if="hasPermission(`secondary:${secondaryType}:edit`)"
          type="success"
          @click="openCreate"
        >
          新增排程
        </el-button>
      </div>
    </div>

    <!-- 排程列表（自实现虚拟滚动，绕开 el-table-v2 兼容问题） -->
    <div ref="vs.container" class="vt-container" @scroll="vs.onScroll">
      <table class="excel-table">
        <colgroup>
          <col style="width:40px">
          <col style="width:100px"><col style="width:140px"><col style="width:80px"><col style="width:80px">
          <col style="width:90px"><col style="width:130px"><col style="width:130px">
          <col style="width:180px">
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>款号</th>
            <th>品名</th>
            <th>颜色</th>
            <th>规格</th>
            <th>计划数</th>
            <th>计划上线</th>
            <th>计划下线</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- 顶部占位 -->
          <tr v-if="vtStartIndex > 0" :style="{ height: (vtStartIndex * vs.rowHeight) + 'px' }">
            <td :colspan="9" style="padding:0;border:0"></td>
          </tr>
          <template v-for="row in vtVisibleRows" :key="row.id">
            <tr :class="{ 'editing-row': editingId === row.id }">
              <td>
                <span class="collapse-btn" @click="toggleExpand(row)">
                  {{ expandedSet.has(row.id) ? '▼' : '▶' }}
                </span>
              </td>
              <td>{{ row.style_no }}</td>
              <td>{{ row.product_name }}</td>
              <td>{{ row.color }}</td>
              <td>{{ row.size_spec }}</td>
              <td class="num">{{ row.plan_qty?.toLocaleString() }}</td>
              <td>
                <el-input v-if="editingId === row.id" v-model="editForm.plan_start" type="date" size="small" />
                <span v-else>{{ row.plan_start }}</span>
              </td>
              <td>
                <el-input v-if="editingId === row.id" v-model="editForm.plan_end" type="date" size="small" />
                <span v-else>{{ row.plan_end }}</span>
              </td>
              <td>
                <template v-if="editingId === row.id">
                  <el-button size="small" text type="primary" @click="saveEdit">保存</el-button>
                  <el-button size="small" text @click="cancelEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button size="small" text @click="toggleExpand(row)">
                    {{ expandedSet.has(row.id) ? '收起' : '展开' }}
                  </el-button>
                  <el-button
                    v-if="hasPermission(`secondary:${secondaryType}:edit`)"
                    size="small" text @click="startEdit(row)"
                  >编辑</el-button>
                  <el-button
                    v-if="hasPermission(`secondary:${secondaryType}:edit`)"
                    size="small" text type="danger" @click="remove(row.id)"
                  >删除</el-button>
                </template>
              </td>
            </tr>
            <!-- 展开行：固定高度 240px，包含 DailyScheduleTable -->
            <tr v-if="expandedSet.has(row.id)" class="expand-row">
              <td :colspan="9" style="padding:12px;background:var(--bg)">
                <DailyScheduleTable
                  :master-id="row.id"
                  schedule-type="secondary"
                  :style-no="row.style_no"
                  :color="row.color"
                  :size-spec="row.size_spec"
                />
              </td>
            </tr>
          </template>
          <!-- 底部占位 -->
          <tr v-if="(vtStartIndex + vtVisibleRows.length) < masters.length" :style="{ height: ((masters.length - vtStartIndex - vtVisibleRows.length) * vs.rowHeight) + 'px' }">
            <td :colspan="9" style="padding:0;border:0"></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 新增排程弹窗 -->
    <el-dialog v-model="dialogVisible" title="新增排程" width="550px">
      <el-form :model="form" label-width="80px" size="small">
        <el-form-item label="选择款式">
          <StylePicker @select="onStyleSelect" />
        </el-form-item>
        <el-form-item v-if="selectedStyle" label="已选款式">
          <span style="color:var(--primary-dark)">
            {{ selectedStyle.style_no }} - {{ selectedStyle.product_name }}
            {{ selectedStyle.color }} {{ selectedStyle.size_spec }}
          </span>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="计划上线">
              <el-input v-model="form.plan_start" type="date" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="计划下线">
              <el-input v-model="form.plan_end" type="date" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="create">创建</el-button>
      </template>
    </el-dialog>

    <!-- 导入Excel弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入Excel" width="700px" :close-on-click-modal="false">
      <div class="import-step" v-if="!importData.length">
        <el-upload
          :auto-upload="false"
          :limit="1"
          accept=".xlsx,.xls"
          :on-change="(f) => handleFileSelect(f.raw)"
          drag
        >
          <div class="upload-placeholder">
            <span style="font-size:36px">📁</span>
            <p>点击或拖拽Excel文件到此处</p>
            <p style="font-size:11px;color:var(--text-tertiary)">仅支持 .xlsx 和 .xls 格式</p>
          </div>
        </el-upload>
      </div>

      <div class="import-step" v-else>
        <div class="import-info">
          <span>已选择：<strong>{{ importFile?.name }}</strong></span>
          <span style="color:var(--text-secondary)">共 {{ importData.length }} 条数据</span>
        </div>

        <div class="import-mode">
          <span class="mode-label">导入模式：</span>
          <el-radio-group v-model="importMode" size="small">
            <el-radio value="skip">跳过重复数据</el-radio>
            <el-radio value="overwrite">覆盖已有排程</el-radio>
          </el-radio-group>
        </div>

        <el-table :data="importData.slice(0, 10)" size="small" border max-height="300" style="margin-top:12px">
          <el-table-column
            v-for="col in previewColumns"
            :key="col"
            :label="col"
            :prop="col"
            min-width="100"
          />
        </el-table>
        <p v-if="importData.length > 10" style="margin-top:8px;font-size:12px;color:var(--text-secondary)">
          仅显示前10条预览，共 {{ importData.length }} 条
        </p>
      </div>

      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button
          v-if="importData.length"
          type="primary"
          :loading="importLoading"
          @click="doImport"
        >
          导入全部
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.vt-container {
  flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card);
}
.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); width: 100%; }
.excel-table thead th {
  padding: 12px 14px; background: var(--card); color: var(--text-tertiary); font-size: 11px;
  font-weight: 500; letter-spacing: 0.3px; border-bottom: 1px solid var(--border);
  text-align: center; white-space: nowrap; position: sticky; top: 0; z-index: 3;
}
.excel-table td {
  padding: 8px 14px; border-bottom: 1px solid var(--border-light); white-space: nowrap; text-align: center;
  height: 50px;
}
.excel-table tbody tr:hover td { background: var(--primary-light); }
.editing-row td { background: var(--primary-light) !important; }
.num { text-align: right !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }
.collapse-btn {
  cursor: pointer; user-select: none; font-size: 10px; color: var(--text-tertiary);
  transition: color 0.15s;
}
.collapse-btn:hover { color: var(--primary); }
.expand-row td { padding: 0 !important; }
</style>

<style scoped>
.secondary-detail {
  max-width: 1400px;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-left h2 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
.header-actions {
  display: flex;
  gap: 10px;
}
.expand-content {
  padding: 12px 20px;
  background: var(--border-light);
  border-radius: var(--radius-sm);
  margin: 4px 0;
}

/* 导入 */
.upload-placeholder {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}
.upload-placeholder p {
  margin-top: 8px;
  font-size: 13px;
}
.import-info {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  font-size: 13px;
}
.import-mode {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.mode-label {
  font-size: 13px;
  color: var(--text-secondary);
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
