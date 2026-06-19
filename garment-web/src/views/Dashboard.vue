<script setup>
import { computed, ref, onMounted } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart, BarChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import api from '../api'

use([CanvasRenderer, PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

const props = defineProps({ db: Object })
const emit = defineEmits(['navigate'])

const achievementData = ref(null)
const loadingAchievement = ref(false)

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

// 各工序达成率折线图
const processRateOption = computed(() => {
  if (!achievementData.value) return {}
  const { dates, processRates } = achievementData.value
  const shortDates = dates.map(d => d.slice(5)) // MM-DD
  const processConfig = [
    { key: 'cutting', label: '裁剪', color: '#ef4444' },
    { key: 'printing', label: '印花', color: '#f59e0b' },
    { key: 'embroidery', label: '刺绣', color: '#22c55e' },
    { key: 'template', label: '模板', color: '#3b82f6' },
    { key: 'ironing', label: '烫标', color: '#8b5cf6' },
    { key: 'sewing', label: '缝制', color: '#6e3ff3' },
  ]
  return {
    tooltip: { trigger: 'axis', formatter: (params) => {
      let html = `<b>${params[0].axisValue}</b><br/>`
      params.forEach(p => { html += `${p.marker} ${p.seriesName}: ${p.value}%<br/>` })
      return html
    }},
    legend: { data: processConfig.map(p => p.label), bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 40, right: 20, top: 10, bottom: 60 },
    xAxis: { type: 'category', data: shortDates, axisLabel: { color: '#a1a1aa', fontSize: 10, rotate: 45, margin: 12 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#a1a1aa', fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#f3f4f6', type: 'solid' } } },
    series: processConfig.map(p => ({
      name: p.label,
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: p.color, width: 2 },
      itemStyle: { color: p.color },
      data: processRates[p.key] || dates.map(() => 0),
    })),
  }
})

// 缝制各车间达成率折线图
const sewingWorkshopOption = computed(() => {
  if (!achievementData.value) return {}
  const { dates, sewingByWorkshop } = achievementData.value
  const shortDates = dates.map(d => d.slice(5))
  const colors = ['#6e3ff3', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444']
  const workshops = Object.keys(sewingByWorkshop)
  return {
    tooltip: { trigger: 'axis', formatter: (params) => {
      let html = `<b>${params[0].axisValue}</b><br/>`
      params.forEach(p => { html += `${p.marker} ${p.seriesName}: ${p.value}%<br/>` })
      return html
    }},
    legend: { data: workshops.map(w => w + '车间'), bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 40, right: 20, top: 10, bottom: 60 },
    xAxis: { type: 'category', data: shortDates, axisLabel: { color: '#a1a1aa', fontSize: 10, rotate: 45, margin: 12 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#a1a1aa', fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#f3f4f6', type: 'solid' } } },
    series: workshops.map((w, i) => ({
      name: w + '车间',
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: colors[i % colors.length], width: 2 },
      itemStyle: { color: colors[i % colors.length] },
      data: sewingByWorkshop[w] || dates.map(() => 0),
    })),
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

async function loadAchievementRate() {
  loadingAchievement.value = true
  try {
    const { data } = await api.getAchievementRate()
    achievementData.value = data
  } catch (e) {
    console.error('加载达成率失败:', e)
  }
  loadingAchievement.value = false
}

function getKpiIcon(name) {
  const icons = {
    tag: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
    activity: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>`,
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`,
    building: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`,
  }
  return icons[name] || ''
}

onMounted(() => {
  loadAchievementRate()
})
</script>

<template>
  <div class="dashboard">
    <!-- Welcome Section (无按钮) -->
    <div class="welcome-section">
      <div class="welcome-text">
        <h2 class="welcome-title">数据看板</h2>
        <p class="welcome-desc">
          当前有 <strong>{{ stats.busyLines }} 条产线</strong> 正在生产，
          <strong>{{ stats.mainPlan }} 个计划</strong> 进行中
        </p>
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
          </div>
        </div>
      </div>
    </div>

    <!-- 达成率图表 -->
    <div class="charts-row">
      <!-- 各工序达成率 -->
      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title-area">
            <div class="chart-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <span class="chart-title">各工序排产计划达成率（近30天）</span>
          </div>
        </div>
        <div class="chart-body">
          <v-chart v-if="achievementData" :option="processRateOption" :autoresize="true" style="height: 280px; width: 100%;" />
          <div v-else class="chart-loading">加载中...</div>
        </div>
      </div>

      <!-- 缝制各车间达成率 -->
      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title-area">
            <div class="chart-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <span class="chart-title">缝制各车间排产计划达成率（近30天）</span>
          </div>
        </div>
        <div class="chart-body">
          <v-chart v-if="achievementData" :option="sewingWorkshopOption" :autoresize="true" style="height: 280px; width: 100%;" />
          <div v-else class="chart-loading">加载中...</div>
        </div>
      </div>
    </div>

    <!-- 原有图表 -->
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

      <!-- Tables -->
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
    </div>

    <!-- 近期计划 -->
    <div class="tables-row">
      <div class="table-card full-width">
        <div class="table-header">
          <div class="table-title-area">
            <div class="table-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
            </div>
            <span class="table-title">近期预排总计划</span>
            <span class="table-count">{{ recentPlans.length }}</span>
          </div>
        </div>
        <div class="table-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>款号</th>
                <th>品名</th>
                <th>计划数量</th>
                <th>交期</th>
                <th>缝制开始</th>
                <th>缝制结束</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="plan in recentPlans" :key="plan.id">
                <td class="cell-name">{{ plan.style_no }}</td>
                <td class="cell-muted">{{ plan.product_name }}</td>
                <td>{{ plan.plan_qty?.toLocaleString() }}</td>
                <td>{{ plan.due_date || '-' }}</td>
                <td>{{ plan.sewing_start || '-' }}</td>
                <td>{{ plan.sewing_end || '-' }}</td>
              </tr>
              <tr v-if="!recentPlans.length">
                <td colspan="6" class="cell-empty">暂无计划数据</td>
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

.welcome-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.welcome-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 4px;
}
.welcome-desc {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
.stat-card {
  background: var(--card, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--radius, 8px);
  padding: 16px;
}
.stat-content {
  display: flex;
  align-items: center;
  gap: 12px;
}
.stat-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stat-info {
  display: flex;
  flex-direction: column;
}
.stat-label {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text, #111827);
}
.stat-total {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-secondary, #6b7280);
}

.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.chart-card {
  background: var(--card, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--radius, 8px);
  padding: 16px;
}
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.chart-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chart-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #f3f0ff;
  color: #6e3ff3;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chart-title {
  font-size: 14px;
  font-weight: 600;
}
.chart-subtitle {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}
.chart-body {
  min-height: 280px;
}
.chart-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 280px;
  color: var(--text-secondary, #6b7280);
}

.chart-body-pie {
  display: flex;
  flex-direction: column;
}
.pie-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.legend-name {
  color: var(--text-secondary, #6b7280);
}
.legend-value {
  font-weight: 600;
}

.tables-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.full-width {
  grid-column: 1 / -1;
}
.table-card {
  background: var(--card, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--radius, 8px);
  padding: 16px;
}
.table-header {
  margin-bottom: 12px;
}
.table-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
}
.table-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #f3f0ff;
  color: #6e3ff3;
  display: flex;
  align-items: center;
  justify-content: center;
}
.table-title {
  font-size: 14px;
  font-weight: 600;
}
.table-count {
  background: #f3f0ff;
  color: #6e3ff3;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  color: var(--text-secondary, #6b7280);
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.cell-index {
  color: var(--text-secondary, #6b7280);
}
.cell-name {
  font-weight: 500;
}
.cell-muted {
  color: var(--text-secondary, #6b7280);
}
.cell-empty {
  text-align: center;
  color: var(--text-secondary, #6b7280);
  padding: 24px !important;
}
.cell-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}
.line-badge {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}
.status-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
}
.status-active {
  background: #f0fdf4;
  color: #22c55e;
}
.status-idle {
  background: #f3f4f6;
  color: #6b7280;
}
.status-error {
  background: #fef2f2;
  color: #ef4444;
}
</style>
