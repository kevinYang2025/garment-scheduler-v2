<script setup>
import { ref, onMounted, computed, nextTick, onUnmounted } from 'vue'
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

// ========== 缝制每日计划（数据来源：预排总计划） ==========
const mainPlans = ref([])

async function loadMainPlan() {
  try {
    const { data } = await api.getMainPlan()
    mainPlans.value = (data || []).filter(r => r.sewing_start && r.sewing_end)
  } catch { /* ignore */ }
}

const _d = new Date()
const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`

// 日期窗口导航
const viewOffset = ref(0)
function shiftWeek(dir) { viewOffset.value += dir * 7 }

// 所有缝制日期范围
const sewingDateCols = computed(() => {
  if (!mainPlans.value.length) return []
  let min = null, max = null
  for (const m of mainPlans.value) {
    if (m.sewing_start && (!min || m.sewing_start < min)) min = m.sewing_start
    if (m.sewing_end && (!max || m.sewing_end > max)) max = m.sewing_end
  }
  if (!min || !max) return []
  const sd = new Date(min + 'T00:00:00'), ed = new Date(max + 'T00:00:00')
  const days = Math.floor((ed - sd) / 86400000) + 1
  const cols = []
  for (let i = 0; i < days; i++) {
    const dt = new Date(sd); dt.setDate(dt.getDate() + i)
    cols.push(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`)
  }
  return cols
})

// 可见日期列（滚动窗口）
const visibleSewingDates = computed(() => {
  const d = new Date(today + 'T00:00:00')
  const ws = new Date(d); ws.setDate(ws.getDate() - 7 + viewOffset.value)
  const we = new Date(d); we.setDate(we.getDate() + 21 + viewOffset.value)
  const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
  return sewingDateCols.value.filter(c => c >= fmt(ws) && c <= fmt(we))
})

const sewingDateRangeLabel = computed(() => {
  if (!visibleSewingDates.value.length) return ''
  return visibleSewingDates.value[0].slice(5) + ' ~ ' + visibleSewingDates.value[visibleSewingDates.value.length - 1].slice(5)
})

// 每日计划产量计算
function calcSewingPlanQty(master, date) {
  if (date < master.sewing_start || date > master.sewing_end) return 0
  const daily = calcDailyTarget(master)
  if (!daily) return 0
  const sd = new Date(master.sewing_start + 'T00:00:00')
  const cd = new Date(date + 'T00:00:00')
  const dayIdx = Math.floor((cd - sd) / 86400000)
  const fullDays = Math.floor(master.plan_qty / daily)
  const remainder = master.plan_qty % daily
  if (dayIdx < fullDays) return daily
  if (dayIdx === fullDays && remainder > 0) return remainder
  return 0
}

function calcDailyTarget(master) {
  if (!master.plan_qty || !master.sewing_start || !master.sewing_end) return 0
  const days = Math.ceil((new Date(master.sewing_end + 'T00:00:00') - new Date(master.sewing_start + 'T00:00:00')) / 86400000) + 1
  return Math.ceil(master.plan_qty / days)
}

// 每款合计
function sewingPlanSum(master) {
  return sewingDateCols.value.reduce((s, d) => s + calcSewingPlanQty(master, d), 0)
}

function fmtDate(v) { return v ? (v.includes('T') ? v.slice(0, 10) : v) : '' }
function dateLabel(d) { return d ? d.slice(5) : '' }

// 拖拽滚动
const sewingBodyRef = ref(null)
let sDragging = false, sDragX = 0, sDragY = 0, sDragSL = 0, sDragST = 0, sDragWrap = null
function sOnDragStart(e) {
  if (e.target.tagName !== 'TD' && e.target.tagName !== 'TH') return
  sDragWrap = e.currentTarget; sDragging = true
  sDragX = e.pageX; sDragY = e.pageY
  sDragSL = sDragWrap.scrollLeft; sDragST = sDragWrap.scrollTop
  sDragWrap.classList.add('dragging'); e.preventDefault()
}
function sOnDragMove(e) {
  if (!sDragging || !sDragWrap) return
  sDragWrap.scrollLeft = sDragSL - (e.pageX - sDragX)
  sDragWrap.scrollTop = sDragST - (e.pageY - sDragY)
}
function sOnDragEnd() {
  if (sDragWrap) sDragWrap.classList.remove('dragging')
  sDragging = false; sDragWrap = null
}

onMounted(() => {
  load()
  if (props.scheduleType === 'cutting') {
    loadMainPlan()
  }
  const body = sewingBodyRef.value
  if (body) {
    body.addEventListener('mousedown', sOnDragStart)
    document.addEventListener('mousemove', sOnDragMove)
    document.addEventListener('mouseup', sOnDragEnd)
  }
})
onUnmounted(() => {
  const body = sewingBodyRef.value
  if (body) body.removeEventListener('mousedown', sOnDragStart)
  document.removeEventListener('mousemove', sOnDragMove)
  document.removeEventListener('mouseup', sOnDragEnd)
})
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

    <!-- ========== 缝制每日计划（数据来源：预排总计划） ========== -->
    <div v-if="scheduleType === 'cutting' && mainPlans.length" class="sewing-section">
      <div class="sewing-header">
        <h3>缝制每日计划</h3>
        <div class="sewing-nav">
          <button class="nav-btn" @click="shiftWeek(-1)">&laquo;</button>
          <button class="nav-btn today-btn" @click="viewOffset=0">今天</button>
          <button class="nav-btn" @click="shiftWeek(1)">&raquo;</button>
          <span class="date-range-label">{{ sewingDateRangeLabel }}</span>
        </div>
      </div>

      <div ref="sewingBodyRef" class="excel-wrap">
        <table class="excel-table">
          <thead>
            <tr>
              <th class="fix" style="min-width:100px">
                <div class="col-header"><span>款号</span></div>
              </th>
              <th class="fix" style="min-width:130px">
                <div class="col-header"><span>品名</span></div>
              </th>
              <th class="fix" style="min-width:80px">
                <div class="col-header"><span>计划数量</span></div>
              </th>
              <th class="fix" style="min-width:90px">
                <div class="col-header"><span>目标日产量</span></div>
              </th>
              <th class="fix" style="min-width:100px">
                <div class="col-header"><span>缝制开始</span></div>
              </th>
              <th class="fix" style="min-width:100px">
                <div class="col-header"><span>缝制结束</span></div>
              </th>
              <th class="fix" style="min-width:60px">
                <div class="col-header"><span>车间</span></div>
              </th>
              <th class="fix" style="min-width:60px">
                <div class="col-header"><span>班组</span></div>
              </th>
              <th class="fix" style="min-width:70px">
                <div class="col-header"><span>合计</span></div>
              </th>
              <th class="fix" style="min-width:50px">
                <div class="col-header"><span>类型</span></div>
              </th>
              <th v-for="d in visibleSewingDates" :key="d" class="date-th" :class="{ 'today-col': d === today }">{{ dateLabel(d) }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="m in mainPlans" :key="m.id">
              <!-- 计划行 -->
              <tr class="row-plan">
                <td class="fix">{{ m.style_no }}</td>
                <td class="fix">{{ m.product_name }}</td>
                <td class="fix num">{{ m.plan_qty?.toLocaleString() }}</td>
                <td class="fix num">{{ calcDailyTarget(m).toLocaleString() }}</td>
                <td class="fix">{{ fmtDate(m.sewing_start) }}</td>
                <td class="fix">{{ fmtDate(m.sewing_end) }}</td>
                <td class="fix">{{ m.workshop || '' }}</td>
                <td class="fix">{{ m.line_team || '' }}</td>
                <td class="fix num sum-cell">{{ sewingPlanSum(m).toLocaleString() }}</td>
                <td class="fix type-label plan-label">计划</td>
                <td v-for="d in visibleSewingDates" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today }">
                  {{ calcSewingPlanQty(m, d) || '' }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

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

/* ========== 缝制每日计划样式 ========== */
.sewing-section {
  margin-top: 32px;
  border-top: 2px solid var(--primary);
  padding-top: 20px;
}
.sewing-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; gap: 12px;
}
.sewing-header h3 { margin: 0; font-size: 16px; font-weight: 700; color: var(--text); }
.sewing-nav { display: flex; align-items: center; gap: 6px; }
.nav-btn {
  padding: 5px 10px; background: var(--primary); color: #fff; border: none;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-weight: 500;
  transition: var(--transition); line-height: 1;
}
.nav-btn:hover { background: var(--primary-hover); }
.nav-btn.today-btn { font-weight: 600; padding: 5px 12px; }
.date-range-label { font-size: 13px; font-weight: 600; color: var(--text); margin-left: 4px; }

.excel-wrap {
  overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card);
}
.excel-wrap.dragging, .excel-wrap.dragging td, .excel-wrap.dragging th { user-select: none !important; }

.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); min-width: 100%; }
.excel-table thead th {
  padding: 0; background: var(--card); color: var(--text-tertiary);
  font-size: 11px; font-weight: 500; letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;
  position: sticky; top: 0; z-index: 3;
}
.excel-table td {
  padding: 10px 14px; border-bottom: 1px solid var(--border-light);
  white-space: nowrap; text-align: center;
}
.col-header {
  display: flex; flex-direction: row; align-items: center;
  justify-content: flex-start; padding: 10px 14px; gap: 4px;
}
.col-header span { font-weight: 500; font-size: 11px; flex-shrink: 0; color: var(--text-tertiary); letter-spacing: 0.3px; }

.row-plan { background: var(--card); }
tbody tr:hover td:not(.fix) { background: var(--primary-light); }

.fix { position: sticky; left: 0; z-index: 1; background: inherit; }
.row-plan .fix { background: var(--card); }
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
.plan-label { color: var(--primary); }
.cell-num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }
</style>
