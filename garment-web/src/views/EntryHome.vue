<script setup>
import { ref, computed, onMounted } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart, BarChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'
import api from '../api'

use([CanvasRenderer, PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

const emit = defineEmits(['navigate'])
const auth = useAuthStore()
const { t, setMode, mode } = useI18n()

const stats = ref({ styles: 0, mainPlan: 0, workshops: 0, lines: 0, busyLines: 0, cutPieces: 0, cutPiecesInbound: 0, cutPiecesOutbound: 0 })
const achievementData = ref(null)
const mainPlanData = ref([])
const productionLines = ref([])
const workshops = ref([])

// 可选的看板内容
const chartOptions = computed(() => [
  { key: 'processRate', labelKey: 'entry.chart.processRate', icon: '📈' },
  { key: 'sewingWorkshop', labelKey: 'entry.chart.sewingWorkshop', icon: '📊' },
  { key: 'workshopPie', labelKey: 'entry.chart.workshopPie', icon: '🥧' },
  { key: 'kpiStats', labelKey: 'entry.chart.kpiStats', icon: '📋' },
  { key: 'recentPlans', labelKey: 'entry.chart.recentPlans', icon: '📅' },
  { key: 'lineStatus', labelKey: 'entry.chart.lineStatus', icon: '🏭' },
])

// 两个面板各自选中的内容（持久化到 localStorage）
const panel1Key = ref(localStorage.getItem('home_panel1') || 'processRate')
const panel2Key = ref(localStorage.getItem('home_panel2') || 'kpiStats')
const openMenu = ref(null) // 'panel1' | 'panel2' | null

function selectPanel(panel, key) {
  if (panel === 'panel1') { panel1Key.value = key; localStorage.setItem('home_panel1', key) }
  else { panel2Key.value = key; localStorage.setItem('home_panel2', key) }
  openMenu.value = null
}

function getLabel(key) {
  const opt = chartOptions.value.find(o => o.key === key)
  return opt ? t(opt.labelKey) : ''
}

// 点击外部关闭菜单
function onOverlayClick() { openMenu.value = null }

async function loadData() {
  try {
    const [stylesRes, planRes, linesRes, workshopsRes, achRes, whRes, ibRes, obRes] = await Promise.all([
      api.getStyles(''),
      api.getMainPlan(),
      api.getProductionLines(),
      api.getWorkshops(),
      api.getAchievementRate().catch(() => ({ data: null })),
      api.getWarehouseInventory('cutting_piece').catch(() => ({ data: [] })),
      api.getWarehouseInbound('cutting_piece').catch(() => ({ data: [] })),
      api.getWarehouseOutbound('cutting_piece').catch(() => ({ data: [] })),
    ])
    stats.value.styles = stylesRes.data?.length || 0
    stats.value.mainPlan = planRes.data?.length || 0
    mainPlanData.value = planRes.data || []
    productionLines.value = linesRes.data || []
    workshops.value = workshopsRes.data || []
    stats.value.workshops = workshopsRes.data?.length || 0
    stats.value.lines = linesRes.data?.length || 0
    stats.value.busyLines = linesRes.data?.filter(l => l.status === '生产中')?.length || 0
    achievementData.value = achRes.data
    // [2026-06-19] 裁片库统计
    const inv = whRes.data || []
    const today = new Date().toISOString().slice(0, 10)
    stats.value.cutPieces = inv.reduce((s, r) => s + (r.current_qty || 0), 0)
    stats.value.cutPiecesInbound = (ibRes.data || [])
      .filter(r => (r.inbound_date || '').slice(0, 10) === today)
      .reduce((s, r) => s + (r.qty || 0), 0)
    stats.value.cutPiecesOutbound = (obRes.data || [])
      .filter(r => (r.outbound_date || '').slice(0, 10) === today)
      .reduce((s, r) => s + (r.qty || 0), 0)
  } catch { /* ignore */ }
}

// ── 图表 computed ──

const processRateOption = computed(() => {
  if (!achievementData.value) return null
  const { dates, processRates } = achievementData.value
  const shortDates = dates.map(d => d.slice(5))
  const cfg = [
    { key: 'cutting', labelKey: 'dispatch.cutting', color: '#ef4444' },
    { key: 'printing', labelKey: 'dispatch.printing', color: '#f59e0b' },
    { key: 'embroidery', labelKey: 'dispatch.embroidery', color: '#22c55e' },
    { key: 'template', labelKey: 'dispatch.template', color: '#3b82f6' },
    { key: 'ironing', labelKey: 'dispatch.ironing', color: '#8b5cf6' },
    { key: 'sewing', labelKey: 'dispatch.sewing', color: '#6e3ff3' },
  ].map(c => ({ ...c, label: t(c.labelKey) }))
  const pieTipFmt = t('entry.pie.tooltip', 'zh')
  return {
    tooltip: { trigger: 'axis', appendToBody: true, formatter: (params) => {
      let h = `<b>${params[0].axisValue}</b><br/>`
      params.forEach(p => { h += `${p.marker} ${p.seriesName}: ${p.value}%<br/>` })
      return h
    }},
    legend: { data: cfg.map(p => p.label), bottom: 0, textStyle: { fontSize: 10 } },
    grid: { left: 36, right: 12, top: 10, bottom: 56 },
    xAxis: { type: 'category', data: shortDates, axisLabel: { color: '#a1a1aa', fontSize: 9, rotate: 45, margin: 10 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#a1a1aa', fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#f3f4f6' } } },
    series: cfg.map(p => ({
      name: p.label, type: 'line', smooth: true, symbol: 'none',
      lineStyle: { color: p.color, width: 2 }, itemStyle: { color: p.color },
      data: processRates[p.key] || dates.map(() => 0),
    })),
  }
})

const sewingWorkshopOption = computed(() => {
  if (!achievementData.value) return null
  const { dates, sewingByWorkshop } = achievementData.value
  const shortDates = dates.map(d => d.slice(5))
  const colors = ['#6e3ff3', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444']
  const wss = Object.keys(sewingByWorkshop)
  const suffix = t('entry.workshopSuffix', 'zh')
  const wssLabel = wss.map(w => w + suffix)
  return {
    tooltip: { trigger: 'axis', appendToBody: true, formatter: (params) => {
      let h = `<b>${params[0].axisValue}</b><br/>`
      params.forEach(p => { h += `${p.marker} ${p.seriesName}: ${p.value}%<br/>` })
      return h
    }},
    legend: { data: wssLabel, bottom: 0, textStyle: { fontSize: 10 } },
    grid: { left: 36, right: 12, top: 10, bottom: 56 },
    xAxis: { type: 'category', data: shortDates, axisLabel: { color: '#a1a1aa', fontSize: 9, rotate: 45, margin: 10 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#a1a1aa', fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#f3f4f6' } } },
    series: wss.map((w, i) => ({
      name: w + suffix, type: 'line', smooth: true, symbol: 'none',
      lineStyle: { color: colors[i % colors.length], width: 2 },
      itemStyle: { color: colors[i % colors.length] },
      data: sewingByWorkshop[w] || dates.map(() => 0),
    })),
  }
})

const workshopPieOption = computed(() => {
  if (!workshops.value.length) return null
  const data = workshops.value.map(w => ({
    name: w.name,
    value: productionLines.value.filter(l => l.workshop_id === w.id).length,
  }))
  const tipFmt = t('entry.pie.tooltip', 'zh')
  return {
    tooltip: { trigger: 'item', formatter: tipFmt },
    color: ['#6e3ff3', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899'],
    series: [{
      type: 'pie', radius: ['40%', '68%'], center: ['50%', '48%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, fontSize: 11, formatter: '{b}\n{d}%' },
      data,
    }],
  }
})

const kpiItems = computed(() => [
  { labelKey: 'entry.kpi.styles', value: stats.value.styles, color: '#6e3ff3', bg: '#f3f0ff' },
  { labelKey: 'entry.kpi.busyLines', value: `${stats.value.busyLines}/${stats.value.lines}`, color: '#22c55e', bg: '#f0fdf4' },
  { labelKey: 'entry.kpi.mainPlan', value: stats.value.mainPlan, color: '#3b82f6', bg: '#eff6ff' },
  { labelKey: 'entry.kpi.workshops', value: stats.value.workshops, color: '#f59e0b', bg: '#fffbeb' },
])

const recentPlans = computed(() => mainPlanData.value.slice(0, 6))

const roleMapKey = { admin: 'user.role.admin', planning_manager: 'user.role.planning_manager', planner: 'user.role.planner', dispatcher: 'user.role.dispatcher', supervisor: 'user.role.supervisor' }
const roleLabel = computed(() => auth.user?.role ? t(roleMapKey[auth.user.role]) : t('common.user'))
const today = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`
})
const weekday = computed(() => {
  const mapZh = ['日', '一', '二', '三', '四', '五', '六']
  const mapKm = ['អាទិត្យ', 'ច័ន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍']
  const map = mode.value === 'km' ? mapKm : mapZh
  return map[new Date().getDay()]
})
const serviceStatus = computed(() => ({ color: '#22c55e', labelKey: 'entry.welcome.ok' }))

// 5 张模块卡(第二行 4+1,新增加 裁片库)
const moduleCards = computed(() => [
  {
    key: 'basicData', labelKey: 'nav.group.basicData', bg: 'linear-gradient(135deg, #fda4af, #fb7185)',
    main: stats.value.styles, mainUnitKey: 'entry.unit.pcs',
    labelAKey: 'entry.moduleCard.todayNew', valueA: '+12', typeA: 'up',
    labelBKey: 'entry.moduleCard.inProd', valueB: stats.value.styles, typeB: 'down',
    progColorA: '#3b82f6', progColorB: '#ef4444', progAW: 70, progBW: 30
  },
  {
    key: 'planManagement', labelKey: 'nav.group.planManagement', bg: 'linear-gradient(135deg, #60a5fa, #2563eb)',
    main: stats.value.mainPlan, mainUnitKey: 'entry.unit.item',
    labelAKey: 'entry.moduleCard.inProgress', valueA: '24', typeA: 'up',
    labelBKey: 'entry.moduleCard.completed', valueB: '103', typeB: 'down',
    progColorA: '#60a5fa', progColorB: '#22c55e', progAW: 60, progBW: 40
  },
  {
    key: 'dispatch', labelKey: 'nav.group.dispatch', bg: 'linear-gradient(135deg, #fb923c, #c2410c)',
    main: 9235, mainUnitKey: 'entry.unit.piece',
    labelAKey: 'entry.moduleCard.todayDispatch', valueA: '+232', typeA: 'up',
    labelBKey: 'entry.moduleCard.defectRate', valueB: '1.2%', typeB: 'down',
    progColorA: '#fb923c', progColorB: '#ef4444', progAW: 80, progBW: 20
  },
  {
    key: 'warehouse', labelKey: 'nav.warehouse', bg: 'linear-gradient(135deg, #14b8a6, #0d9488)',
    main: stats.value.cutPieces, mainUnitKey: 'entry.unit.piece',
    labelAKey: 'entry.moduleCard.inbound', valueA: '+' + stats.value.cutPiecesInbound, typeA: 'up',
    labelBKey: 'entry.moduleCard.outbound', valueB: '-' + stats.value.cutPiecesOutbound, typeB: 'down',
    progColorA: '#14b8a6', progColorB: '#fbbf24', progAW: 65, progBW: 35
  },
  {
    key: 'config', labelKey: 'nav.group.settings', bg: 'linear-gradient(135deg, #6366f1, #4338ca)',
    main: 24, mainUnitKey: 'entry.unit.people',
    labelAKey: 'entry.moduleCard.online', valueA: '8', typeA: 'up',
    labelBKey: 'entry.moduleCard.operators', valueB: '16', typeB: 'down',
    progColorA: '#fbbf24', progColorB: 'rgba(255,255,255,0.6)', progAW: 33, progBW: 67
  }
])

function cardLabel(card) {
  return t(card.labelKey)
}

function go(k) { emit('navigate', k) }

const showName = computed(() => {
  const dn = auth.user?.display_name
  if (!dn) return t('entry.welcome.notLogged')
  const dnKm = auth.user?.display_name_km
  return dnKm ? `${dn}\n${dnKm}` : dn
})

function lineStatusText(s) {
  if (s === '生产中') return t('entry.status.busy')
  if (s === '空闲') return t('entry.status.idle')
  if (s === '故障') return t('entry.status.error')
  return s
}

function lineStatusClass(s) {
  if (s === '生产中') return 'tagGreen'
  if (s === '空闲') return 'tagGray'
  if (s === '故障') return 'tagRed'
  return ''
}

onMounted(loadData)
</script>

<template>
  <div class="bg">
    <!-- 顶部欢迎条 -->
    <header class="welcome">
      <div class="welcome-brand">
        <span class="welcome-dot"></span>
        <span style="white-space:pre-line">{{ t('login.title') }}</span>
      </div>
      <div class="welcome-greet" style="white-space:pre-line">{{ t('entry.welcome.greet', null, { name: showName }) }}</div>
      <div class="welcome-right">
        <span class="welcome-date">{{ today }} {{ t('entry.weekdayPrefix') }}{{ weekday }}</span>
        <div class="welcome-status">
          <span class="status-dot" :style="{ background: serviceStatus.color }"></span>
          <span style="white-space:pre-line">{{ t(serviceStatus.labelKey) }}</span>
        </div>
        <!-- 语言切换 -->
        <div class="lang-switch-inline">
          <button :class="{ active: mode === 'zh' }" @click="setMode('zh')">中</button>
          <button :class="{ active: mode === 'km' }" @click="setMode('km')">ខ្មែរ</button>
          <button :class="{ active: mode === 'both' }" @click="setMode('both')">双</button>
        </div>
      </div>
    </header>

    <!-- 第一行:用户 + 两个可配置看板面板 -->
    <div class="row row-workbench">
      <!-- 用户卡片 -->
      <div class="wb-card wb-user-card" @click="go('userSettings')">
        <div class="user-avatar">
          <img v-if="auth.user?.avatar_url" :src="auth.user.avatar_url" class="user-avatar-img" />
          <span v-else>{{ (auth.user?.display_name || 'U').charAt(0) }}</span>
        </div>
        <div class="user-info">
          <div class="user-name" style="white-space:pre-line">{{ showName }}</div>
          <div class="user-role" style="white-space:pre-line">{{ roleLabel }}</div>
        </div>
      </div>

      <!-- 看板面板 1 -->
      <div class="wb-card wb-panel">
        <div class="panel-header" style="cursor:pointer" @click="go('dashboard')">
          <span class="panel-title" style="white-space:pre-line">{{ getLabel(panel1Key) }}</span>
          <div class="panel-settings-wrap">
            <button class="panel-settings-btn" @click.stop="openMenu = openMenu === 'panel1' ? null : 'panel1'" :title="t('entry.panelSettings.title')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <div v-if="openMenu === 'panel1'" class="panel-menu-overlay" @click.stop="onOverlayClick"></div>
            <div v-if="openMenu === 'panel1'" class="panel-menu">
              <div v-for="opt in chartOptions" :key="opt.key" class="panel-menu-item" :class="{ active: panel1Key === opt.key }" @click.stop="selectPanel('panel1', opt.key)">
                <span class="menu-icon">{{ opt.icon }}</span>
                <span style="white-space:pre-line">{{ t(opt.labelKey) }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="panel-body">
          <template v-if="panel1Key === 'processRate'">
            <v-chart v-if="processRateOption" :option="processRateOption" :autoresize="true" class="panel-chart" />
            <div v-else class="panel-empty" style="white-space:pre-line">{{ t('entry.loading') }}</div>
          </template>
          <template v-else-if="panel1Key === 'sewingWorkshop'">
            <v-chart v-if="sewingWorkshopOption" :option="sewingWorkshopOption" :autoresize="true" class="panel-chart" />
            <div v-else class="panel-empty" style="white-space:pre-line">{{ t('entry.loading') }}</div>
          </template>
          <template v-else-if="panel1Key === 'workshopPie'">
            <v-chart v-if="workshopPieOption" :option="workshopPieOption" :autoresize="true" class="panel-chart" />
            <div v-else class="panel-empty" style="white-space:pre-line">{{ t('entry.empty') }}</div>
          </template>
          <template v-else-if="panel1Key === 'kpiStats'">
            <div class="kpi-grid">
              <div v-for="k in kpiItems" :key="k.labelKey" class="kpi-item">
                <div class="kpi-icon" :style="{ background: k.bg, color: k.color }">
                  <span class="kpi-num">{{ k.value }}</span>
                </div>
                <div class="kpi-label" style="white-space:pre-line">{{ t(k.labelKey) }}</div>
              </div>
            </div>
          </template>
          <template v-else-if="panel1Key === 'recentPlans'">
            <div class="panel-table-wrap">
              <table class="panel-table">
                <thead><tr>
                  <th style="white-space:pre-line">{{ t('entry.col.styleNo') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.product') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.qty') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.dueDate') }}</th>
                </tr></thead>
                <tbody>
                  <tr v-for="p in recentPlans" :key="p.id">
                    <td class="fw500">{{ p.style_no }}</td>
                    <td class="muted">{{ p.product_name }}</td>
                    <td>{{ p.plan_qty?.toLocaleString() }}</td>
                    <td>{{ p.due_date || '-' }}</td>
                  </tr>
                  <tr v-if="!recentPlans.length"><td colspan="4" class="empty" style="white-space:pre-line">{{ t('entry.empty') }}</td></tr>
                </tbody>
              </table>
            </div>
          </template>
          <template v-else-if="panel1Key === 'lineStatus'">
            <div class="panel-table-wrap">
              <table class="panel-table">
                <thead><tr>
                  <th style="white-space:pre-line">{{ t('entry.col.line') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.workshop') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.status') }}</th>
                </tr></thead>
                <tbody>
                  <tr v-for="l in productionLines.slice(0, 10)" :key="l.id">
                    <td class="fw500">{{ l.line_name }}</td>
                    <td class="muted">{{ workshops.find(w => w.id === l.workshop_id)?.name || '-' }}</td>
                    <td>
                      <span class="tag" :class="lineStatusClass(l.status)">{{ lineStatusText(l.status) }}</span>
                    </td>
                  </tr>
                  <tr v-if="!productionLines.length"><td colspan="3" class="empty" style="white-space:pre-line">{{ t('entry.empty') }}</td></tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>

      <!-- 看板面板 2 -->
      <div class="wb-card wb-panel">
        <div class="panel-header" style="cursor:pointer" @click="go('dashboard')">
          <span class="panel-title" style="white-space:pre-line">{{ getLabel(panel2Key) }}</span>
          <div class="panel-settings-wrap">
            <button class="panel-settings-btn" @click.stop="openMenu = openMenu === 'panel2' ? null : 'panel2'" :title="t('entry.panelSettings.title')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <div v-if="openMenu === 'panel2'" class="panel-menu-overlay" @click.stop="onOverlayClick"></div>
            <div v-if="openMenu === 'panel2'" class="panel-menu">
              <div v-for="opt in chartOptions" :key="opt.key" class="panel-menu-item" :class="{ active: panel2Key === opt.key }" @click.stop="selectPanel('panel2', opt.key)">
                <span class="menu-icon">{{ opt.icon }}</span>
                <span style="white-space:pre-line">{{ t(opt.labelKey) }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="panel-body">
          <template v-if="panel2Key === 'processRate'">
            <v-chart v-if="processRateOption" :option="processRateOption" :autoresize="true" class="panel-chart" />
            <div v-else class="panel-empty" style="white-space:pre-line">{{ t('entry.loading') }}</div>
          </template>
          <template v-else-if="panel2Key === 'sewingWorkshop'">
            <v-chart v-if="sewingWorkshopOption" :option="sewingWorkshopOption" :autoresize="true" class="panel-chart" />
            <div v-else class="panel-empty" style="white-space:pre-line">{{ t('entry.loading') }}</div>
          </template>
          <template v-else-if="panel2Key === 'workshopPie'">
            <v-chart v-if="workshopPieOption" :option="workshopPieOption" :autoresize="true" class="panel-chart" />
            <div v-else class="panel-empty" style="white-space:pre-line">{{ t('entry.empty') }}</div>
          </template>
          <template v-else-if="panel2Key === 'kpiStats'">
            <div class="kpi-grid">
              <div v-for="k in kpiItems" :key="k.labelKey" class="kpi-item">
                <div class="kpi-icon" :style="{ background: k.bg, color: k.color }">
                  <span class="kpi-num">{{ k.value }}</span>
                </div>
                <div class="kpi-label" style="white-space:pre-line">{{ t(k.labelKey) }}</div>
              </div>
            </div>
          </template>
          <template v-else-if="panel2Key === 'recentPlans'">
            <div class="panel-table-wrap">
              <table class="panel-table">
                <thead><tr>
                  <th style="white-space:pre-line">{{ t('entry.col.styleNo') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.product') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.qty') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.dueDate') }}</th>
                </tr></thead>
                <tbody>
                  <tr v-for="p in recentPlans" :key="p.id">
                    <td class="fw500">{{ p.style_no }}</td>
                    <td class="muted">{{ p.product_name }}</td>
                    <td>{{ p.plan_qty?.toLocaleString() }}</td>
                    <td>{{ p.due_date || '-' }}</td>
                  </tr>
                  <tr v-if="!recentPlans.length"><td colspan="4" class="empty" style="white-space:pre-line">{{ t('entry.empty') }}</td></tr>
                </tbody>
              </table>
            </div>
          </template>
          <template v-else-if="panel2Key === 'lineStatus'">
            <div class="panel-table-wrap">
              <table class="panel-table">
                <thead><tr>
                  <th style="white-space:pre-line">{{ t('entry.col.line') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.workshop') }}</th>
                  <th style="white-space:pre-line">{{ t('entry.col.status') }}</th>
                </tr></thead>
                <tbody>
                  <tr v-for="l in productionLines.slice(0, 10)" :key="l.id">
                    <td class="fw500">{{ l.line_name }}</td>
                    <td class="muted">{{ workshops.find(w => w.id === l.workshop_id)?.name || '-' }}</td>
                    <td>
                      <span class="tag" :class="lineStatusClass(l.status)">{{ lineStatusText(l.status) }}</span>
                    </td>
                  </tr>
                  <tr v-if="!productionLines.length"><td colspan="3" class="empty" style="white-space:pre-line">{{ t('entry.empty') }}</td></tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 第二行:4 张模块卡 -->
    <div class="row row-modules">
      <div
        v-for="card in moduleCards"
        :key="card.key"
        class="mod-card"
        @click="go(card.key)"
      >
        <div class="mod-tag" :style="{ background: card.bg }">
          <span class="mod-tag-label" style="white-space: pre-line">{{ cardLabel(card) }}</span>
        </div>
        <div class="mod-body">
          <div class="mod-balance">
            <div class="balance-label" style="white-space:pre-line">{{ t('entry.summary') }}</div>
            <div class="balance-value">
              <span class="balance-num">{{ card.main }}</span>
              <span class="balance-unit" style="white-space:pre-line">{{ t(card.mainUnitKey) }}</span>
            </div>
          </div>
          <div class="mod-stats">
            <div class="m-stat">
              <div class="m-stat-label" style="white-space:pre-line">{{ t(card.labelAKey) }}</div>
              <div class="m-stat-value" :class="card.typeA">{{ card.valueA }}</div>
            </div>
            <div class="m-stat">
              <div class="m-stat-label" style="white-space:pre-line">{{ t(card.labelBKey) }}</div>
              <div class="m-stat-value" :class="card.typeB">{{ card.valueB }}</div>
            </div>
          </div>
          <div class="mod-progress">
            <div class="p-bar" :style="{ background: card.progColorA, width: card.progAW + '%' }"></div>
            <div class="p-bar" :style="{ background: card.progColorB, width: card.progBW + '%' }"></div>
          </div>
        </div>
        <button class="mod-fab">
          <span>↓</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }

.bg {
  height: 100vh;
  background: linear-gradient(180deg, #fafbff 0%, #f5f3ff 100%);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  flex-shrink: 0;
}
.welcome-brand { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #111827; }
.welcome-dot { width: 8px; height: 8px; border-radius: 50%; background: #6e3ff3; }
.welcome-greet { font-size: 14px; color: #374151; }
.welcome-right { display: flex; align-items: center; gap: 16px; }
.welcome-date { font-size: 13px; color: #6b7280; }
.welcome-status { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #22c55e; background: #f0fdf4; padding: 4px 12px; border-radius: 20px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; }

/* 入口页语言切换(嵌入顶栏) */
.lang-switch-inline { display: flex; gap: 2px; background: #f3f4f6; padding: 2px; border-radius: 8px; }
.lang-switch-inline button {
  border: 0; background: transparent; cursor: pointer;
  padding: 4px 10px; font-size: 12px; border-radius: 6px;
  color: #6b7280; transition: all .15s;
}
.lang-switch-inline button:hover { background: #fff; color: #111827; }
.lang-switch-inline button.active { background: #6e3ff3; color: #fff; font-weight: 600; }

/* 第一行 */
.row-workbench {
  display: grid;
  grid-template-columns: 280px 1fr 1fr;
  gap: 16px;
  height: 28vh;
  min-height: 220px;
  flex-shrink: 0;
}

.wb-card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.wb-user-card {
  padding: 24px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  transition: all .2s;
}
.wb-user-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.08); }
.user-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #6e3ff3, #8b5cf6); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 22px; font-weight: 700; flex-shrink: 0; overflow: hidden; }
.user-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.user-info { display: flex; flex-direction: column; gap: 4px; }
.user-name { font-size: 18px; font-weight: 700; color: #111827; line-height: 1.3; }
.user-role { font-size: 13px; color: #6b7280; line-height: 1.3; }

.wb-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
}
.panel-title { font-size: 14px; font-weight: 600; color: #111827; line-height: 1.3; }

.panel-settings-wrap { position: relative; }
.panel-settings-btn {
  width: 28px; height: 28px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #6b7280;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.panel-settings-btn:hover { background: #f3f0ff; color: #6e3ff3; border-color: #c4b5fd; }

.panel-menu-overlay { position: fixed; inset: 0; z-index: 99; }
.panel-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  padding: 6px;
  z-index: 100;
  min-width: 180px;
}
.panel-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
  transition: background .1s;
}
.panel-menu-item:hover { background: #f3f0ff; }
.panel-menu-item.active { background: #f3f0ff; color: #6e3ff3; font-weight: 600; }
.menu-icon { font-size: 14px; width: 20px; text-align: center; }

.panel-body {
  flex: 1;
  padding: 12px 16px 16px;
  min-height: 0;
  overflow: visible;
  position: relative;
}
.panel-chart { width: 100%; height: 100% !important; min-height: 140px; }
.panel-empty { display: flex; align-items: center; justify-content: center; height: 100%; min-height: 140px; color: #a1a1aa; font-size: 13px; }

.kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; height: 100%; }
.kpi-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px;
  background: #fafbff;
  border-radius: 14px;
  padding: 20px;
}
.kpi-icon {
  width: 52px; height: 52px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
}
.kpi-num { font-size: 22px; font-weight: 700; }
.kpi-label { font-size: 12px; color: #6b7280; font-weight: 500; line-height: 1.3; text-align: center; }

.panel-table-wrap { overflow: auto; height: 100%; }
.panel-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.panel-table th { text-align: left; padding: 6px 8px; font-weight: 600; color: #9ca3af; border-bottom: 1px solid #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
.panel-table td { padding: 8px; border-bottom: 1px solid #f9fafb; color: #374151; }
.fw500 { font-weight: 500; }
.muted { color: #9ca3af; }
.empty { text-align: center; color: #d1d5db; padding: 32px !important; }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
.tagGreen { background: #f0fdf4; color: #22c55e; }
.tagGray { background: #f3f4f6; color: #9ca3af; }
.tagRed { background: #fef2f2; color: #ef4444; }

.row-modules {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.mod-card {
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
  display: flex;
  flex-direction: column;
}
.mod-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .08);
}

.mod-tag {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
}
.mod-tag-label { font-size: 15px; font-weight: 600; line-height: 1.3; }

.mod-body {
  padding: 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mod-balance { display: flex; flex-direction: column; gap: 2px; }
.balance-label { font-size: 12px; color: #6b7280; }
.balance-value { display: flex; align-items: baseline; gap: 4px; }
.balance-num { font-size: 28px; font-weight: 700; color: #111827; }
.balance-unit { font-size: 14px; color: #6b7280; }

.mod-stats { display: flex; gap: 16px; }
.m-stat { display: flex; flex-direction: column; gap: 2px; }
.m-stat-label { font-size: 12px; color: #6b7280; line-height: 1.3; }
.m-stat-value { font-size: 16px; font-weight: 600; }
.m-stat-value.up { color: #22c55e; }
.m-stat-value.down { color: #ef4444; }

.mod-progress {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: #f3f4f6;
  margin-top: auto;
}
.p-bar { height: 100%; }

.mod-fab {
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,.4);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mod-fab:hover { transform: scale(1.08); }

@media (max-width: 1400px) {
  .row-modules { grid-template-columns: repeat(5, 1fr); }
}
@media (max-width: 1100px) {
  .row-workbench { grid-template-columns: 1fr 1fr; }
  .wb-user-card { grid-column: 1 / -1; }
  .row-modules { grid-template-columns: repeat(2, 1fr); }
}
</style>
