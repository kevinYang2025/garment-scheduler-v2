<script setup>
import { ref, onMounted, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import StylePicker from '../components/StylePicker.vue'
import DailyScheduleTable from '../components/DailyScheduleTable.vue'

const props = defineProps({
  scheduleType: String,
  secondaryType: { type: String, default: '' },
  db: Object,
})

const masters = ref([])
const dialogVisible = ref(false)
const form = ref({})
const selectedStyle = ref(null)
const expandedSet = ref(new Set())
const expandedRows = computed(() => Array.from(expandedSet.value))
const editingId = ref(null)
const editForm = ref({})

const defaultForm = () => ({
  style_id: null, style_no: '', product_name: '', color: '', size_spec: '',
  plan_qty: 0, plan_start: '', plan_end: '',
  workshop: '', line_team: '', secondary_type: ''
})

const title = computed(() => {
  return props.scheduleType === 'cutting' ? '裁剪排程' :
         props.scheduleType === 'secondary' ? '二次加工排程' :
         props.scheduleType === 'sewing' ? '缝制排程' : '排程'
})

const secondaryTypes = [
  { label: '印花', value: 'printing' },
  { label: '刺绣', value: 'embroidery' },
  { label: '模板', value: 'template' },
  { label: '烫标', value: 'ironing' },
]

const filteredMasters = computed(() => {
  if (props.scheduleType === 'secondary' && props.secondaryType) {
    return masters.value.filter(m => m.secondary_type === props.secondaryType)
  }
  return masters.value
})

async function load() {
  try {
    const { data } = await api.getSchedule(props.scheduleType)
    masters.value = data
  } catch (e) {
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
    if (props.scheduleType === 'secondary' && props.secondaryType) {
      form.value.secondary_type = props.secondaryType
    }
    await api.createSchedule(props.scheduleType, form.value)
    dialogVisible.value = false
    ElMessage.success('创建成功')
    load()
  } catch (e) {
    ElMessage.error('创建失败')
  }
}

async function remove(id) {
  try {
    await ElMessageBox.confirm('确定删除该排程?', '提示', { type: 'warning' })
    await api.deleteSchedule(props.scheduleType, id)
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
    await api.updateSchedule(props.scheduleType, editForm.value.id, editForm.value)
    ElMessage.success('保存成功')
    editingId.value = null
    load()
  } catch (e) {
    ElMessage.error('保存失败')
  }
}

function openCreate() {
  form.value = defaultForm()
  selectedStyle.value = null
  dialogVisible.value = true
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">+ 新排程</el-button>
    </div>

    <el-table :data="filteredMasters" size="small" border stripe style="width:100%"
              row-key="id" :expand-row-keys="expandedRows"
              @expand-change="(row, expanded) => toggleExpand(row)">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="expand-content">
            <DailyScheduleTable
              :master-id="row.id"
              :schedule-type="scheduleType"
              :style-no="row.style_no"
              :color="row.color"
              :size-spec="row.size_spec"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="style_no" label="款号" width="100" />
      <el-table-column prop="product_name" label="品名" width="120" />
      <el-table-column prop="color" label="颜色" width="70" />
      <el-table-column prop="size_spec" label="规格" width="70" />
      <el-table-column prop="plan_qty" label="计划数" width="80" align="right" />
      <el-table-column label="计划上线" width="130">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <el-input v-model="editForm.plan_start" type="date" size="small" />
          </template>
          <template v-else>{{ row.plan_start }}</template>
        </template>
      </el-table-column>
      <el-table-column label="计划下线" width="130">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <el-input v-model="editForm.plan_end" type="date" size="small" />
          </template>
          <template v-else>{{ row.plan_end }}</template>
        </template>
      </el-table-column>
      <el-table-column v-if="scheduleType === 'secondary'" label="工序" width="80">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <el-select v-model="editForm.secondary_type" size="small" style="width:100%">
              <el-option v-for="t in secondaryTypes" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
          </template>
          <template v-else>{{ secondaryTypes.find(t => t.value === row.secondary_type)?.label || row.secondary_type }}</template>
        </template>
      </el-table-column>
      <el-table-column v-if="scheduleType === 'sewing'" label="车间" width="80">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <el-input v-model="editForm.workshop" size="small" />
          </template>
          <template v-else>{{ row.workshop }}</template>
        </template>
      </el-table-column>
      <el-table-column v-if="scheduleType === 'sewing'" label="班组" width="80">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <el-input v-model="editForm.line_team" size="small" />
          </template>
          <template v-else>{{ row.line_team }}</template>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <el-button size="small" text type="primary" @click="saveEdit">保存</el-button>
            <el-button size="small" text @click="cancelEdit">取消</el-button>
          </template>
          <template v-else>
            <el-button size="small" text @click="toggleExpand(row)">
              {{ expandedRows.includes(row.id) ? '收起' : '展开' }}
            </el-button>
            <el-button size="small" text @click="startEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="remove(row.id)">删除</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="新增排程" width="550px">
      <el-form :model="form" label-width="80px" size="small">
        <el-form-item label="选择款式">
          <StylePicker @select="onStyleSelect" />
        </el-form-item>
        <el-form-item v-if="selectedStyle" label="已选款式">
          <span style="color:var(--primary-dark)">{{ selectedStyle.style_no }} - {{ selectedStyle.product_name }} {{ selectedStyle.color }} {{ selectedStyle.size_spec }}</span>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="计划上线"><el-input v-model="form.plan_start" type="date" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="计划下线"><el-input v-model="form.plan_end" type="date" /></el-form-item>
          </el-col>
        </el-row>
        <el-form-item v-if="scheduleType === 'secondary'" label="工序类型">
          <el-select v-model="form.secondary_type" style="width:160px">
            <el-option v-for="t in secondaryTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-row v-if="scheduleType === 'sewing'" :gutter="12">
          <el-col :span="12">
            <el-form-item label="车间"><el-input v-model="form.workshop" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="班组"><el-input v-model="form.line_team" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="create">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page { max-width: 1400px; }
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.toolbar h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text); }
.expand-content { padding: 12px 20px; background: var(--border-light); border-radius: var(--radius-sm); margin: 4px 0; }
</style>
