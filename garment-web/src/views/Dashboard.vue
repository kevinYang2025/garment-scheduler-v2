<script setup>
import { computed, ref, onMounted } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart, BarChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'
import VChart from 'vue-echarts'

use([CanvasRenderer, PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

const props = defineProps({ db: Object })
const emit = defineEmits(['navigate'])

const stats = computed(() => {
  const d = props.db
  return {
    styles: d.styles?.length || 0,
    workshops: d.workshops?.length || 0,
    lines: d.productionLines?.length || 0,
    busyLines: d.productionLines?.filter(l => l.status === '生产中').length || 0,
    mainPlan: d.mainPlan?.length || 0,
  }
})

const kpiCards = computed(() => [
  {
    label: '款式总数',
    value: stats.value.styles,
    icon: 'tag',
    color: '#6e3ff3',
    bg: '#f3f0ff',
  },
  {
    label: '生产中产线',
    value: stats.value.busyLines,
    total: stats.value.lines,
    icon: 'activity',
    color: '#22c55e',
    bg: '#f0fdf4',
  },
  {
    label: '预排总计划数',
    value: stats.value.mainPlan,
    icon: 'calendar',
    color: '#3b82f6',
    bg: '#eff6ff',
  },
  {
    label: '车间数',
    value: stats.value.workshops,
    icon: 'building',
    color: '#f59e0b',
    bg: '#fffbeb',
  },
])

const pieOption = computed(() => {
  const workshops = props.db?.workshops || []
  const lines = props.db?.productionLines || []
  const data = workshops.map(w => ({
    name: w.name,
    value: lines.filter(l => l.workshop_id === w.id).length,
  }))
  const colors = ['#6e3ff3', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6']
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 条产线 ({d}%)' },
    color: colors,
    series: [{
      type: 'pie',
      radius: ['42%', '70%'],
      center: ['50%', '50%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: '600' },
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,.1)' },
      },
      data,
    }],
  }
})

const barOption = computed(() => {
  const months = ['1月', '2月', '3月', '4月', '5月', '6月']
  const plans = props.db?.mainPlan || []
  const planCount = plans.length
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#a1a1aa', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f3f4f6', type: 'solid' } },
      axisLabel: { color: '#a1a1aa', fontSize: 11 },
    },
    series: [
      {
        name: '计划数',
        type: 'bar',
        barWidth: 14,
        itemStyle: { borderRadius: [4, 4, 0, 0], color: '#6e3ff3' },
        data: months.map((_, i) => Math.floor(planCount * (0.3 + i * 0.12))),
      },
      {
        name: '完成数',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#22c55e', width: 2 },
        itemStyle: { color: '#22c55e' },
        data: months.map((_, i) => Math.floor(planCount * (0.2 + i * 0.1))),
      },
    ],
  }
})

const recentPlans = computed(() => {
  const plans = props.db?.mainPlan || []
  return plans.slice(0, 8)
})

const workshopLines = computed(() => {
  const lines = props.db?.productionLines || []
  return lines.slice(0, 10)
})

function getKpiIcon(name) {
  const icons = {
    tag: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
    activity: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>`,
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`,
    building: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`,
  }
  return icons[name] || ''
}
</script>

<template>
  <div class="dashboard">
    <!-- Welcome Section -->
    <div class="welcome-section">
      <div class="welcome-text">
        <h2 class="welcome-title">欢迎回来！</h2>
        <p class="welcome-desc">
          当前有 <strong>{{ stats.busyLines }} 条产线</strong> 正在生产，
          <strong>{{ stats.mainPlan }} 个计划</strong> 进行中
        </p>
      </div>
      <div class="welcome-actions">
  <button class="btn btn-primary" @click="emit('navigate', 'mainPlan')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          新建计划
        </button>
      </div>
    </div>

    <!-- KPI Stats Cards -->
    <div class="stats-grid">
      <div v-for="card in kpiCards" :key="card.label" class="stat-card">
        <div class="stat-content">
          <div class="stat-icon-wrap" :style="{ background: card.bg, color: card.color }">
            <span v-html="getKpiIcon(card.icon)"></span>
          </div>
          <div class="stat-info">
            <span class="stat-label">{{ card.label }}</span>
            <span class="stat-value">
              {{ card.value }}
              <span v-if="card.total" class="stat-total">/ {{ card.total }}</span>
            </span>
            <div v-if="card.change" class="stat-change">
              <span :class="card.isPositive ? 'change-positive' : 'change-negative'">
                {{ card.change }}
              </span>
              <span class="change-label">{{ card.changeLabel }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="charts-row">
      <!-- Pie Chart: 产能分布 -->
      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title-area">
            <div class="chart-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
            </div>
            <span class="chart-title">车间产能分布</span>
          </div>
          <span class="chart-subtitle">{{ stats.workshops }} 个车间 / {{ stats.lines }} 条产线</span>
        </div>
        <div class="chart-body-pie">
          <v-chart :option="pieOption" :autoresize="true" style="height: 220px; width: 100%;" />
          <div class="pie-legend">
            <div v-for="(w, i) in (db?.workshops || [])" :key="w.id" class="legend-item">
              <span class="legend-dot" :style="{ background: ['#6e3ff3','#3b82f6','#22c55e','#f59e0b','#ef4444','#ec4899','#14b8a6','#8b5cf6'][i % 8] }"></span>
              <span class="legend-name">{{ w.name }}</span>
              <span class="legend-value">{{ (db?.productionLines || []).filter(l => l.workshop_id === w.id).length }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Bar Chart: 生产趋势 -->
      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title-area">
            <div class="chart-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>
            </div>
            <span class="chart-title">生产趋势</span>
          </div>
          <div class="chart-legend-inline">
            <span class="legend-dot" style="background: #6e3ff3;"></span>
            <span class="legend-text">计划数</span>
            <span class="legend-dot" style="background: #22c55e;"></span>
            <span class="legend-text">完成数</span>
          </div>
        </div>
        <div class="chart-body">
          <v-chart :option="barOption" :autoresize="true" style="height: 240px; width: 100%;" />
        </div>
      </div>
    </div>

    <!-- Tables Row -->
    <div class="tables-row">
      <!-- Workshop Lines Status -->
      <div class="table-card">
        <div class="table-header">
          <div class="table-title-area">
            <div class="table-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>
            </div>
            <span class="table-title">车间产线状态</span>
          </div>
        </div>
        <div class="table-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>产线</th>
                <th>车间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(line, i) in workshopLines" :key="line.id">
                <td class="cell-index">{{ i + 1 }}</td>
                <td>
                  <div class="cell-with-badge">
                    <span class="line-badge" :style="{ background: ['#6e3ff3','#3b82f6','#22c55e','#f59e0b'][i % 4] }">
                      {{ line.line_name?.charAt(0) || 'L' }}
                    </span>
                    <span class="cell-name">{{ line.line_name }}</span>
                  </div>
                </td>
                <td class="cell-muted">{{ (db?.workshops || []).find(w => w.id === line.workshop_id)?.name || '-' }}</td>
                <td>
                  <span class="status-badge" :class="{
                    'status-active': line.status === '生产中',
                    'status-idle': line.status === '空闲',
                    'status-error': line.status === '故障',
                  }">{{ line.status }}</span>
                </td>
              </tr>
              <tr v-if="!workshopLines.length">
                <td colspan="4" class="cell-empty">暂无产线数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent Plans -->
      <div class="table-card">
        <div class="table-header">
          <div class="table-title-area">
            <div class="table-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
            </div>
            <span class="table-title">近期预排总计划</span>
            <span class="table-count">{{ recentPlans.length }}</span>
          </div>
          <button class="btn btn-sm btn-outline" @click="emit('navigate', 'mainPlan')">查看全部</button>
        </div>
        <div class="table-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>款式</th>
                <th>数量</th>
                <th>交期</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(plan, i) in recentPlans" :key="plan.id">
                <td class="cell-index">{{ i + 1 }}</td>
                <td>
                  <div class="cell-with-badge">
                    <span class="plan-badge">{{ (plan.style_no || plan.style_id || '?').toString().slice(0, 2) }}</span>
                    <span class="cell-name">{{ plan.style_no || plan.style_id }}</span>
                  </div>
                </td>
                <td class="cell-mono">{{ plan.plan_qty || '-' }}</td>
                <td class="cell-muted">{{ plan.due_date || '-' }}</td>
              </tr>
              <tr v-if="!recentPlans.length">
                <td colspan="4" class="cell-empty">暂无计划数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1200px;
}

/* Welcome Section */
.welcome-section {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 24px;
  gap: 16px;
}
.welcome-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 6px;
}
.welcome-desc {
  font-size: 14px;
  color: var(--text-secondary);
}
.welcome-desc strong {
  color: var(--text);
  font-weight: 600;
}
.welcome-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  height: 36px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s ease;
  border: none;
  white-space: nowrap;
}
.btn-sm {
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
}
.btn-primary {
  background: var(--primary);
  color: white;
}
.btn-primary:hover {
  background: var(--primary-hover);
}
.btn-outline {
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.btn-outline:hover {
  background: var(--primary-light);
  border-color: var(--border-hover);
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
.stat-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  transition: all .15s ease;
}
.stat-card:hover {
  box-shadow: var(--shadow-md);
}
.stat-content {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.stat-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.stat-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.stat-label {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 500;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.stat-total {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-tertiary);
}
.stat-change {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  margin-top: 2px;
}
.change-positive { color: #22c55e; }
.change-negative { color: #ef4444; }
.change-label { color: var(--text-tertiary); }

/* Charts Row */
.charts-row {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.chart-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.chart-title-area {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chart-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.chart-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.chart-subtitle {
  font-size: 12px;
  color: var(--text-tertiary);
}
.chart-legend-inline {
  display: flex;
  align-items: center;
  gap: 12px;
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.legend-text {
  font-size: 11px;
  color: var(--text-tertiary);
}
.chart-body-pie {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pie-legend {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.legend-item .legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}
.legend-name {
  flex: 1;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-value {
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.chart-body {
  min-height: 240px;
}

/* Tables Row */
.tables-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.table-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.table-title-area {
  display: flex;
  align-items: center;
  gap: 10px;
}
.table-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.table-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.table-count {
  background: var(--primary-light);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 9999px;
}
.table-body {
  overflow-x: auto;
}

/* Data Table */
.data-table {
  width: 100%;
  border-collapse: collapse;
}
.data-table th {
  text-align: left;
  padding: 10px 16px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: .3px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}
.data-table td {
  padding: 10px 16px;
  font-size: 13px;
  color: var(--text);
  border-bottom: 1px solid var(--border-light);
}
.data-table tr:last-child td {
  border-bottom: none;
}
.data-table tr:hover td {
  background: var(--primary-light);
}
.cell-index {
  color: var(--text-tertiary);
  font-weight: 500;
  width: 40px;
}
.cell-muted {
  color: var(--text-secondary);
}
.cell-mono {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.cell-empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 32px 16px !important;
}
.cell-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}
.line-badge {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.plan-badge {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--primary-light);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.cell-name {
  font-weight: 500;
}

/* Status Badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
}
.status-active {
  background: #f0fdf4;
  color: #22c55e;
}
.status-idle {
  background: #f8f9fb;
  color: #a1a1aa;
}
.status-error {
  background: #fef2f2;
  color: #ef4444;
}

@media (max-width: 1024px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .charts-row { grid-template-columns: 1fr; }
  .tables-row { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .stats-grid { grid-template-columns: 1fr; }
  .welcome-section { flex-direction: column; align-items: flex-start; }
}
</style>
