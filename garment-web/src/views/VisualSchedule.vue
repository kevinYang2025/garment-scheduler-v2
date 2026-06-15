<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const props = defineProps({ db: Object })
const emit = defineEmits(['back'])

const workshops = ref([])
const unscheduled = ref([])
const loading = ref(false)
const draggedItem = ref(null)
const ganttLeftRef = ref(null)
const ganttRightRef = ref(null)
const filterWorkshop = ref('')
const filterLine = ref('')
const weekOffset = ref(0) // 周偏移量，0 = 默认视图

// 筛选后的车间列表
const filteredWorkshops = computed(() => {
  let result = workshops.value
  if (filterWorkshop.value) {
    result = result.filter(ws => ws.name === filterWorkshop.value)
  }
  if (filterLine.value) {
    result = result.map(ws => ({
      ...ws,
      lines: ws.lines.filter(l => l.name.includes(filterLine.value))
    })).filter(ws => ws.lines.length > 0)
  }
  return result
})
const ganttConfig = ref({
  barFields: ['styleNo', 'planQty'],
  tooltipFields: ['styleNo', 'productName', 'planQty', 'sewingStart', 'sewingEnd'],
  leftFields: ['workshop', 'lineTeam'],
})

// 字段显示名称映射
const fieldLabels = {
  styleNo: '款号', productName: '品名', planQty: '计划数量',
  sewingStart: '缝制开始', sewingEnd: '缝制结束',
  cuttingStart: '裁剪开始', cuttingEnd: '裁剪结束',
  secondaryType: '二次加工类型',
  workshop: '车间', lineTeam: '班组',
  color: '颜色', sizeSpec: '规格', dueDate: '交期',
  priority: '优先级',
}

function getFieldValue(task, field) {
  const val = task[field]
  if (val === undefined || val === null || val === '') return '-'
  if (field === 'planQty') return val + '件'
  return val
}

function buildBarText(task) {
  return ganttConfig.value.barFields.map(f => getFieldValue(task, f)).join(' ')
}

function buildTooltip(task) {
  return ganttConfig.value.tooltipFields
    .map(f => `${fieldLabels[f] || f}: ${getFieldValue(task, f)}`)
    .join('\n')
}

// 日期列表：今天前1周 ~ 后3周，随 weekOffset 滚动
const dates = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 7 + weekOffset.value * 7)
  const end = new Date(today)
  end.setDate(end.getDate() + 21 + weekOffset.value * 7)
  const result = []
  const cur = new Date(start)
  while (cur <= end) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    result.push(`${y}-${m}-${d}`)
    cur.setDate(cur.getDate() + 1)
  }
  return result
})

// 日期行总宽度（px），确保 tasks-area 与之等宽
const datesWidth = computed(() => dates.value.length * 28)

// 周导航
function prevWeek() { weekOffset.value-- }
function nextWeek() { weekOffset.value++ }
function goToday() { weekOffset.value = 0 }

// 当前视图日期范围标题
const dateRangeLabel = computed(() => {
  if (!dates.value.length) return ''
  return dates.value[0].slice(5) + ' ~ ' + dates.value[dates.value.length - 1].slice(5)
})

// 今天日期字符串
const todayStr = computed(() => {
  const t = new Date()
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
})

// 加载甘特图数据
async function loadGantt() {
  loading.value = true
  try {
    const [ganttRes, configRes] = await Promise.all([
      api.getVisualGantt(),
      api.getGanttConfig(),
    ])
    workshops.value = ganttRes.data.workshops || []
    unscheduled.value = ganttRes.data.unscheduled || []
    if (configRes.data?.sewing) {
      ganttConfig.value = configRes.data.sewing
    }
  } catch (e) {
    console.error('加载甘特图失败:', e)
  }
  loading.value = false
}

// 拖拽开始
function onDragStart(item) {
  draggedItem.value = item
}

// 拖拽到产线
async function onDrop(workshop, line) {
  if (!draggedItem.value) return
  try {
    const res = await api.assignVisual({
      planId: draggedItem.value.planId,
      workshop: workshop.name,
      lineTeam: line.name
    })
    if (res.data.ok) {
      const { sewingStart, sewingEnd, dailyTarget } = res.data
      ElMessage.success(`排班成功：${sewingStart.slice(5)} ~ ${sewingEnd.slice(5)}，日产量 ${dailyTarget}件`)
      await loadGantt()
    } else {
      ElMessage.error(res.data.error || '排班失败')
    }
  } catch (e) {
    console.error('排班失败:', e)
  }
  draggedItem.value = null
}

// 取消排班
async function unassign(planId) {
  try {
    await ElMessageBox.confirm('确定取消该排班？', '提示', { type: 'warning' })
    await api.unassignVisual({ planId })
    ElMessage.success('已取消排班')
    await loadGantt()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('取消排班失败')
  }
}

// 计算任务在甘特图中的位置和宽度（基于可见日期范围）
function getTaskStyle(task) {
  if (!task.sewingStart || !task.sewingEnd || !dates.value.length) return { display: 'none' }
  const startDate = new Date(task.sewingStart)
  const endDate = new Date(task.sewingEnd)
  const rangeStart = new Date(dates.value[0])
  const dayWidth = 28
  const left = Math.round((startDate - rangeStart) / (1000 * 60 * 60 * 24)) * dayWidth
  const width = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24) + 1) * dayWidth
  // 任务完全在可见范围外则隐藏
  if (left + width < 0 || left > dates.value.length * dayWidth) return { display: 'none' }
  return {
    left: left + 'px',
    width: Math.max(width, dayWidth) + 'px'
  }
}

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return ''
  return dateStr.slice(5) // 只显示 MM-DD
}

// 左右同步垂直滚动
function onRightScroll() {
  if (ganttLeftRef.value && ganttRightRef.value) {
    ganttLeftRef.value.scrollTop = ganttRightRef.value.scrollTop
  }
}

onMounted(loadGantt)
</script>

<template>
  <div class="visual-schedule">
    <div class="toolbar">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="back-btn" @click="emit('back')">
          <span style="margin-right:4px">←</span> 返回
        </button>
        <select v-model="filterWorkshop" class="filter-select">
          <option value="">全部车间</option>
          <option v-for="ws in workshops" :key="ws.name" :value="ws.name">{{ ws.name }}</option>
        </select>
        <input v-model="filterLine" class="filter-input" placeholder="搜班组..." />
        <span v-if="filterWorkshop || filterLine" class="filter-clear" @click="filterWorkshop=''; filterLine=''">✕ 清除</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="nav-arrows">
          <button class="arrow-btn" @click="prevWeek" title="前一周">◀</button>
          <button class="arrow-btn today-btn" @click="goToday" title="回到今天">今天</button>
          <button class="arrow-btn" @click="nextWeek" title="后一周">▶</button>
        </span>
        <span class="date-range-label">{{ dateRangeLabel }}</span>
        <button @click="loadGantt" :disabled="loading">
          {{ loading ? '加载中...' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="content">
      <!-- 左侧：未排班款式 -->
      <div class="sidebar">
        <h4>待排班款式</h4>
        <div class="unscheduled-list">
          <div
            v-for="item in unscheduled"
            :key="item.planId"
            class="unscheduled-item"
            draggable="true"
            @dragstart="onDragStart(item)"
          >
            <div class="item-no">{{ item.styleNo }}</div>
            <div class="item-name">{{ item.productName }}</div>
            <div class="item-info">
              <span>{{ item.color }} {{ item.sizeSpec }}</span>
              <span>{{ item.planQty }}件</span>
            </div>
            <div class="item-due">交期: {{ formatDate(item.dueDate) }}</div>
          </div>
          <div v-if="unscheduled.length === 0" class="empty-hint">
            暂无待排班款式
          </div>
        </div>
      </div>

      <!-- 右侧：甘特图 -->
      <div class="gantt-wrapper">
        <!-- 左侧固定列：行标签 -->
        <div class="gantt-left" ref="ganttLeftRef">
          <div class="gantt-left-header">产线</div>
          <template v-for="workshop in filteredWorkshops" :key="'l-'+workshop.name">
            <div class="gantt-left-workshop">{{ workshop.name }}</div>
            <div
              v-for="line in workshop.lines"
              :key="'l-'+line.name"
              class="gantt-left-row"
              :class="{ 'fault-line': line.status === '故障' }"
            >
              <div class="line-name">{{ line.name }}
                <span v-if="line.status === '故障'" class="fault-badge">故障</span>
              </div>
              <div v-if="line.categories && line.categories.length" class="line-categories">
                <span v-for="cat in line.categories" :key="cat.name" class="cat-tag">{{ cat.name }}</span>
                <span class="output-tag">{{ line.categories.reduce((s, c) => s + c.dailyOutput, 0) }}件/天</span>
              </div>
            </div>
          </template>
        </div>
        <!-- 右侧可滚动区：日期 + 任务条 -->
        <div class="gantt-right" ref="ganttRightRef" @scroll="onRightScroll">
          <!-- 日期标题（sticky top） -->
          <div class="gantt-right-header">
            <div
              v-for="date in dates"
              :key="date"
              class="date-cell"
              :class="{
                weekend: new Date(date).getDay() === 0 || new Date(date).getDay() === 6,
                today: date === todayStr
              }"
            >
              {{ formatDate(date) }}
            </div>
          </div>
          <!-- 任务行 -->
          <template v-for="workshop in filteredWorkshops" :key="'r-'+workshop.name">
            <div class="gantt-right-workshop"></div>
            <div
              v-for="line in workshop.lines"
              :key="'r-'+line.name"
              class="gantt-right-row"
              :class="{ 'fault-line': line.status === '故障' }"
              @dragover.prevent
              @drop="line.status !== '故障' && onDrop(workshop, line)"
            >
              <div class="tasks-area" :style="{ minWidth: datesWidth + 'px' }">
                <div
                  v-for="task in line.tasks"
                  :key="task.planId"
                  class="gantt-bar"
                  :style="getTaskStyle(task)"
                  :title="buildTooltip(task)"
                  @dblclick="unassign(task.planId)"
                >
                  <span class="bar-text">{{ buildBarText(task) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div class="legend">
      <span class="legend-item">
        <span class="legend-color" style="background: var(--primary)"></span>
        缝制任务
      </span>
      <span class="legend-item">双击任务条可取消排班</span>
      <span class="legend-item">从左侧拖拽款式到产线完成排班</span>
    </div>
  </div>
</template>

<style scoped>
.visual-schedule {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 140px);
  background: var(--card);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.toolbar h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.toolbar .back-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  padding: 0;
  transition: var(--transition);
}
.toolbar .back-btn:hover { color: var(--primary); }

.filter-select, .filter-input {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text);
  background: var(--card);
  outline: none;
}
.filter-select:focus, .filter-input:focus {
  border-color: var(--primary);
}
.filter-input { width: 120px; }
.filter-clear {
  font-size: 12px;
  color: var(--danger);
  cursor: pointer;
  white-space: nowrap;
}
.filter-clear:hover { text-decoration: underline; }

.nav-arrows {
  display: flex;
  align-items: center;
  gap: 2px;
}
.arrow-btn {
  padding: 4px 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: var(--transition);
}
.arrow-btn:hover {
  background: var(--primary-light, #eef2ff);
  color: var(--primary);
  border-color: var(--primary);
}
.today-btn {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
}
.date-range-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  min-width: 100px;
  text-align: center;
}

.toolbar button {
  padding: 6px 16px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 500;
  transition: var(--transition);
}

.toolbar button:hover {
  background: var(--primary-dark);
}

.toolbar button:disabled {
  background: var(--border-hover);
  cursor: not-allowed;
}

.content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar h4 {
  margin: 0;
  padding: 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.unscheduled-list {
  padding: 8px;
}

.unscheduled-item {
  padding: 10px;
  margin-bottom: 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: grab;
  transition: var(--transition);
}

.unscheduled-item:hover {
  border-color: var(--primary);
  box-shadow: 0 2px 8px rgba(0,0,0,.06);
}

.unscheduled-item:active {
  cursor: grabbing;
}

.item-no {
  font-weight: 600;
  font-size: 13px;
  color: var(--primary-dark);
}

.item-name {
  font-size: 12px;
  color: var(--text);
  margin-top: 2px;
}

.item-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.item-due {
  font-size: 11px;
  color: var(--danger);
  margin-top: 4px;
}

.empty-hint {
  text-align: center;
  color: var(--text-tertiary);
  padding: 20px;
  font-size: 13px;
}

/* ===== 甘特图布局：固定左列 + 可滚动右侧 ===== */
.gantt-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

/* 左侧固定列 */
.gantt-left {
  width: 110px;
  min-width: 110px;
  flex-shrink: 0;
  border-right: 2px solid var(--border);
  background: var(--card);
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 2;
}

.gantt-left-header {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border-bottom: 2px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 3;
}

.gantt-left-workshop {
  padding: 6px 10px;
  background: var(--primary-light);
  font-weight: 600;
  font-size: 13px;
  color: var(--primary-dark);
  border-bottom: 1px solid var(--border);
}

.gantt-left-row {
  min-height: 40px;
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-bottom: 1px solid var(--border);
  text-align: center;
}

.gantt-left-row:hover {
  background: var(--bg);
}

/* 右侧可滚动区 */
.gantt-right {
  flex: 1;
  overflow: auto;
}

.gantt-right-header {
  display: flex;
  height: 40px;
  background: var(--bg);
  border-bottom: 2px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 1;
}

.gantt-right-workshop {
  height: 32px;
  background: var(--primary-light);
  border-bottom: 1px solid var(--border);
}

.gantt-right-row {
  position: relative;
  min-height: 40px;
  border-bottom: 1px solid var(--border);
}

.gantt-right-row:hover {
  background: var(--bg);
}

/* ===== 通用样式 ===== */
.line-name {
  font-weight: 600;
  font-size: 12px;
}

.line-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  justify-content: center;
}

.cat-tag {
  font-size: 10px;
  padding: 1px 4px;
  background: var(--primary-light, #eef2ff);
  color: var(--primary-dark, #3730a3);
  border-radius: 3px;
  white-space: nowrap;
  font-weight: 500;
}

.output-tag {
  font-size: 10px;
  padding: 1px 4px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 3px;
  white-space: nowrap;
  font-weight: 500;
}

.date-cell {
  width: 28px;
  min-width: 28px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-secondary);
  border-right: 1px solid var(--border);
  flex-shrink: 0;
}

.date-cell.weekend {
  background: var(--danger-light);
  color: var(--danger);
}

.date-cell.today {
  background: var(--primary);
  color: #fff;
  font-weight: 700;
}

.tasks-area {
  position: relative;
  min-height: 40px;
}

.fault-line {
  background: #fef2f2 !important;
  opacity: 0.7;
  cursor: not-allowed !important;
}

.fault-line .gantt-bar {
  filter: grayscale(100%);
}

.fault-badge {
  font-size: 10px;
  color: #ef4444;
  font-weight: 600;
  margin-left: 4px;
  background: #fef2f2;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid #fecaca;
}

.gantt-bar {
  position: absolute;
  top: 8px;
  height: 24px;
  background: var(--primary);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: var(--transition);
  z-index: 1;
}

.gantt-bar:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,.1);
  transform: translateY(-1px);
}

.bar-text {
  font-size: 10px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 4px;
}

.legend {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-color {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
}
</style>
