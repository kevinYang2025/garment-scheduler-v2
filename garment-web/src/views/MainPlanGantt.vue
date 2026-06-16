<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api'

const plans = ref([])
const loading = ref(true)
const weekOffset = ref(0)

const ganttLeftRef = ref(null)
const ganttLeftRowsRef = ref(null)
const ganttRightRef = ref(null)

function onRightScroll() {
  if (ganttLeftRowsRef.value && ganttRightRef.value) {
    ganttLeftRowsRef.value.scrollTop = ganttRightRef.value.scrollTop
  }
}

const todayStr = (() => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
})()

// 日期列表：今天前2周 ~ 后6周，随 weekOffset 滚动
const dates = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 14 + weekOffset.value * 14)
  const end = new Date(today)
  end.setDate(end.getDate() + 42 + weekOffset.value * 14)
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

const datesWidth = computed(() => dates.value.length * 28)

const dateRangeLabel = computed(() => {
  if (!dates.value.length) return ''
  return dates.value[0].slice(5) + ' ~ ' + dates.value[dates.value.length - 1].slice(5)
})

function prevWeek() { weekOffset.value -= 2 }
function nextWeek() { weekOffset.value += 2 }
function goToday() { weekOffset.value = 0 }

function formatDate(dateStr) {
  if (!dateStr) return ''
  return dateStr.slice(5)
}

function isRestDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

async function loadGantt() {
  loading.value = true
  try {
    const { data } = await api.getMainPlanGantt()
    plans.value = data.plans || []
  } catch { /* ignore */ }
  loading.value = false
}

function getTaskStyle(startDate, endDate) {
  if (!startDate || !endDate || !dates.value.length) return { display: 'none' }
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const rangeStart = new Date(dates.value[0] + 'T00:00:00')
  const dayWidth = 28
  const totalWidth = dates.value.length * dayWidth
  let left = Math.round((start - rangeStart) / 86400000) * dayWidth
  let width = Math.round((end - start) / 86400000 + 1) * dayWidth
  if (left + width < 0 || left > totalWidth) return { display: 'none' }
  if (left < 0) { width += left; left = 0 }
  if (left + width > totalWidth) { width = totalWidth - left }
  return { left: left + 'px', width: Math.max(width, dayWidth) + 'px' }
}

function dueDateStyle(dueDate) {
  if (!dueDate || !dates.value.length) return { display: 'none' }
  const d = new Date(dueDate + 'T00:00:00')
  const rangeStart = new Date(dates.value[0] + 'T00:00:00')
  const idx = Math.round((d - rangeStart) / 86400000)
  if (idx < 0 || idx > dates.value.length) return { display: 'none' }
  return { left: idx * 28 + 14 + 'px' }
}

function buildTooltip(plan) {
  const lines = [`款号: ${plan.style_no}`, `品名: ${plan.product_name}`, `数量: ${plan.plan_qty}件`]
  if (plan.cutting_start) lines.push(`裁剪: ${plan.cutting_start} ~ ${plan.cutting_end || ''}`)
  if (plan.secondary_start) lines.push(`二次加工: ${plan.secondary_start} ~ ${plan.secondary_end || ''}`)
  if (plan.sewing_start) lines.push(`缝制: ${plan.sewing_start} ~ ${plan.sewing_end || ''}`)
  if (plan.due_date) lines.push(`交期: ${plan.due_date}`)
  return lines.join('\n')
}

onMounted(loadGantt)
</script>

<template>
  <div class="main-plan-gantt">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="date-range">{{ dateRangeLabel }}</span>
      </div>
      <div class="toolbar-center">
        <div class="nav-arrows">
          <button class="arrow-btn" @click="prevWeek">‹</button>
          <button class="today-btn arrow-btn" @click="goToday">今天</button>
          <button class="arrow-btn" @click="nextWeek">›</button>
        </div>
      </div>
      <div class="legend">
        <span class="leg-item"><span class="leg-dot" style="background:#3b82f6"></span>裁剪</span>
        <span class="leg-item"><span class="leg-dot" style="background:#f59e0b"></span>二次加工</span>
        <span class="leg-item"><span class="leg-dot" style="background:#10b981"></span>缝制</span>
        <span class="leg-item"><span class="leg-dot" style="background:#ef4444;height:2px;width:12px;border-radius:0"></span>交期</span>
      </div>
    </div>

    <!-- 甘特图 -->
    <div class="content" v-if="plans.length">
      <!-- 左侧固定列 -->
      <div class="gantt-left" ref="ganttLeftRef">
        <div class="gantt-left-header">款号 / 品名</div>
        <div class="gantt-left-rows" ref="ganttLeftRowsRef">
          <div
            v-for="plan in plans"
            :key="'l-'+plan.id"
            class="gantt-left-row"
          >
            <div class="plan-no">{{ plan.style_no }}</div>
            <div class="plan-info">
              <span>{{ plan.product_name }}</span>
              <span class="plan-qty">{{ plan.plan_qty }}件</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧可滚动区 -->
      <div class="gantt-right" ref="ganttRightRef" @scroll="onRightScroll">
        <!-- 日期标题 -->
        <div class="gantt-right-header">
          <div
            v-for="date in dates"
            :key="date"
            class="date-cell"
            :class="{ weekend: isRestDay(date), today: date === todayStr }"
          >
            {{ formatDate(date) }}
          </div>
        </div>

        <!-- 任务行 -->
        <div
          v-for="plan in plans"
          :key="'r-'+plan.id"
          class="gantt-right-row"
        >
          <div class="tasks-area" :style="{ minWidth: datesWidth + 'px' }">
            <!-- 裁剪条 -->
            <div
              v-if="plan.cutting_start && plan.cutting_end"
              class="gantt-bar cutting"
              :style="getTaskStyle(plan.cutting_start, plan.cutting_end)"
              :title="'裁剪: ' + plan.cutting_start + ' ~ ' + plan.cutting_end"
            >
              <span class="bar-text">裁剪</span>
            </div>
            <!-- 二次加工条 -->
            <div
              v-if="plan.secondary_start && plan.secondary_end"
              class="gantt-bar secondary"
              :style="getTaskStyle(plan.secondary_start, plan.secondary_end)"
              :title="'二次加工: ' + plan.secondary_start + ' ~ ' + plan.secondary_end"
            >
              <span class="bar-text">二次</span>
            </div>
            <!-- 缝制条 -->
            <div
              v-if="plan.sewing_start && plan.sewing_end"
              class="gantt-bar sewing"
              :style="getTaskStyle(plan.sewing_start, plan.sewing_end)"
              :title="buildTooltip(plan)"
            >
              <span class="bar-text">{{ plan.style_no }} {{ plan.plan_qty }}件</span>
            </div>
            <!-- 交期标记 -->
            <div
              v-if="plan.due_date"
              class="due-marker"
              :style="dueDateStyle(plan.due_date)"
              :title="'交期: ' + plan.due_date"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!loading" class="empty">暂无排程数据</div>
    <div v-else class="empty">加载中...</div>
  </div>
</template>

<style scoped>
.main-plan-gantt {
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
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.toolbar-left { display: flex; align-items: center; gap: 12px; }
.date-range { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
.toolbar-center { display: flex; align-items: center; }

.nav-arrows { display: flex; align-items: center; gap: 2px; }
.arrow-btn {
  padding: 4px 10px; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px;
  color: var(--text-secondary); transition: var(--transition);
}
.arrow-btn:hover { background: #eef2ff; color: var(--primary); border-color: var(--primary); }
.today-btn { font-weight: 600; }

.legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-secondary); }
.leg-item { display: flex; align-items: center; gap: 4px; }
.leg-dot { width: 12px; height: 8px; border-radius: 2px; }

/* 甘特图主体 */
.content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧固定列 */
.gantt-left {
  width: 200px;
  min-width: 200px;
  flex-shrink: 0;
  border-right: 2px solid var(--border);
  background: var(--card);
  z-index: 5;
  overflow: hidden;
}
.gantt-left-header {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.gantt-left-rows {
  overflow: hidden;
}
.gantt-left-row {
  height: 52px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.plan-no { font-size: 13px; font-weight: 700; color: var(--text); }
.plan-info { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.plan-info span { font-size: 11px; color: var(--text-tertiary); }
.plan-qty { font-weight: 600; color: var(--primary); }

/* 右侧可滚动区 */
.gantt-right {
  flex: 1;
  overflow: auto;
  position: relative;
}
.gantt-right-header {
  display: flex;
  position: sticky;
  top: 0;
  z-index: 4;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
  height: 52px;
}
.date-cell {
  width: 28px;
  min-width: 28px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-secondary);
  border-right: 1px solid var(--border-light);
  flex-shrink: 0;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  letter-spacing: 1px;
}
.date-cell.weekend { background: #f1f5f9; color: var(--text-tertiary); }
.date-cell.today { background: var(--primary-light, #eef2ff); color: var(--primary); font-weight: 700; }

.gantt-right-row {
  height: 52px;
  border-bottom: 1px solid var(--border-light);
  position: relative;
}
.tasks-area {
  position: relative;
  height: 100%;
}

/* 甘特条 */
.gantt-bar {
  position: absolute;
  top: 14px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  z-index: 2;
  transition: filter 0.2s;
  overflow: hidden;
}
.gantt-bar:hover { filter: brightness(0.9); }
.gantt-bar .bar-text { white-space: nowrap; padding: 0 4px; }

.gantt-bar.cutting { background: var(--primary, #3b82f6); top: 6px; height: 16px; }
.gantt-bar.secondary { background: #f59e0b; top: 24px; height: 16px; }
.gantt-bar.sewing { background: #10b981; }

/* 交期标记 */
.due-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ef4444;
  z-index: 3;
}
.due-marker::before {
  content: '';
  position: absolute;
  top: 0;
  left: -4px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #ef4444;
}

.empty { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-tertiary); }
</style>
