<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useWebSocket } from '../composables/useWebSocket'
import api from '../api'
import { Setting, Calendar, Document, DataAnalysis } from '@element-plus/icons-vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { DASHBOARD_METRICS, DEFAULT_METRIC_KEY } from '../config/dashboardMetrics'
import RingProgress from '../components/RingProgress.vue'

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent])

const emit = defineEmits(['navigate'])
const { connected } = useWebSocket()

const serviceStatus = computed(() => {
  if (connected.value === null || connected.value === undefined) return { color: '#f59e0b', label: '连接中...' }
  return connected.value ? { color: '#22c55e', label: '服务正常' } : { color: '#ef4444', label: '未连接' }
})

const stats = ref({
  styles: 0, mainPlan: 0, sewingPending: 0, sewingOverdue: 0,
  todayDispatch: 0, dispatchRate: 0,
  busyLines: 0, totalLines: 0, workshops: 0
})

async function loadStats() {
  try {
    const [s, p, sw, tree] = await Promise.all([
      api.getStyles(''),
      api.getMainPlan(),
      api.getSewingSummary(),
      api.getSewingWorkshopTree()
    ])
    stats.value.styles = (s.data || []).length
    stats.value.mainPlan = (p.data || []).length
    stats.value.sewingPending = (sw.data || {}).plan?.totalCount || 0
    stats.value.sewingOverdue = (sw.data || {}).plan?.overdue || 0
    const treeData = tree.data || []
    stats.value.workshops = treeData.filter(n => n.type === 'workshop').length
    const teams = treeData.filter(n => n.type === 'team')
    stats.value.totalLines = teams.length
    stats.value.busyLines = teams.filter(t => t.status === '生产中').length
  } catch {}
}

const _d = new Date()
const today = `${_d.getFullYear()}年${_d.getMonth() + 1}月${_d.getDate()}日`
const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const weekday = weekdays[_d.getDay()]

// ── 圆环 + 齿轮切换数据源 ──
const METRIC_LS_KEY = 'entry.metricKey'
const metricKey = ref(localStorage.getItem(METRIC_LS_KEY) || DEFAULT_METRIC_KEY)
const currentMetric = computed(() => {
  const m = DASHBOARD_METRICS.find(x => x.key === metricKey.value) || DASHBOARD_METRICS[0]
  return { ...m, ...m.calc(stats.value) }
})
watch(metricKey, (v) => { try { localStorage.setItem(METRIC_LS_KEY, v) } catch {} })

// 顶部数字
const todayNewStyles = computed(() => {
  const todayStr = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`
  return (stats.value.stylesArr || []).filter(s => (s.created_at || '').slice(0, 10) === todayStr).length
})
const activeStyles = computed(() => stats.value.styles)

// 柱状图
const showChart = ref(true)
const chartOption = computed(() => {
  const labels = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    labels.push(['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()])
  }
  const data = [120, 180, 240, 200, 280, 320, 290]
  return {
    grid: { left: 30, right: 10, top: 10, bottom: 24 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#9ca3af', fontSize: 11 } },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'bar',
      data,
      barWidth: 12,
      itemStyle: { borderRadius: [4, 4, 0, 0], color: '#ec4899' }
    }]
  }
})

// 4 张模块卡(横向排开)
const moduleCards = computed(() => {
  return [
    {
      key: 'basicData', label: '基础数据', icon: Document, color: '#3b82f6', bg: 'linear-gradient(135deg, #fda4af, #fb7185)',
      tagBg: '#dbeafe', tagColor: '#3b82f6',
      desc: '款式、面料、车间管理',
      main: stats.value.styles, mainUnit: '款',
      labelA: '今日新增', valueA: '+12', typeA: 'up',
      labelB: '在产', valueB: stats.value.styles, typeB: 'down',
      progColorA: '#3b82f6', progColorB: '#ef4444', progAW: 70, progBW: 30
    },
    {
      key: 'planManagement', label: '计划管理', icon: Calendar, color: '#2563eb', bg: 'linear-gradient(135deg, #60a5fa, #2563eb)',
      tagBg: '#dbeafe', tagColor: '#2563eb',
      desc: '预排总计划、排程、二次加工',
      main: stats.value.mainPlan, mainUnit: '条',
      labelA: '进行中', valueA: '24', typeA: 'up',
      labelB: '已完成', valueB: '103', typeB: 'down',
      progColorA: '#60a5fa', progColorB: '#22c55e', progAW: 60, progBW: 40
    },
    {
      key: 'dispatch', label: '报工管理', icon: DataAnalysis, color: '#ea580c', bg: 'linear-gradient(135deg, #fb923c, #c2410c)',
      tagBg: '#ffedd5', tagColor: '#ea580c',
      desc: '裁剪、印花、刺绣、缝制报工',
      main: 9235, mainUnit: '件',
      labelA: '今日报工', valueA: '+232', typeA: 'up',
      labelB: '不良率', valueB: '1.2%', typeB: 'down',
      progColorA: '#fb923c', progColorB: '#ef4444', progAW: 80, progBW: 20
    },
    {
      key: 'config', label: '系统设置', icon: Setting, color: '#4f46e5', bg: 'linear-gradient(135deg, #6366f1, #4338ca)',
      tagBg: '#f3f4f6', tagColor: '#6b7280',
      desc: '工作日历、产能、排产策略',
      main: 24, mainUnit: '人',
      labelA: '在线', valueA: '8', typeA: 'up',
      labelB: '操作员', valueB: '16', typeB: 'down',
      progColorA: '#fbbf24', progColorB: 'rgba(255,255,255,0.6)', progAW: 33, progBW: 67
    }
  ]
})

function go(k) { emit('navigate', k) }
function fmt(v) { return typeof v === 'number' ? v.toLocaleString() : v }

onMounted(loadStats)
</script>

<template>
  <div class="bg">
    <!-- 顶部欢迎条(简短) -->
    <header class="welcome">
      <div class="welcome-brand">
        <span class="welcome-dot"></span>
        <span>EUC 排程系统</span>
      </div>
      <div class="welcome-greet">欢迎回来 👋 Kevin</div>
      <div class="welcome-right">
        <span class="welcome-date">{{ today }} 星期{{ weekday }}</span>
        <div class="welcome-status">
          <span class="status-dot" :style="{ background: serviceStatus.color, color: serviceStatus.color }"></span>
          <span>{{ serviceStatus.label }}</span>
        </div>
      </div>
    </header>

    <!-- 第一行:工作台(圆环 + 数字 + 按钮 + 柱状图) -->
    <div class="row row-workbench">
      <!-- 圆环 + 欢迎区 -->
      <div class="wb-ring-card" @click.self="go('dashboard')">
        <div class="wb-ring-wrap">
          <RingProgress
            :percent="currentMetric.percent"
            :label="currentMetric.label"
            :color="currentMetric.color"
            :size="160"
          />
      </div>

      <!-- 数字 + 按钮 -->
      <div class="wb-stats-card">
        <div class="wb-amount-row">
          <div class="wb-amount">
            <span class="currency">$</span>
            <span class="amount-num">{{ todayNewStyles }}</span>
          </div>
          <div class="wb-deposit">
            <div class="wb-deposit-label">{{ currentMetric.label }}</div>
            <div class="wb-deposit-num">{{ activeStyles }}</div>
          </div>
        </div>

      </div>

      <!-- 柱状图 -->
      <div class="wb-chart-card">
        <div class="chart-header">
          <span class="chart-title">近 7 日报工量</span>
          <el-switch v-model="showChart" />
        </div>
        <div v-show="showChart" class="chart-body">
          <v-chart :option="chartOption" autoresize />
        </div>
      </div>
    </div>

    <!-- 第二行:4 张模块卡 横向排开 -->
    <div class="row row-modules">
      <div
        v-for="card in moduleCards"
        :key="card.key"
        class="mod-card"
        @click="go(card.key)"
      >
        <!-- 小框:放名字 + 图标 -->
        <div class="mod-tag" :style="{ background: card.bg }">
          <span class="mod-tag-ico-wrap">
            <el-icon class="mod-tag-ico"><component :is="card.icon" /></el-icon>
          </span>
          <span class="mod-tag-label">{{ card.label }}</span>
        </div>
        <!-- 大框:放数据 -->
        <div class="mod-body">
          <div class="mod-balance">
            <div class="balance-label">汇总</div>
            <div class="balance-value">
              <span class="balance-num">{{ card.main }}</span>
              <span class="balance-unit">{{ card.mainUnit }}</span>
            </div>
          </div>
          <div class="mod-stats">
            <div class="m-stat">
              <div class="m-stat-label">{{ card.labelA }}</div>
              <div class="m-stat-value" :class="card.typeA">{{ card.valueA }}</div>
            </div>
            <div class="m-stat">
              <div class="m-stat-label">{{ card.labelB }}</div>
              <div class="m-stat-value" :class="card.typeB">{{ card.valueB }}</div>
            </div>
          </div>
          <div class="mod-progress">
            <div class="p-bar" :style="{ background: card.progColorA, width: card.progAW + '%' }"></div>
            <div class="p-bar" :style="{ background: card.progColorB, width: card.progBW + '%' }"></div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }

.bg {
  min-height: 100vh;
  background: linear-gradient(180deg, #fafbff 0%, #f5f3ff 100%);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── 顶部欢迎条 ── */
.welcome {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 4px 8px;
  font-size: 13px;
  color: #6b7280;
}
.welcome-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: #1e293b;
  font-size: 14px;
}
.welcome-dot {
  width: 10px; height: 10px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 3px;
}
.welcome-greet { font-weight: 500; }
.welcome-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
}
.welcome-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  font-weight: 600;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
  flex-shrink: 0;
}

/* ── 第一行:工作台 ── */
.row-workbench {
  display: grid;
  grid-template-columns: 220px 1fr 1.1fr;
  gap: 16px;
}

/* 圆环卡 */
.wb-ring-card {
  background: #fff;
  border-radius: 20px;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
  position: relative;
  cursor: pointer;
  transition: transform .25s, box-shadow .25s;
}
.wb-ring-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(99, 102, 241, .15);
}
.wb-ring-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.wb-gear {
  position: absolute;
  top: -10px;
  right: -10px;
}
.wb-enter {
  font-size: 13px;
  font-weight: 700;
  color: #6366f1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ede9fe, #e0e7ff);
  transition: transform .2s;
}
.wb-ring-card:hover .wb-enter .arr {
  transform: translateX(3px);
}
.wb-enter .arr {
  font-size: 14px;
  transition: transform .2s;
}

/* 数字 + 按钮 */
.wb-stats-card {
  background: #fff;
  border-radius: 20px;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
}
.wb-amount-row {
  display: flex;
  align-items: center;
  gap: 32px;
}
.wb-amount {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.currency {
  font-size: 22px;
  font-weight: 600;
  color: #1e293b;
}
.amount-num {
  font-size: 44px;
  font-weight: 900;
  color: #1e293b;
  line-height: 1;
  letter-spacing: -1px;
}
.wb-deposit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 32px;
  border-left: 1px solid #e5e7eb;
}
.wb-deposit-label {
  font-size: 11px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.wb-deposit-num {
  font-size: 22px;
  font-weight: 700;
  color: #4b5563;
}
.wb-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn {
  border: none;
  border-radius: 999px;
  padding: 9px 18px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: transform .15s;
  font-family: inherit;
}
.btn:hover { transform: translateY(-1px); }
.btn-primary {
  background: #4f46e5;
  color: #fff;
  box-shadow: 0 2px 8px rgba(79, 70, 229, .3);
}
.btn-primary:hover .el-icon { transform: translateX(2px); }
.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

/* 柱状图 */
.wb-chart-card {
  background: #fff;
  border-radius: 20px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
}
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.chart-title {
  font-size: 14px;
  font-weight: 700;
  color: #374151;
}
.chart-body {
  flex: 1;
  min-height: 110px;
}

/* ── 第二行:4 张模块卡 横向排开 ── */
.row-modules {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.mod-card {
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  transition: all .3s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
  display: flex;
  flex-direction: column;
  min-height: 260px;
}
.mod-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .08);
}

/* 小框:放名字 + 图标(顶部) */
.mod-tag {
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #fff;
  min-height: 64px;
}
.mod-tag-ico-wrap {
  width: 36px; height: 36px;
  background: rgba(255, 255, 255, .25);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  flex-shrink: 0;
}
.mod-tag-ico {
  font-size: 18px;
  color: #fff;
}
.mod-tag-label {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

/* 大框:放数据 */
.mod-body {
  flex: 1;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: #fff;
}
.mod-balance {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.balance-label {
  font-size: 10px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-weight: 700;
}
.balance-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.balance-num {
  font-size: 28px;
  font-weight: 800;
  color: #1e293b;
  line-height: 1;
}
.balance-unit {
  font-size: 13px;
  color: #6b7280;
  font-weight: 600;
}
.mod-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.m-stat { display: flex; flex-direction: column; gap: 2px; }
.m-stat-label {
  font-size: 11px;
  color: #9ca3af;
}
.m-stat-value {
  font-size: 14px;
  font-weight: 700;
}
.m-stat-value.up { color: #3b82f6; }
.m-stat-value.down { color: #ef4444; }
.mod-progress {
  display: flex;
  gap: 3px;
  height: 4px;
  margin-top: auto;
}
.p-bar {
  height: 100%;
  border-radius: 2px;
  transition: width .6s ease;
}

/* 底部 V 圆形按钮 */
.mod-fab {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, .15);
  transition: transform .15s;
}
.mod-fab:hover { transform: scale(1.08); }

/* ── 响应式 ── */
@media (max-width: 1100px) {
  .row-modules { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 900px) {
  .row-workbench { grid-template-columns: 1fr; }
  .welcome { flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .row-modules { grid-template-columns: 1fr; }
}
</style>
