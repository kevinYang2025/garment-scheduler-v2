<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const calendars = ref([])
const workModes = ref([])
const exceptions = ref([])
const loading = ref(true)
const selectedCalendar = ref(null)
const currentMonth = ref(new Date())

const dayNames = ['一', '二', '三', '四', '五', '六', '日']

// 新建日历表单
const showCreateDialog = ref(false)
const createForm = ref({ name: '', work_days: '1111100', start_date: '2025-01-01', end_date: '2027-12-31', priority: 0 })

// 新建例外表单
const showExceptionDialog = ref(false)
const exceptionForm = ref({ exception_date: '', is_workday: false, remark: '' })

// 新建工作模式表单
const showModeDialog = ref(false)
const modeForm = ref({ name: '', working_hours: 8, shifts: ['08:00-12:00', '13:00-17:00'] })

// 月历数据
const calendarDays = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const days = []

  // 填充前面的空白（周一开始）
  let startDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
  for (let i = 0; i < startDay; i++) days.push(null)

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const exception = exceptions.value.find(e => e.exception_date === dateStr)
    const dayOfWeek = new Date(year, month, d).getDay()
    const idx = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const cal = selectedCalendar.value
    const isWorkday = exception
      ? exception.is_workday === 1
      : cal ? cal.work_days[idx] === '1' : (dayOfWeek >= 1 && dayOfWeek <= 5)

    days.push({
      date: d,
      dateStr,
      isWorkday,
      isException: !!exception,
      remark: exception?.remark || '',
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    })
  }
  return days
})

const monthTitle = computed(() => {
  const y = currentMonth.value.getFullYear()
  const m = currentMonth.value.getMonth() + 1
  return `${y}年${m}月`
})

async function loadAll() {
  loading.value = true
  try {
    const [calRes, modeRes] = await Promise.all([
      api.getWorkCalendars(),
      api.getWorkModes(),
    ])
    calendars.value = calRes.data || []
    workModes.value = modeRes.data || []
    if (calendars.value.length > 0 && !selectedCalendar.value) {
      selectedCalendar.value = calendars.value[0]
      await loadExceptions()
    }
  } catch {
    ElMessage.error('加载日历失败')
  }
  loading.value = false
}

function onWorkDayToggle(i, v) {
  if (!selectedCalendar.value) return
  const cal = { ...selectedCalendar.value }
  cal.work_days = cal.work_days.substring(0, i) + (v ? '1' : '0') + cal.work_days.substring(i + 1)
  selectedCalendar.value = cal
}

async function saveWorkDays() {
  if (!selectedCalendar.value) return
  try {
    await api.updateWorkCalendar(selectedCalendar.value.id, selectedCalendar.value)
    ElMessage.success('保存成功')
  } catch {
    ElMessage.error('保存失败')
  }
}

async function loadExceptions() {
  if (!selectedCalendar.value) return
  try {
    const { data } = await api.getCalendarExceptions(selectedCalendar.value.id)
    exceptions.value = data || []
  } catch { exceptions.value = [] }
}

async function selectCalendar(cal) {
  selectedCalendar.value = cal
  await loadExceptions()
}

function prevMonth() {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() - 1)
  currentMonth.value = d
}

function nextMonth() {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() + 1)
  currentMonth.value = d
}

function toggleWorkday(day) {
  if (!day || !selectedCalendar.value) return
  exceptionForm.value = {
    exception_date: day.dateStr,
    is_workday: !day.isWorkday,
    remark: day.isWorkday ? '标记为休息日' : '标记为工作日',
  }
  showExceptionDialog.value = true
}

async function saveException() {
  try {
    await api.addCalendarException(selectedCalendar.value.id, exceptionForm.value)
    ElMessage.success('保存成功')
    showExceptionDialog.value = false
    await loadExceptions()
  } catch {
    ElMessage.error('保存失败')
  }
}

async function deleteException(exId) {
  try {
    await ElMessageBox.confirm('确定删除此例外？')
    await api.deleteCalendarException(selectedCalendar.value.id, exId)
    await loadExceptions()
  } catch {}
}

async function saveCalendar() {
  try {
    await api.createWorkCalendar(createForm.value)
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    await loadAll()
  } catch {
    ElMessage.error('创建失败')
  }
}

async function deleteCalendar(id) {
  try {
    await ElMessageBox.confirm('确定删除此日历？')
    await api.deleteWorkCalendar(id)
    if (selectedCalendar.value?.id === id) selectedCalendar.value = null
    await loadAll()
  } catch {}
}

async function saveMode() {
  try {
    await api.createWorkMode(modeForm.value)
    ElMessage.success('创建成功')
    showModeDialog.value = false
    await loadAll()
  } catch {
    ElMessage.error('创建失败')
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="calendar-page" v-loading="loading">
    <div class="page-header-bar">
      <h2 class="page-heading">工作日历</h2>
      <p class="page-desc">管理工作日、休息日、节假日，排程计算时自动跳过休息日</p>
    </div>

    <div class="calendar-layout">
      <!-- 左侧：日历列表 -->
      <div class="calendar-sidebar">
        <div class="sidebar-section">
          <div class="sidebar-title">
            工作日历
            <el-button size="small" type="primary" text @click="showCreateDialog = true">+ 新建</el-button>
          </div>
          <div
            v-for="cal in calendars"
            :key="cal.id"
            class="calendar-item"
            :class="{ active: selectedCalendar?.id === cal.id }"
            @click="selectCalendar(cal)"
          >
            <div class="cal-name">{{ cal.name }}</div>
            <div class="cal-info">工作日: {{ cal.work_days }} | 优先级: {{ cal.priority }}</div>
            <el-button size="small" text type="danger" @click.stop="deleteCalendar(cal.id)" class="del-btn">删除</el-button>
          </div>
          <div v-if="calendars.length === 0" class="empty-hint">暂无日历</div>
        </div>

        <div class="sidebar-section">
          <div class="sidebar-title">
            工作模式
            <el-button size="small" type="primary" text @click="showModeDialog = true">+ 新建</el-button>
          </div>
          <div v-for="mode in workModes" :key="mode.id" class="mode-item">
            <span>{{ mode.name }} ({{ mode.working_hours }}h)</span>
          </div>
        </div>

        <div class="sidebar-section" v-if="selectedCalendar">
          <div class="sidebar-title">工作日设置</div>
          <div class="workdays-grid">
            <div v-for="(day, i) in dayNames" :key="i" class="workday-toggle">
              <span>{{ day }}</span>
              <el-switch
                :model-value="selectedCalendar.work_days[i] === '1'"
                @change="v => onWorkDayToggle(i, v)"
                size="small"
              />
            </div>
          </div>
          <el-button size="small" type="primary" @click="saveWorkDays">
            保存工作日设置
          </el-button>
        </div>
      </div>

      <!-- 右侧：月历 -->
      <div class="calendar-main">
        <div v-if="selectedCalendar">
          <div class="month-nav">
            <el-button @click="prevMonth" text>&lt; 上月</el-button>
            <h3>{{ monthTitle }}</h3>
            <el-button @click="nextMonth" text>下月 &gt;</el-button>
          </div>

          <div class="month-grid">
            <div v-for="day in dayNames" :key="'h'+day" class="day-header">{{ day }}</div>
            <div
              v-for="(day, i) in calendarDays"
              :key="i"
              class="day-cell"
              :class="{
                empty: !day,
                workday: day?.isWorkday,
                restday: day && !day.isWorkday,
                exception: day?.isException,
                weekend: day?.isWeekend,
              }"
              @click="day && toggleWorkday(day)"
            >
              <template v-if="day">
                <span class="day-num">{{ day.date }}</span>
                <span v-if="day.isException" class="exception-mark">*</span>
                <span v-if="day.remark" class="day-remark">{{ day.remark }}</span>
              </template>
            </div>
          </div>

          <div class="legend">
            <span class="legend-item"><span class="dot work"></span> 工作日</span>
            <span class="legend-item"><span class="dot rest"></span> 休息日</span>
            <span class="legend-item"><span class="dot ex"></span> 特殊日期（点击日期可切换）</span>
          </div>

          <!-- 例外列表 -->
          <div class="exceptions-list" v-if="exceptions.length > 0">
            <h4>特殊日期 ({{ exceptions.length }})</h4>
            <div v-for="ex in exceptions" :key="ex.id" class="exception-row">
              <span>{{ ex.exception_date }}</span>
              <el-tag :type="ex.is_workday ? 'success' : 'danger'" size="small">
                {{ ex.is_workday ? '工作日' : '休息日' }}
              </el-tag>
              <span>{{ ex.remark }}</span>
              <el-button size="small" text type="danger" @click="deleteException(ex.id)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>请先在左侧选择或创建一个工作日历</p>
        </div>
      </div>
    </div>

    <!-- 新建日历对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建工作日历" width="400px">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="名称"><el-input v-model="createForm.name" placeholder="如：2026年工作日历" /></el-form-item>
        <el-form-item label="工作日">
          <div class="workdays-grid" style="width:100%">
            <div v-for="(day, i) in dayNames" :key="i" class="workday-toggle">
              <span>{{ day }}</span>
              <el-switch :model-value="createForm.work_days[i] === '1'" @change="v => { createForm.work_days = createForm.work_days.substring(0, i) + (v ? '1' : '0') + createForm.work_days.substring(i + 1) }" size="small" />
            </div>
          </div>
        </el-form-item>
        <el-form-item label="开始日期"><el-input v-model="createForm.start_date" type="date" /></el-form-item>
        <el-form-item label="结束日期"><el-input v-model="createForm.end_date" type="date" /></el-form-item>
        <el-form-item label="优先级"><el-input-number v-model="createForm.priority" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveCalendar">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新建例外对话框 -->
    <el-dialog v-model="showExceptionDialog" title="设置特殊日期" width="400px">
      <el-form :model="exceptionForm" label-width="80px">
        <el-form-item label="日期"><el-input v-model="exceptionForm.exception_date" disabled /></el-form-item>
        <el-form-item label="类型">
          <el-switch v-model="exceptionForm.is_workday" active-text="工作日" inactive-text="休息日" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="exceptionForm.remark" placeholder="如：春节、国庆补班" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showExceptionDialog = false">取消</el-button>
        <el-button type="primary" @click="saveException">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新建工作模式对话框 -->
    <el-dialog v-model="showModeDialog" title="新建工作模式" width="400px">
      <el-form :model="modeForm" label-width="80px">
        <el-form-item label="名称"><el-input v-model="modeForm.name" placeholder="如：两班倒" /></el-form-item>
        <el-form-item label="工时"><el-input-number v-model="modeForm.working_hours" :min="1" :max="24" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showModeDialog = false">取消</el-button>
        <el-button type="primary" @click="saveMode">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.calendar-page { max-width: 1100px; }
.page-header-bar { margin-bottom: 24px; }
.page-heading { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.page-desc { font-size: 13px; color: var(--text-secondary); }

.calendar-layout { display: flex; gap: 20px; }
.calendar-sidebar { width: 280px; flex-shrink: 0; }
.calendar-main { flex: 1; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }

.sidebar-section { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
.sidebar-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
.calendar-item { padding: 10px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; position: relative; transition: all .15s; }
.calendar-item:hover { background: var(--primary-light); }
.calendar-item.active { border-color: var(--primary); background: var(--primary-light); }
.cal-name { font-weight: 600; font-size: 14px; }
.cal-info { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.del-btn { position: absolute; top: 8px; right: 8px; }
.mode-item { padding: 6px 0; font-size: 13px; }

.workdays-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.workday-toggle { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; }

.month-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.day-header { text-align: center; font-size: 12px; font-weight: 600; color: var(--text-secondary); padding: 8px 0; }
.day-cell { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; font-size: 13px; transition: all .15s; position: relative; }
.day-cell.empty { cursor: default; }
.day-cell:hover:not(.empty) { transform: scale(1.1); }
.day-cell.workday { background: #f0fdf4; }
.day-cell.restday { background: #fef2f2; color: #ef4444; }
.day-cell.exception { border: 2px solid var(--primary); }
.day-cell.weekend { opacity: 0.7; }
.day-num { font-weight: 500; }
.exception-mark { position: absolute; top: 2px; right: 4px; font-size: 10px; color: var(--primary); }
.day-remark { font-size: 8px; color: var(--text-tertiary); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.legend { margin-top: 16px; display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.dot.work { background: #22c55e; }
.dot.rest { background: #ef4444; }
.dot.ex { background: var(--primary); }

.exceptions-list { margin-top: 20px; }
.exceptions-list h4 { font-size: 14px; margin-bottom: 8px; }
.exception-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; font-size: 13px; }

.empty-state { display: flex; align-items: center; justify-content: center; height: 300px; color: var(--text-tertiary); }
.empty-hint { font-size: 12px; color: var(--text-tertiary); text-align: center; padding: 12px; }
</style>
