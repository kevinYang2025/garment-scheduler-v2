<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const plans = ref([])
const dateRange = ref({ start: '', end: '' })
const loading = ref(true)
const weekOffset = ref(0)
const dayWidth = 56 // 每天列宽 px

// 颜色
const COLORS = {
  cutting: { bg: '#dbeafe', bar: '#3b82f6', text: '#1e40af' },
  secondary: { bg: '#fef3c7', bar: '#f59e0b', text: '#92400e' },
  sewing: { bg: '#d1fae5', bar: '#10b981', text: '#065f46' },
}

// 今天的日期
const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
})()

async function loadGantt() {
  loading.value = true
  try {
    const { data } = await api.getMainPlanGantt()
    plans.value = data.plans || []
    dateRange.value = data.dateRange || { start: '', end: '' }
  } catch { ElMessage.error('加载甘特图失败') }
  loading.value = false
}

// 日期列（基于 weekOffset 滚动，默认显示今天所在的周）
const visibleDateCols = computed(() => {
  if (!dateRange.value.start) return []
  // 默认从今天前3天开始显示
  const baseDate = new Date()
  baseDate.setDate(baseDate.getDate() - 3 + weekOffset.value * 21)
  // 对齐到周一
  const dow = (baseDate.getDay() + 6) % 7
  baseDate.setDate(baseDate.getDate() - dow)

  // 计算最后一条任务的结束日期
  let lastDate = new Date(baseDate)
  lastDate.setDate(lastDate.getDate() + 14) // 至少显示2周
  for (const p of plans.value) {
    const dates = [p.cutting_end, p.secondary_end, p.sewing_end, p.due_date].filter(Boolean)
    for (const d of dates) {
      const dd = new Date(d + 'T00:00:00')
      if (dd > lastDate) lastDate = dd
    }
  }
  // 对齐到周日
  const endDow = (lastDate.getDay() + 6) % 7
  lastDate.setDate(lastDate.getDate() + (6 - endDow))
  // 加2天缓冲
  lastDate.setDate(lastDate.getDate() + 2)

  const totalDays = Math.round((lastDate - baseDate) / 86400000)
  const cols = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() + i)
    const ds = fmtDate(d)
    const dayOfWeek = d.getDay()
    cols.push({
      date: ds,
      day: d.getDate(),
      month: d.getMonth() + 1,
      dow: ['日','一','二','三','四','五','六'][dayOfWeek],
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isToday: ds === today,
    })
  }
  return cols
})

// 月分组
const monthGroups = computed(() => {
  const groups = []
  let current = ''
  let count = 0
  for (const col of visibleDateCols.value) {
    const key = `${col.month}月`
    if (key !== current) {
      if (current) groups.push({ label: current, span: count })
      current = key
      count = 1
    } else { count++ }
  }
  if (current) groups.push({ label: current, span: count })
  return groups
})

// 今天列的索引
const todayIdx = computed(() => visibleDateCols.value.findIndex(c => c.isToday))

function shiftWeek(dir) { weekOffset.value += dir }
function goToday() { weekOffset.value = 0 }

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// 计算任务条位置
function barStyle(startDate, endDate, type) {
  if (!startDate || !endDate || !visibleDateCols.value.length) return { display: 'none' }
  const firstDate = visibleDateCols.value[0].date
  const startIdx = dayDiff(firstDate, startDate)
  const dur = dayDiff(startDate, endDate) + 1
  if (startIdx + dur < 0 || startIdx > visibleDateCols.value.length) return { display: 'none' }
  const c = COLORS[type]
  return {
    left: `${Math.max(0, startIdx) * dayWidth}px`,
    width: `${Math.max(1, dur) * dayWidth}px`,
    background: c.bar,
    color: c.text,
  }
}

// 交期标记位置
function dueDateStyle(dueDate) {
  if (!dueDate || !visibleDateCols.value.length) return { display: 'none' }
  const firstDate = visibleDateCols.value[0].date
  const idx = dayDiff(firstDate, dueDate)
  if (idx < 0 || idx > visibleDateCols.value.length) return { display: 'none' }
  return { left: `${idx * dayWidth + dayWidth / 2}px` }
}

function dayDiff(from, to) {
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to + 'T00:00:00')
  return Math.round((b - a) / 86400000)
}

function fmtShort(d) {
  if (!d) return ''
  const parts = d.split('-')
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

onMounted(loadGantt)
</script>

<template>
  <div class="gantt-page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="nav-btns">
        <el-button size="small" @click="shiftWeek(-1)">← 上三周</el-button>
        <el-button size="small" type="primary" @click="goToday">今天</el-button>
        <el-button size="small" @click="shiftWeek(1)">下三周 →</el-button>
      </div>
      <div class="legend">
        <span class="leg-item"><span class="leg-dot" style="background:#3b82f6"></span>裁剪</span>
        <span class="leg-item"><span class="leg-dot" style="background:#f59e0b"></span>二次加工</span>
        <span class="leg-item"><span class="leg-dot" style="background:#10b981"></span>缝制</span>
        <span class="leg-item"><span class="leg-dot" style="background:#ef4444"></span>交期</span>
      </div>
    </div>

    <!-- 甘特图主体 -->
    <div class="gantt-wrap" v-if="plans.length">
      <!-- 月头 -->
      <div class="gantt-header">
        <div class="label-col">款号 / 品名</div>
        <div class="timeline-header">
          <div class="month-row">
            <div v-for="(mg, i) in monthGroups" :key="i" class="month-cell" :style="{ width: mg.span * dayWidth + 'px' }">{{ mg.label }}</div>
          </div>
          <div class="day-row">
            <div v-for="col in visibleDateCols" :key="col.date" class="day-cell"
              :class="{ weekend: col.isWeekend, today: col.isToday }"
              :style="{ width: dayWidth + 'px' }">
              <span class="day-num">{{ col.day }}</span>
              <span class="day-dow">{{ col.dow }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 甘特图行 -->
      <div class="gantt-body">
        <div v-for="plan in plans" :key="plan.id" class="gantt-row">
          <!-- 左侧标签 -->
          <div class="label-col">
            <div class="plan-style">{{ plan.style_no }}</div>
            <div class="plan-name">{{ plan.product_name }} ({{ plan.plan_qty }}件)</div>
          </div>
          <!-- 右侧时间轴 -->
          <div class="timeline-body">
            <!-- 今天线 -->
            <div v-if="todayIdx >= 0" class="today-line" :style="{ left: todayIdx * dayWidth + dayWidth/2 + 'px' }"></div>
            <!-- 交期线 -->
            <div v-if="plan.due_date" class="due-line" :style="dueDateStyle(plan.due_date)" :title="'交期: ' + plan.due_date"></div>
            <!-- 周末背景 -->
            <div v-for="col in visibleDateCols" :key="col.date" class="day-bg"
              :class="{ weekend: col.isWeekend, today: col.isToday }"
              :style="{ left: visibleDateCols.indexOf(col) * dayWidth + 'px', width: dayWidth + 'px' }"></div>
            <!-- 裁剪条 -->
            <div v-if="plan.cutting_start && plan.cutting_end" class="bar cutting-bar"
              :style="barStyle(plan.cutting_start, plan.cutting_end, 'cutting')"
              :title="'裁剪: ' + plan.cutting_start + ' ~ ' + plan.cutting_end">
              <span class="bar-label">裁剪</span>
            </div>
            <!-- 二次加工条 -->
            <div v-if="plan.secondary_start && plan.secondary_end" class="bar secondary-bar"
              :style="barStyle(plan.secondary_start, plan.secondary_end, 'secondary')"
              :title="'二次加工: ' + plan.secondary_start + ' ~ ' + plan.secondary_end">
              <span class="bar-label">二次</span>
            </div>
            <!-- 缝制条 -->
            <div v-if="plan.sewing_start && plan.sewing_end" class="bar sewing-bar"
              :style="barStyle(plan.sewing_start, plan.sewing_end, 'sewing')"
              :title="'缝制: ' + plan.sewing_start + ' ~ ' + plan.sewing_end">
              <span class="bar-label">缝制</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!loading" class="empty">暂无排程数据，请先在预排总计划中添加计划</div>
    <div v-else class="empty">加载中...</div>
  </div>
</template>

<style scoped>
.gantt-page { display: flex; flex-direction: column; height: 100%; }

.toolbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0; margin-bottom: 8px;
}
.nav-btns { display: flex; gap: 4px; }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); }
.leg-item { display: flex; align-items: center; gap: 4px; }
.leg-dot { width: 12px; height: 12px; border-radius: 3px; }

.gantt-wrap {
  flex: 1; overflow: auto; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--card);
}

/* 表头 */
.gantt-header { display: flex; position: sticky; top: 0; z-index: 10; background: var(--card); }
.label-col {
  width: 200px; min-width: 200px; flex-shrink: 0;
  padding: 8px 12px; border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-size: 12px; font-weight: 600; color: var(--text-secondary);
  display: flex; align-items: center;
}
.timeline-header { flex: 1; overflow: hidden; }
.month-row { display: flex; border-bottom: 1px solid var(--border); }
.month-cell {
  text-align: center; font-size: 12px; font-weight: 600; color: var(--text);
  padding: 4px 0; border-right: 1px solid var(--border-light);
}
.day-row { display: flex; }
.day-cell {
  text-align: center; padding: 2px 0;
  border-right: 1px solid var(--border-light);
  font-size: 10px; color: var(--text-tertiary);
  display: flex; flex-direction: column; align-items: center;
}
.day-cell.weekend { background: #f8f9fa; }
.day-cell.today { background: #ede9fe; }
.day-num { font-weight: 600; font-size: 11px; color: var(--text); }
.day-dow { font-size: 9px; }

/* 甘特图行 */
.gantt-body { position: relative; }
.gantt-row { display: flex; border-bottom: 1px solid var(--border-light); min-height: 52px; }
.gantt-row:hover { background: #f8faff; }
.gantt-row .label-col {
  flex-direction: column; align-items: flex-start; justify-content: center;
  border-bottom: none; font-weight: 400;
}
.plan-style { font-size: 13px; font-weight: 700; color: var(--text); }
.plan-name { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }

.timeline-body { flex: 1; position: relative; min-height: 52px; }

/* 周末背景 */
.day-bg { position: absolute; top: 0; bottom: 0; }
.day-bg.weekend { background: #fafafa; }
.day-bg.today { background: #f5f3ff; }

/* 今天线 */
.today-line {
  position: absolute; top: 0; bottom: 0; width: 2px;
  background: #8b5cf6; z-index: 5; opacity: .6;
}
/* 交期线 */
.due-line {
  position: absolute; top: 0; bottom: 0; width: 2px;
  background: #ef4444; z-index: 5; opacity: .5;
  border-style: dashed;
}
.due-line::after {
  content: '交期'; position: absolute; top: 2px; left: 4px;
  font-size: 9px; color: #ef4444; font-weight: 600;
}

/* 任务条 */
.bar {
  position: absolute; top: 14px; height: 24px;
  border-radius: 4px; display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; z-index: 3;
  cursor: pointer; transition: opacity .2s;
  box-shadow: 0 1px 3px rgba(0,0,0,.1);
  overflow: hidden;
}
.bar:hover { opacity: .85; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.bar-label { white-space: nowrap; padding: 0 6px; }

.empty { text-align: center; padding: 60px; color: var(--text-tertiary); }
</style>
