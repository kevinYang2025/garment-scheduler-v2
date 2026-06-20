<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { useI18n } from '../composables/useI18n'
import ActualEntryDialog from '../components/ActualEntryDialog.vue'
import ImportActualDialog from '../components/ImportActualDialog.vue'

const { t } = useI18n()

const props = defineProps({
  scheduleType: { type: String, default: '' },
  secondaryType: { type: String, default: '' },
  workshop: { type: String, default: '' },
})

// schedule_type → i18n key for table "类型" column
function typeLabel(s) {
  return s ? t('dispatchReport.type.' + s, null) : ''
}

// ---- 数据 ----
const reports = ref([])
const summary = ref({ totalCompleted: 0, totalDefects: 0, qualityRate: 0, alertCount: 0 })
const loading = ref(true)
const activeTab = ref('list')

// ---- 筛选 ----
const filters = ref({
  style_no: '',
  date_from: '',
  date_to: '',
})

// ---- 录入/编辑 ----
const showEntry = ref(false)
const editRecord = ref(null)
const showImport = ref(false)

// ---- 趋势图数据 ----
const trendData = ref([])
const trendLoading = ref(false)

// ---- 计划vs实际 ----
const planVsActual = ref([])
const pvaLoading = ref(false)

// ---- 预警 ----
const alerts = ref([])

// ---- 按产线统计 ----
const lineStats = ref([])
const lineLoading = ref(false)

// ---- 按车间统计 ----
const workshopStats = ref([])
const workshopLoading = ref(false)

// ---- 按工人统计 ----
const workerStats = ref([])
const workerLoading = ref(false)

// ---- 分页 ----
const currentPage = ref(1)
const pageSize = ref(50)
const pagedReports = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return reports.value.slice(start, start + pageSize.value)
})

// ---- 构建筛选参数 ----
function buildParams() {
  const params = {}
  if (props.scheduleType) params.schedule_type = props.scheduleType
  if (props.secondaryType) params.secondary_type = props.secondaryType
  if (props.workshop) params.workshop = props.workshop
  if (filters.value.style_no) params.style_no = filters.value.style_no
  if (filters.value.date_from) params.date_from = filters.value.date_from
  if (filters.value.date_to) params.date_to = filters.value.date_to
  return params
}

// ---- 加载报工列表 ----
async function loadReports() {
  loading.value = true
  try {
    const params = buildParams()
    const { data } = await api.getDispatchSummary(params)
    reports.value = data || []
    let totalCompleted = 0, totalDefects = 0
    for (const r of reports.value) {
      totalCompleted += r.total_completed || 0
      totalDefects += r.total_defects || 0
    }
    summary.value = {
      totalCompleted,
      totalDefects,
      qualityRate: totalCompleted + totalDefects > 0
        ? Math.round(totalCompleted * 100 / (totalCompleted + totalDefects) * 10) / 10
        : 0,
      alertCount: alerts.value.length,
    }
    currentPage.value = 1
  } catch {
    ElMessage.error(t('dispatchReport.toast.loadFail'))
  }
  loading.value = false
}

// ---- 加载预警 ----
async function loadAlerts() {
  try {
    const { data } = await api.getDispatchAlerts()
    alerts.value = data || []
    summary.value.alertCount = alerts.value.length
  } catch { /* ignore */ }
}

// ---- 加载趋势 ----
async function loadTrend() {
  trendLoading.value = true
  try {
    const params = buildParams()
    const { data } = await api.getDispatchDailyTrend(params)
    trendData.value = data || []
    renderTrendChart()
  } catch {
    ElMessage.error(t('dispatchReport.toast.trendFail'))
  }
  trendLoading.value = false
}

// ---- 渲染趋势图 ----
function renderTrendChart() {
  const el = document.getElementById('trend-chart')
  if (!el) return
  if (!window.echarts) {
    import('echarts').then(m => { window.echarts = m.default || m; doRenderTrend(el) })
  } else {
    doRenderTrend(el)
  }
}

let trendChart = null
function doRenderTrend(el) {
  if (trendChart) trendChart.dispose()
  trendChart = window.echarts.init(el)
  const dates = trendData.value.map(d => d.production_date)
  const completed = trendData.value.map(d => d.total_completed)
  const defects = trendData.value.map(d => d.total_defects)
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: [t('dispatchReport.chart.completed'), t('dispatchReport.chart.defects')], bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    series: [
      { name: t('dispatchReport.chart.completed'), type: 'line', data: completed, smooth: true, itemStyle: { color: '#3b82f6' }, areaStyle: { color: 'rgba(59,130,246,0.1)' } },
      { name: t('dispatchReport.chart.defects'), type: 'line', data: defects, smooth: true, itemStyle: { color: '#ef4444' } },
    ],
  })
}

// ---- 加载计划vs实际 ----
async function loadPlanVsActual() {
  pvaLoading.value = true
  try {
    const params = {}
    if (filters.value.date_from) params.date_from = filters.value.date_from
    if (filters.value.date_to) params.date_to = filters.value.date_to
    const { data } = await api.getDispatchPlanVsActual(params)
    planVsActual.value = data || []
    renderPvaChart()
  } catch {
    ElMessage.error(t('dispatchReport.toast.pvaFail'))
  }
  pvaLoading.value = false
}

function renderPvaChart() {
  const el = document.getElementById('pva-chart')
  if (!el) return
  if (!window.echarts) {
    import('echarts').then(m => { window.echarts = m.default || m; doRenderPva(el) })
  } else {
    doRenderPva(el)
  }
}

let pvaChart = null
function doRenderPva(el) {
  if (pvaChart) pvaChart.dispose()
  pvaChart = window.echarts.init(el)
  // x 轴 label: sewing 不带类型后缀(默认就是缝制), 其他类型显示本地化的类型名
  const labels = planVsActual.value.map(d => {
    const typeName = typeLabel(d.schedule_type)
    return d.style_no + (d.schedule_type === 'sewing' ? '' : `(${typeName})`)
  })
  const planQty = planVsActual.value.map(d => d.plan_qty)
  const actualQty = planVsActual.value.map(d => d.actual_total)
  pvaChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: [t('dispatchReport.chart.plan'), t('dispatchReport.chart.actual')], bottom: 0 },
    grid: { left: 80, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, rotate: 30 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    series: [
      { name: t('dispatchReport.chart.plan'), type: 'bar', data: planQty, itemStyle: { color: '#94a3b8' } },
      { name: t('dispatchReport.chart.actual'), type: 'bar', data: actualQty, itemStyle: { color: '#3b82f6' },
        label: { show: true, position: 'top', fontSize: 10, formatter: '{c}' } },
    ],
  })
}

// ---- 加载按产线统计 ----
async function loadLineStats() {
  lineLoading.value = true
  try {
    const params = buildParams()
    const { data } = await api.getDispatchByLine(params)
    lineStats.value = data || []
  } catch {
    ElMessage.error(t('dispatchReport.toast.lineFail'))
  }
  lineLoading.value = false
}

// ---- 加载按车间统计 ----
async function loadWorkshopStats() {
  workshopLoading.value = true
  try {
    const params = buildParams()
    const { data } = await api.getDispatchByWorkshop(params)
    workshopStats.value = data || []
    renderWorkshopChart()
  } catch {
    ElMessage.error(t('dispatchReport.toast.workshopFail'))
  }
  workshopLoading.value = false
}

function renderWorkshopChart() {
  const el = document.getElementById('workshop-chart')
  if (!el || workshopStats.value.length === 0) return
  if (!window.echarts) {
    import('echarts').then(m => { window.echarts = m.default || m; doRenderWorkshop(el) })
  } else {
    doRenderWorkshop(el)
  }
}

let workshopChart = null
function doRenderWorkshop(el) {
  if (workshopChart) workshopChart.dispose()
  workshopChart = window.echarts.init(el)
  const labels = workshopStats.value.map(d => d.workshop)
  const completed = workshopStats.value.map(d => d.total_completed)
  const defects = workshopStats.value.map(d => d.total_defects)
  workshopChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: [t('dispatchReport.chart.completed'), t('dispatchReport.chart.defects')], bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    series: [
      { name: t('dispatchReport.chart.completed'), type: 'bar', data: completed, itemStyle: { color: '#3b82f6' } },
      { name: t('dispatchReport.chart.defects'), type: 'bar', data: defects, itemStyle: { color: '#ef4444' } },
    ],
  })
}

// ---- 加载按工人统计 ----
async function loadWorkerStats() {
  workerLoading.value = true
  try {
    const params = buildParams()
    const { data } = await api.getDispatchByWorker(params)
    workerStats.value = data || []
  } catch {
    ElMessage.error(t('dispatchReport.toast.workerFail'))
  }
  workerLoading.value = false
}

// ---- 操作 ----
function handleFilter() {
  loadReports()
  if (activeTab.value === 'trend') loadTrend()
  if (activeTab.value === 'pva') loadPlanVsActual()
  if (activeTab.value === 'byLine') loadLineStats()
  if (activeTab.value === 'byWorkshop') loadWorkshopStats()
  if (activeTab.value === 'byWorker') loadWorkerStats()
}

function openAdd() {
  editRecord.value = null
  showEntry.value = true
}

function openEdit(row) {
  editRecord.value = { ...row }
  showEntry.value = true
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      t('dispatchReport.toast.confirmDel', null, { style: row.style_no, date: row.production_date }),
      t('dispatchReport.toast.confirmTitle'),
      { confirmButtonText: t('dispatchReport.btn.delete'), cancelButtonText: t('dispatchReport.btn.cancel'), type: 'warning' }
    )
    await api.deleteActual(row.id || row.record_id)
    ElMessage.success(t('secondaryDispatch.toast.deleteOk'))
    loadData()
  } catch { /* cancel */ }
}

function onSaved() {
  loadData()
}

function onImported() {
  loadData()
}

async function handleExport() {
  try {
    const params = buildParams()
    const { data } = await api.exportDispatchReport(params)
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = t('dispatchReport.export.filename')
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(t('dispatchReport.toast.exportOk'))
  } catch {
    ElMessage.error(t('dispatchReport.toast.exportFail'))
  }
}

function onTabChange(tab) {
  if (tab === 'trend') loadTrend()
  if (tab === 'pva') loadPlanVsActual()
  if (tab === 'byLine') loadLineStats()
  if (tab === 'byWorkshop') loadWorkshopStats()
  if (tab === 'byWorker') loadWorkerStats()
}

function loadData() {
  loadReports()
  loadAlerts()
}

function progressColor(row) {
  if (!row.plan_qty || row.plan_qty === 0) return ''
  const pct = (row.actual_total || 0) * 100 / row.plan_qty
  if (pct >= 100) return '#22c55e'
  if (pct >= 70) return '#3b82f6'
  if (pct >= 40) return '#eab308'
  return '#ef4444'
}

const pageTitle = computed(() => {
  if (props.secondaryType) {
    // 二次加工按类型显示: 印花/刺绣/模板/烫标报工
    const stKey = { '印花': 'printingDispatch', '刺绣': 'embroideryDispatch', '模板': 'templateDispatch', '烫标': 'ironingDispatch' }[props.secondaryType]
    return stKey ? t('nav.' + stKey) : t('nav.secondary')
  }
  if (props.workshop) return t('dispatchReport.title.sewingWithWs', null, { ws: props.workshop })
  if (props.scheduleType === 'sewing') return t('dispatchReport.title.sewing')
  if (props.scheduleType === 'cutting') return t('dispatchReport.title.cutting')
  return t('dispatchReport.title.secondary')
})

const pageDesc = computed(() => {
  if (props.workshop) return t('dispatchReport.desc.wsData', null, { ws: props.workshop })
  if (props.secondaryType) return t('dispatchReport.desc.wsData', null, { ws: props.secondaryType })
  if (props.scheduleType === 'sewing') return t('dispatchReport.desc.sewingWs')
  if (props.scheduleType === 'cutting') return t('dispatchReport.desc.cuttingWs')
  if (props.scheduleType === 'secondary') return t('dispatchReport.desc.general')
  return t('dispatchReport.desc.general')
})

onMounted(loadData)
</script>

<template>
  <div class="dispatch-page">
    <div class="page-header-bar">
      <div>
        <h2 class="page-heading">{{ pageTitle }}</h2>
        <p class="page-desc">{{ pageDesc }}</p>
      </div>
      <div class="header-actions">
        <el-button @click="openAdd" type="primary" size="large" class="btn-add-record"><span style="white-space:pre-line">{{ t('dispatchReport.btn.add') }}</span></el-button>
        <el-button @click="showImport = true" size="default"><span style="white-space:pre-line">{{ t('dispatchReport.btn.import') }}</span></el-button>
        <el-button @click="handleExport" size="default"><span style="white-space:pre-line">{{ t('dispatchReport.btn.export') }}</span></el-button>
      </div>
    </div>

    <!-- 汇总卡片 -->
    <div class="summary-cards">
      <div class="summary-card">
        <div class="card-value">{{ summary.totalCompleted.toLocaleString() }}</div>
        <div class="card-label" style="white-space:pre-line">{{ t('dispatchReport.summary.totalCompleted') }}</div>
      </div>
      <div class="summary-card">
        <div class="card-value" style="color:#ef4444">{{ summary.totalDefects.toLocaleString() }}</div>
        <div class="card-label" style="white-space:pre-line">{{ t('dispatchReport.summary.totalDefects') }}</div>
      </div>
      <div class="summary-card">
        <div class="card-value" style="color:#22c55e">{{ summary.qualityRate }}%</div>
        <div class="card-label" style="white-space:pre-line">{{ t('dispatchReport.summary.qualityRate') }}</div>
      </div>
      <div class="summary-card" :class="{ 'alert-card': summary.alertCount > 0 }">
        <div class="card-value" :style="{ color: summary.alertCount > 0 ? '#ef4444' : '' }">{{ summary.alertCount }}</div>
        <div class="card-label" style="white-space:pre-line">{{ t('dispatchReport.summary.alert') }}</div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input v-model="filters.style_no" :placeholder="t('dispatchReport.filter.styleNoPh')" clearable style="width:150px" @change="handleFilter" />
      <el-date-picker v-model="filters.date_from" type="date" :placeholder="t('dispatchReport.filter.startPh')" value-format="YYYY-MM-DD" style="width:130px" @change="handleFilter" />
      <el-date-picker v-model="filters.date_to" type="date" :placeholder="t('dispatchReport.filter.endPh')" value-format="YYYY-MM-DD" style="width:130px" @change="handleFilter" />
      <el-button @click="loadData" :icon="'Refresh'" circle />
    </div>

    <!-- Tab 切换 -->
    <el-tabs v-model="activeTab" @tab-change="onTabChange" style="margin-bottom: 12px">
      <el-tab-pane :label="t('dispatchReport.tabs.list')" name="list" />
      <el-tab-pane :label="t('dispatchReport.tabs.byLine')" name="byLine" />
      <el-tab-pane :label="t('dispatchReport.tabs.byWorkshop')" name="byWorkshop" />
      <el-tab-pane :label="t('dispatchReport.tabs.byWorker')" name="byWorker" />
      <el-tab-pane :label="t('dispatchReport.tabs.trend')" name="trend" />
      <el-tab-pane :label="t('dispatchReport.tabs.pva')" name="pva" />
    </el-tabs>

    <!-- 报工列表 -->
    <div v-if="activeTab === 'list'">
      <el-table :data="pagedReports" v-loading="loading" stripe size="small" style="width:100%">
        <el-table-column prop="production_date" :label="t('dispatchReport.cols.date')" width="110" />
        <el-table-column prop="style_no" :label="t('dispatchReport.cols.styleNo')" min-width="120" show-overflow-tooltip />
        <el-table-column prop="workshop" :label="t('dispatchReport.cols.workshop')" width="80" />
        <el-table-column prop="line_team" :label="t('dispatchReport.cols.team')" width="80" />
        <el-table-column prop="total_completed" :label="t('dispatchReport.cols.completed')" width="90" align="right">
          <template #default="{ row }">
            <span style="font-weight:600">{{ row.total_completed?.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="total_defects" :label="t('dispatchReport.cols.defects')" width="80" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.total_defects > 0 ? '#ef4444' : '' }">{{ row.total_defects }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="quality_rate" :label="t('dispatchReport.cols.qualityRate')" width="90" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.quality_rate >= 95 ? '#22c55e' : row.quality_rate >= 90 ? '#eab308' : '#ef4444', fontWeight: 600 }">
              {{ row.quality_rate }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('dispatchReport.cols.action')" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)"><span style="white-space:pre-line">{{ t('dispatchReport.btn.edit') }}</span></el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)"><span style="white-space:pre-line">{{ t('dispatchReport.btn.delete') }}</span></el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-bar" v-if="reports.length > pageSize">
        <el-pagination
          background
          layout="prev, pager, next"
          :total="reports.length"
          :page-size="pageSize"
          :current-page="currentPage"
          @current-change="currentPage = $event"
        />
      </div>
    </div>

    <!-- 按产线统计 -->
    <div v-if="activeTab === 'byLine'">
      <el-table :data="lineStats" v-loading="lineLoading" stripe size="small" style="width:100%">
        <el-table-column prop="workshop" :label="t('dispatchReport.cols.workshop')" width="100" />
        <el-table-column prop="line_team" :label="t('dispatchReport.cols.line')" width="100" />
        <el-table-column prop="total_completed" :label="t('dispatchReport.cols.completed')" width="100" align="right" sortable>
          <template #default="{ row }">
            <span style="font-weight:600">{{ row.total_completed?.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="total_defects" :label="t('dispatchReport.cols.defects')" width="80" align="right" sortable>
          <template #default="{ row }">
            <span :style="{ color: row.total_defects > 0 ? '#ef4444' : '' }">{{ row.total_defects }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="quality_rate" :label="t('dispatchReport.cols.qualityRate')" width="90" align="right" sortable>
          <template #default="{ row }">
            <span :style="{ color: row.quality_rate >= 95 ? '#22c55e' : row.quality_rate >= 90 ? '#eab308' : '#ef4444', fontWeight: 600 }">
              {{ row.quality_rate }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="record_count" :label="t('dispatchReport.cols.recordCount')" width="90" align="right" />
      </el-table>
      <div v-if="!lineLoading && lineStats.length === 0" class="empty-state" style="white-space:pre-line">{{ t('dispatchReport.empty.line') }}</div>
    </div>

    <!-- 按车间统计 -->
    <div v-if="activeTab === 'byWorkshop'">
      <div v-loading="workshopLoading" id="workshop-chart" style="width:100%; height:350px"></div>
      <el-table v-if="workshopStats.length > 0" :data="workshopStats" v-loading="workshopLoading" stripe size="small" style="width:100%; margin-top:16px">
        <el-table-column prop="workshop" :label="t('dispatchReport.cols.workshop')" width="120" />
        <el-table-column prop="total_completed" :label="t('dispatchReport.cols.completed')" width="100" align="right" sortable>
          <template #default="{ row }">
            <span style="font-weight:600">{{ row.total_completed?.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="total_defects" :label="t('dispatchReport.cols.defects')" width="80" align="right" sortable>
          <template #default="{ row }">
            <span :style="{ color: row.total_defects > 0 ? '#ef4444' : '' }">{{ row.total_defects }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="quality_rate" :label="t('dispatchReport.cols.qualityRate')" width="90" align="right" sortable>
          <template #default="{ row }">
            <span :style="{ color: row.quality_rate >= 95 ? '#22c55e' : row.quality_rate >= 90 ? '#eab308' : '#ef4444', fontWeight: 600 }">
              {{ row.quality_rate }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="record_count" :label="t('dispatchReport.cols.recordCount')" width="90" align="right" />
      </el-table>
      <div v-if="!workshopLoading && workshopStats.length === 0" class="empty-state" style="white-space:pre-line">{{ t('dispatchReport.empty.workshop') }}</div>
    </div>

    <!-- 按工人统计 -->
    <div v-if="activeTab === 'byWorker'">
      <el-table :data="workerStats" v-loading="workerLoading" stripe size="small" style="width:100%">
        <el-table-column prop="worker_name" :label="t('dispatchReport.cols.worker')" width="120" />
        <el-table-column prop="workshop" :label="t('dispatchReport.cols.workshop')" width="100" />
        <el-table-column prop="line_team" :label="t('dispatchReport.cols.line')" width="100" />
        <el-table-column prop="total_completed" :label="t('dispatchReport.cols.completed')" width="100" align="right" sortable>
          <template #default="{ row }">
            <span style="font-weight:600">{{ row.total_completed?.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="total_defects" :label="t('dispatchReport.cols.defects')" width="80" align="right" sortable>
          <template #default="{ row }">
            <span :style="{ color: row.total_defects > 0 ? '#ef4444' : '' }">{{ row.total_defects }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="quality_rate" :label="t('dispatchReport.cols.qualityRate')" width="90" align="right" sortable>
          <template #default="{ row }">
            <span :style="{ color: row.quality_rate >= 95 ? '#22c55e' : row.quality_rate >= 90 ? '#eab308' : '#ef4444', fontWeight: 600 }">
              {{ row.quality_rate }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="record_count" :label="t('dispatchReport.cols.recordCount')" width="90" align="right" />
      </el-table>
      <div v-if="!workerLoading && workerStats.length === 0" class="empty-state" style="white-space:pre-line">{{ t('dispatchReport.empty.worker') }}</div>
    </div>

    <!-- 趋势分析 -->
    <div v-if="activeTab === 'trend'">
      <div v-loading="trendLoading" id="trend-chart" style="width:100%; height:400px"></div>
      <div v-if="!trendLoading && trendData.length === 0" class="empty-state" style="white-space:pre-line">{{ t('dispatchReport.empty.trend') }}</div>
    </div>

    <!-- 计划 vs 实际 -->
    <div v-if="activeTab === 'pva'">
      <div v-loading="pvaLoading" id="pva-chart" style="width:100%; height:400px"></div>
      <div v-if="!pvaLoading && planVsActual.length === 0" class="empty-state" style="white-space:pre-line">{{ t('dispatchReport.empty.pva') }}</div>
      <el-table v-if="planVsActual.length > 0" :data="planVsActual" size="small" stripe style="width:100%; margin-top:16px">
        <el-table-column prop="style_no" :label="t('dispatchReport.cols.styleNo')" min-width="120" />
        <el-table-column prop="schedule_type" :label="t('dispatchReport.cols.type')" width="80">
          <template #default="{ row }">
            {{ typeLabel(row.schedule_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="plan_qty" :label="t('dispatchReport.cols.planQty')" width="90" align="right" />
        <el-table-column prop="actual_total" :label="t('dispatchReport.cols.actualQty')" width="90" align="right">
          <template #default="{ row }">
            <span style="font-weight:600">{{ row.actual_total?.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('dispatchReport.cols.progress')" width="160">
          <template #default="{ row }">
            <div style="display:flex; align-items:center; gap:6px">
              <el-progress
                :percentage="row.progress_pct || 0"
                :color="progressColor(row)"
                :stroke-width="12"
                style="flex:1"
              />
              <span style="font-size:12px; color:var(--text-secondary); min-width:36px">{{ row.progress_pct || 0 }}%</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 滞后款预警列表 -->
    <div v-if="activeTab === 'list' && alerts.length > 0" style="margin-top: 20px">
      <h3 style="font-size:15px; font-weight:600; color:#ef4444; margin-bottom:10px; white-space:pre-line">
        {{ t('dispatchReport.alert.title', null, { count: alerts.length }) }}
      </h3>
      <el-table :data="alerts" size="small" stripe style="width:100%" :row-style="{ background: '#fef2f2' }">
        <el-table-column prop="style_no" :label="t('dispatchReport.cols.styleNo')" min-width="120" />
        <el-table-column prop="schedule_type" :label="t('dispatchReport.cols.type')" width="80">
          <template #default="{ row }">
            {{ typeLabel(row.schedule_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="plan_qty" :label="t('dispatchReport.cols.planQty')" width="90" align="right" />
        <el-table-column prop="actual_total" :label="t('dispatchReport.cols.actualQty')" width="90" align="right" />
        <el-table-column prop="progress_pct" :label="t('dispatchReport.cols.progress')" width="80" align="right">
          <template #default="{ row }">
            <span style="color:#ef4444; font-weight:600">{{ row.progress_pct }}%</span>
          </template>
        </el-table-column>
        <el-table-column prop="plan_end" :label="t('dispatchReport.cols.planEnd')" width="110" />
      </el-table>
    </div>

    <!-- 录入/编辑对话框 -->
    <ActualEntryDialog
      v-model="showEntry"
      :edit-record="editRecord"
      :schedule-type="scheduleType"
      :secondary-type="secondaryType"
      :workshop="workshop"
      @saved="onSaved"
    />

    <!-- 批量导入对话框 -->
    <ImportActualDialog
      v-model="showImport"
      :schedule-type="scheduleType"
      :secondary-type="secondaryType"
      :workshop="workshop"
      @imported="onImported"
    />
  </div>
</template>

<style scoped>
.dispatch-page { max-width: 1200px; }
.page-header-bar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.page-heading { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.page-desc { font-size: 13px; color: var(--text-secondary); }
.header-actions { display: flex; gap: 8px; align-items: center; }
.btn-add-record {
  font-size: 16px !important;
  padding: 12px 28px !important;
  font-weight: 700 !important;
  border-radius: var(--radius) !important;
  box-shadow: 0 4px 12px rgba(124,58,237,0.3) !important;
}
.btn-add-record:hover {
  box-shadow: 0 6px 20px rgba(124,58,237,0.4) !important;
  transform: translateY(-1px);
}

.summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
.summary-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
}
.summary-card.alert-card { border-color: #fca5a5; background: #fef2f2; }
.card-value { font-size: 28px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.card-label { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }

.filter-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }

.pagination-bar { margin-top: 16px; display: flex; justify-content: center; }

.empty-state {
  text-align: center;
  padding: 60px 0;
  color: var(--text-tertiary);
  font-size: 14px;
}
</style>
