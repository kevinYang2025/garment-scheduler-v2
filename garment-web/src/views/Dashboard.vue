<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart, BarChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent, DataZoomComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import api from '../api'
import { useLangStore } from '../stores/lang'
import { t } from '../i18n'
import dict from '../i18n'

use([CanvasRenderer, PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, DataZoomComponent])

const langStore = useLangStore()

// ECharts legend 不渲染 \n,所以按当前语言模式返回单语或带 · 分隔符的双语
function legendName(key, raw, mode) {
  const entry = dict[key]
  if (!entry) return raw || key
  if (mode === 'km') return entry.km
  if (mode === 'zh') return entry.zh
  return `${entry.zh} · ${entry.km}`
}

// 工序名 → i18n key (按截图上的顺序: 裁剪/印花/刺绣/模板/烫标/缝制)
const processConfigBase = [
  { key: 'cutting', i18n: 'dispatch.cutting', color: '#ef4444' },
  { key: 'printing', i18n: 'dispatch.printing', color: '#f59e0b' },
  { key: 'embroidery', i18n: 'dispatch.embroidery', color: '#22c55e' },
  { key: 'template', i18n: 'dispatch.template', color: '#3b82f6' },
  { key: 'ironing', i18n: 'dispatch.ironing', color: '#8b5cf6' },
  { key: 'sewing', i18n: 'dispatch.sewing', color: '#6e3ff3' },
]

// 后端车间名 (1车间/一车间 等) → i18n key,按截图命名约定
function workshopI18nKey(name) {
  const s = String(name || '').trim()
  if (!s) return ''
  if (s.includes('一') || s.startsWith('1车')) return 'workshopNames.ws1'
  if (s.includes('二') || s.startsWith('2车')) return 'workshopNames.ws2'
  if (s.includes('三') || s.startsWith('3车')) return 'workshopNames.ws3'
  if (s.includes('四') || s.startsWith('4车')) return 'workshopNames.ws4'
  if (s.includes('五') || s.startsWith('5车')) return 'workshopNames.ws5'
  return ''
}

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
  const mode = langStore.mode
  const processConfig = processConfigBase.map(p => ({
    ...p,
    // seriesName 用单语,legend 用 formatter 函数动态取 (兼容 both 模式双语横排)
    label: legendName(p.i18n, p.key, mode),
    shortLabel: dict[p.i18n]?.zh || p.key,
  }))
  return {
    tooltip: { trigger: 'axis', formatter: (params) => {
      let html = `<b>${params[0].axisValue}</b><br/>`
      params.forEach(p => {
        // 在 tooltip 里显示中文短名 + 数值
        const item = processConfig.find(c => c.label === p.seriesName)
        const name = item?.shortLabel || p.seriesName
        html += `${p.marker} ${name}: ${p.value}%<br/>`
      })
      return html
    }},
    legend: {
      data: processConfig.map(p => p.shortLabel),  // legend.data 用短名,formatter 再回填双语
      bottom: 0,
      type: 'scroll',
      pageIconColor: '#666',
      pageTextStyle: { color: '#666' },
      textStyle: { fontSize: 10, lineHeight: 14 },
      formatter: (name) => {
        const item = processConfig.find(p => p.shortLabel === name)
        return item?.label || name
      },
    },
    grid: { left: 40, right: 20, top: 10, bottom: 110 },
    xAxis: { type: 'category', data: shortDates, axisLabel: { color: '#a1a1aa', fontSize: 10, rotate: 45, margin: 18 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#a1a1aa', fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#f3f4f6', type: 'solid' } } },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, start: 0, end: 100 },
      { type: 'slider', xAxisIndex: 0, bottom: 60, height: 18, start: 0, end: 100 },
    ],
    series: processConfig.map(p => ({
      name: p.shortLabel,  // seriesName 用短名,tooltip formatter 匹配
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
  const workshopNames = Object.keys(sewingByWorkshop)
  const mode = langStore.mode
  const translated = workshopNames.map(w => {
    const key = workshopI18nKey(w)
    return {
      raw: w,
      label: legendName(key, w, mode),
      shortLabel: dict[key]?.zh || w,
    }
  })
  return {
    tooltip: { trigger: 'axis', formatter: (params) => {
      let html = `<b>${params[0].axisValue}</b><br/>`
      params.forEach(p => {
        const item = translated.find(c => c.label === p.seriesName || c.shortLabel === p.seriesName)
        const name = item?.shortLabel || p.seriesName
        html += `${p.marker} ${name}: ${p.value}%<br/>`
      })
      return html
    }},
    legend: {
      data: translated.map(w => w.shortLabel),
      bottom: 0,
      type: 'scroll',
      pageIconColor: '#666',
      pageTextStyle: { color: '#666' },
      textStyle: { fontSize: 10, lineHeight: 14 },
      formatter: (name) => {
        const item = translated.find(w => w.shortLabel === name)
        return item?.label || name
      },
    },
    grid: { left: 40, right: 20, top: 10, bottom: 110 },
    xAxis: { type: 'category', data: shortDates, axisLabel: { color: '#a1a1aa', fontSize: 10, rotate: 45, margin: 18 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#a1a1aa', fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#f3f4f6', type: 'solid' } } },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, start: 0, end: 100 },
      { type: 'slider', xAxisIndex: 0, bottom: 60, height: 18, start: 0, end: 100 },
    ],
    series: translated.map((w, i) => ({
      name: w.shortLabel,
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: colors[i % colors.length], width: 2 },
      itemStyle: { color: colors[i % colors.length] },
      data: sewingByWorkshop[w.raw] || dates.map(() => 0),
    })),
  }
})

const recentPlans = computed(() => {
  const plans = props.db?.mainPlan || []
  return plans.slice(0, 8)
})

// 订单统计图表
const orderStatsMode = ref('week')
const orderStatsData = ref(null)

async function loadOrderStats() {
  try {
    const { data } = await api.getOrderStats(orderStatsMode.value)
    orderStatsData.value = data
  } catch { /* ignore */ }
}

watch(orderStatsMode, loadOrderStats)

const orderChartOption = computed(() => {
  if (!orderStatsData.value) return {}
  const { labels, received, completed } = orderStatsData.value
  return {
    tooltip: { trigger: 'axis', appendToBody: true },
    legend: { data: ['接收订单', '完成订单'], bottom: 0, textStyle: { fontSize: 10 } },
    grid: { left: 40, right: 16, top: 10, bottom: 40 },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#a1a1aa', fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: '#a1a1aa', fontSize: 10 }, splitLine: { lineStyle: { color: '#f3f4f6' } } },
    series: [
      { name: '接收订单', type: 'bar', data: received, itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 24 },
      { name: '完成订单', type: 'bar', data: completed, itemStyle: { color: '#22c55e', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 24 },
    ],
  }
})

// 产线状态详情（5个车间分页）
const lineStatusData = ref({})
const activeWorkshopTab = ref(0)
const workshopTabNames = ['一车间', '二车间', '三车间', '四车间', '五车间']

async function loadLineStatus() {
  try {
    const { data } = await api.getLineStatus()
    const map = {}
    if (Array.isArray(data)) {
      for (const ws of data) map[ws.workshop] = ws.lines || []
    }
    lineStatusData.value = map
  } catch { /* ignore */ }
}

const currentWorkshopLines = computed(() => {
  const name = workshopTabNames[activeWorkshopTab.value]
  return lineStatusData.value[name] || []
})

// 前置车间生产状态
const secondaryStatusData = ref({})
const activeSecondaryTab = ref('cutting')
const secondaryTabConfig = [
  { key: 'cutting', label: '裁剪', color: '#ef4444' },
  { key: 'printing', label: '印花', color: '#f59e0b' },
  { key: 'embroidery', label: '刺绣', color: '#22c55e' },
  { key: 'template', label: '模板', color: '#3b82f6' },
  { key: 'ironing', label: '烫标', color: '#8b5cf6' },
]
const currentSecondaryItems = computed(() => secondaryStatusData.value[activeSecondaryTab.value] || [])

async function loadSecondaryStatus() {
  try {
    const { data } = await api.getSecondaryStatus()
    secondaryStatusData.value = data || {}
  } catch { /* ignore */ }
}

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
  loadLineStatus()
  loadSecondaryStatus()
  loadOrderStats()
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
      <!-- 前置车间生产状态 -->
      <div class="table-card">
        <div class="table-header">
          <div class="table-title-area">
            <div class="table-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </div>
            <span class="table-title">前置车间生产状态</span>
          </div>
        </div>
        <div class="ws-tabs">
          <button
            v-for="tab in secondaryTabConfig"
            :key="tab.key"
            class="ws-tab"
            :class="{ active: activeSecondaryTab === tab.key }"
            :style="activeSecondaryTab === tab.key ? { borderBottomColor: tab.color, color: tab.color } : {}"
            @click="activeSecondaryTab = tab.key"
          >{{ tab.label }}</button>
        </div>
        <div class="table-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>款号</th>
                <th>品名</th>
                <th style="text-align:right">计划数</th>
                <th style="text-align:right">已完成</th>
                <th style="text-align:right">进度</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in currentSecondaryItems" :key="item.style_no + (item.color || '')">
                <td class="cell-name">{{ item.style_no }}</td>
                <td class="cell-muted">{{ item.product_name }}</td>
                <td style="text-align:right">{{ item.plan_qty.toLocaleString() }}</td>
                <td style="text-align:right">{{ item.completed.toLocaleString() }}</td>
                <td style="text-align:right">
                  <div class="progress-cell">
                    <div class="progress-bar-mini">
                      <div class="progress-fill" :style="{ width: Math.min(item.progress, 100) + '%', background: item.progress >= 80 ? '#22c55e' : item.progress >= 50 ? '#f59e0b' : '#ef4444' }"></div>
                    </div>
                    <span class="progress-text">{{ item.progress }}%</span>
                  </div>
                </td>
                <td>
                  <span class="status-badge" :class="{
                    'status-active': item.status === '已完成',
                    'status-idle': item.status === '待生产',
                  }">{{ item.status }}</span>
                </td>
              </tr>
              <tr v-if="!currentSecondaryItems.length">
                <td colspan="6" class="cell-empty">当前无{{ secondaryTabConfig.find(t => t.key === activeSecondaryTab)?.label }}排程</td>
              </tr>
            </tbody>
          </table>
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
        <!-- 车间页签 -->
        <div class="ws-tabs">
          <button
            v-for="(name, i) in workshopTabNames"
            :key="name"
            class="ws-tab"
            :class="{ active: activeWorkshopTab === i }"
            @click="activeWorkshopTab = i"
          >{{ name }}</button>
        </div>
        <div class="table-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>产线</th>
                <th>当前款号</th>
                <th>品名</th>
                <th style="text-align:right">计划数</th>
                <th style="text-align:right">已完成</th>
                <th style="text-align:right">进度</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in currentWorkshopLines" :key="line.line_name">
                <td>
                  <div class="cell-with-badge">
                    <span class="line-badge" :style="{ background: line.status === '生产中' ? '#22c55e' : line.status === '故障' ? '#ef4444' : '#a1a1aa' }">
                      {{ line.line_name?.replace(/班$/, '') || '-' }}
                    </span>
                  </div>
                </td>
                <td class="cell-name">{{ line.style_no || '-' }}</td>
                <td class="cell-muted">{{ line.product_name || '-' }}</td>
                <td style="text-align:right">{{ line.plan_qty ? line.plan_qty.toLocaleString() : '-' }}</td>
                <td style="text-align:right">{{ line.completed ? line.completed.toLocaleString() : '-' }}</td>
                <td style="text-align:right">
                  <div v-if="line.plan_qty" class="progress-cell">
                    <div class="progress-bar-mini">
                      <div class="progress-fill" :style="{ width: Math.min(line.progress, 100) + '%', background: line.progress >= 80 ? '#22c55e' : line.progress >= 50 ? '#f59e0b' : '#ef4444' }"></div>
                    </div>
                    <span class="progress-text">{{ line.progress }}%</span>
                  </div>
                  <span v-else class="cell-muted">-</span>
                </td>
                <td>
                  <span class="status-badge" :class="{
                    'status-active': line.status === '生产中',
                    'status-idle': line.status === '空闲',
                    'status-error': line.status === '故障',
                  }">{{ line.status }}</span>
                </td>
              </tr>
              <tr v-if="!currentWorkshopLines.length">
                <td colspan="7" class="cell-empty">暂无产线数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 订单统计 -->
    <div class="tables-row">
      <div class="chart-card full-width">
        <div class="chart-header">
          <div class="chart-title-area">
            <div class="chart-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            </div>
            <span class="chart-title">订单接收 / 完成统计</span>
          </div>
          <div class="ws-tabs" style="border:none;padding:0">
            <button class="ws-tab" :class="{ active: orderStatsMode === 'week' }" @click="orderStatsMode = 'week'">按周</button>
            <button class="ws-tab" :class="{ active: orderStatsMode === 'month' }" @click="orderStatsMode = 'month'">按月</button>
          </div>
        </div>
        <div class="chart-body" style="padding: 8px 16px 16px">
          <v-chart v-if="orderStatsData" :option="orderChartOption" :autoresize="true" style="height: 260px; width: 100%;" />
          <div v-else class="chart-loading">加载中...</div>
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

/* 车间页签 */
.ws-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border, #e5e7eb);
  padding: 0 12px;
}
.ws-tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all .15s;
}
.ws-tab:hover {
  color: var(--primary, #6e3ff3);
}
.ws-tab.active {
  color: var(--primary, #6e3ff3);
  border-bottom-color: var(--primary, #6e3ff3);
}

/* 进度条 */
.progress-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.progress-bar-mini {
  width: 48px;
  height: 6px;
  background: #f3f4f6;
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width .3s;
}
.progress-text {
  font-size: 12px;
  font-weight: 600;
  min-width: 32px;
  text-align: right;
}
</style>
