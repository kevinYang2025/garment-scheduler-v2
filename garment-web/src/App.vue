<script setup>
import { ref, computed, watch } from 'vue'
import { useWebSocket } from './composables/useWebSocket'
import api from './api'
import Dashboard from './views/Dashboard.vue'
import Styles from './views/Styles.vue'
import MainPlan from './views/MainPlan.vue'
import ScheduleView from './views/ScheduleView.vue'
import WarehouseHome from './views/WarehouseHome.vue'
import WarehouseDetail from './views/WarehouseDetail.vue'
import SecondaryHome from './views/SecondaryHome.vue'
import SecondaryDetail from './views/SecondaryDetail.vue'
import SewingHome from './views/SewingHome.vue'
import SewingPlanDetail from './views/SewingPlanDetail.vue'
import CapacityConfig from './views/CapacityConfig.vue'
import VisualSchedule from './views/VisualSchedule.vue'
import OperationLogs from './views/OperationLogs.vue'
import WorkCalendar from './views/WorkCalendar.vue'
import DispatchReport from './views/DispatchReport.vue'
import DeliveryEstimation from './views/DeliveryEstimation.vue'
import ShippingPlan from './views/ShippingPlan.vue'
import SchedulingStrategy from './views/SchedulingStrategy.vue'
import FabricLoadingList from './views/FabricLoadingList.vue'
import SewingWorkshopManage from './views/SewingWorkshopManage.vue'
import EntryHome from './views/EntryHome.vue'
import BasicDataHome from './views/BasicDataHome.vue'

const { DB, connected, onlineUsers } = useWebSocket()
const currentModule = ref('home')
const currentGroup = ref(null) // 当前所在的导航组
const warehouseActiveType = ref('')
const secondaryActiveType = ref('')
const sewingActiveType = ref('')
const prefetchedStyles = ref(null)
const sidebarCollapsed = ref(false)

const _d = new Date()
const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`

// Preload styles data when DB is ready
watch(() => DB.value, async (db) => {
  if (db && !prefetchedStyles.value) {
    try {
      const { data } = await api.getStyles('')
      prefetchedStyles.value = data
    } catch { /* ignore */ }
  }
}, { immediate: true })

const navSections = [
  {
    label: '工作台',
    items: [
      { key: 'dashboard', label: '数据看板', icon: 'grid' },
    ]
  },
  {
    label: '基础数据',
    items: [
      { key: 'basicData', label: '基础数据总览', icon: 'grid' },
      { key: 'styles', label: '款式管理', icon: 'tag' },
      { key: 'fabricList', label: '面料装柜清单', icon: 'list' },
      { key: 'sewingWorkshop', label: '缝制车间管理', icon: 'factory' },
      { key: 'styleColorSize', label: '分色分尺码', icon: 'ruler' },
    ]
  },
  {
    label: '计划管理',
    items: [
      { key: 'mainPlan', label: '主计划', icon: 'calendar' },
      { key: 'sewing', label: '缝制排程', icon: 'scissors' },
      { key: 'secondary', label: '二次加工', icon: 'palette' },
      { key: 'cutting', label: '裁剪排程', icon: 'cut' },
    ]
  },
  {
    label: '仓库管理',
    items: [
      { key: 'warehouse', label: '仓库管理', icon: 'package' },
    ]
  },
  {
    label: '报工管理',
    items: [
      { key: 'dispatch', label: '报工汇总', icon: 'data-analysis' },
      { key: 'estimation', label: '交期预估', icon: 'timer' },
      { key: 'shipping', label: '出货计划', icon: 'van' },
    ]
  },
  {
    label: '设置',
    items: [
      { key: 'config', label: '系统设置', icon: 'settings' },
      { key: 'work-calendar', label: '工作日历', icon: 'calendar' },
      { key: 'strategy', label: '排产策略', icon: 'magic-stick' },
      { key: 'logs', label: '操作日志', icon: 'list' },
    ]
  },
]


const allNavItems = navSections.flatMap(s => s.items)
const pageTitle = computed(() => {
  if (currentModule.value === 'home') return '工作台'
  const item = allNavItems.find(m => m.key === currentModule.value)
  return item ? item.label : ''
})

const breadcrumb = computed(() => {
  if (currentModule.value === 'home') return []
  const crumbs = [{ label: '工作台', key: 'home' }]
  const item = allNavItems.find(m => m.key === currentModule.value)
  if (item) crumbs.push({ label: item.label, key: item.key })
  if (currentModule.value === 'warehouse' && warehouseActiveType.value) {
    const typeNames = { raw_material: '面料库', auxiliary: '辅料库', cutting_piece: '裁片库', finished: '成品库' }
    crumbs.push({ label: typeNames[warehouseActiveType.value] || '' })
  }
  if (currentModule.value === 'secondary' && secondaryActiveType.value) {
    const typeNames = { printing: '印花排程', embroidery: '刺绣排程', template: '模板排程', ironing: '烫标排程' }
    crumbs.push({ label: typeNames[secondaryActiveType.value] || '' })
  }
  if (currentModule.value === 'sewing' && sewingActiveType.value) {
    const typeNames = { plan: '班组缝制计划', visual: '目视化班组排程' }
    crumbs.push({ label: typeNames[sewingActiveType.value] || '' })
  }
  return crumbs
})

function enterModule(key) {
  // 找到该模块所属的组
  const group = navSections.find(g => g.items.some(item => item.key === key))
  currentGroup.value = group || null
  currentModule.value = key
  if (key === 'warehouse') warehouseActiveType.value = ''
  if (key === 'secondary') secondaryActiveType.value = ''
  if (key === 'sewing') sewingActiveType.value = ''
}

function goHome() {
  currentModule.value = 'home'
  currentGroup.value = null
  warehouseActiveType.value = ''
  secondaryActiveType.value = ''
  sewingActiveType.value = ''
}

function enterWarehouse(type) {
  warehouseActiveType.value = type
}

function backToWarehouseHome() {
  warehouseActiveType.value = ''
}

function enterSecondaryDetail(type) {
  secondaryActiveType.value = type
}

function backToSecondaryHome() {
  secondaryActiveType.value = ''
}

function enterSewingDetail(type) {
  sewingActiveType.value = type
}

function backToSewingHome() {
  sewingActiveType.value = ''
}



function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function getIcon(name) {
  const icons = {
    grid: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
    tag: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
    list: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
    ruler: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>`,
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`,
    scissors: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>`,
    palette: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    cut: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>`,
    package: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/></svg>`,
    factory: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8L8 13V8L2 12Z"/><path d="M11 7H4"/><path d="M13 7H8"/><path d="M16 7h-2"/></svg>`,
    settings: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
    chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    panelLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>`,
    arrowLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  }
  return icons[name] || ''
}
</script>

<template>
  <div class="app-layout" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'entry-mode': currentModule === 'home' }">
    <!-- Sidebar (入口页面隐藏) -->
    <aside v-if="currentModule !== 'home'" class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <div class="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
          </div>
          <span class="logo-text">EUC 排程系统</span>
        </div>
      </div>

      <div class="sidebar-content">
        <!-- Workspace card -->
        <div class="workspace-card">
          <div class="workspace-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          </div>
          <div class="workspace-info">
            <span class="workspace-name">服装工厂</span>
            <div class="workspace-meta">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>{{ onlineUsers.length || 1 }} 人在线</span>
            </div>
          </div>
        </div>

        <!-- 返回首页按钮 -->
        <div class="back-to-home" @click="goHome">
          <span v-html="getIcon('arrowLeft')"></span>
          <span>返回首页</span>
        </div>

        <!-- Navigation (只显示当前模块组) -->
        <nav class="sidebar-nav">
          <div v-if="currentGroup" class="nav-section">
            <div class="nav-section-label">{{ currentGroup.label }}</div>
            <div
              v-for="item in currentGroup.items"
              :key="item.key"
              class="nav-item"
              :class="{ active: currentModule === item.key }"
              :data-label="item.label"
              @click="enterModule(item.key)"
            >
              <span class="nav-icon" v-html="getIcon(item.icon)"></span>
              <span class="nav-label">{{ item.label }}</span>
              <span v-if="currentModule === item.key" class="nav-arrow" v-html="getIcon('chevronRight')"></span>
            </div>
          </div>
        </nav>
      </div>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar">YC</div>
          <div class="user-info">
            <span class="user-name">YC</span>
            <span class="user-email">admin@euc.com</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main area -->
    <div class="main-area">
      <!-- Header (入口页面隐藏) -->
      <header v-if="currentModule !== 'home'" class="app-header">
        <div class="header-left">
          <button class="sidebar-toggle" @click="toggleSidebar" v-html="getIcon('panelLeft')"></button>
          <h1 class="header-title">{{ pageTitle }}</h1>
          <div v-if="breadcrumb.length > 1" class="breadcrumb">
            <span v-for="(crumb, i) in breadcrumb" :key="i" class="breadcrumb-item">
              <span v-if="i > 0" class="breadcrumb-sep">/</span>
              <span
                class="breadcrumb-label"
                :class="{ clickable: crumb.key }"
                @click="crumb.key && enterModule(crumb.key)"
              >{{ crumb.label }}</span>
            </span>
          </div>
        </div>
        <div class="header-right">
          <div class="status-chip" :class="connected ? 'online' : 'offline'">
            <span class="status-dot"></span>
            {{ connected ? '已连接' : '未连接' }}
          </div>
          <span class="header-date">{{ today }}</span>
        </div>
      </header>

      <!-- Content -->
      <main class="main-content">
        <KeepAlive :max="8">
          <!-- 入口页面 -->
          <EntryHome v-if="currentModule === 'home' && DB" key="home" @navigate="enterModule" />

          <!-- 基础数据入口 -->
          <BasicDataHome v-else-if="currentModule === 'basicData' && DB" key="basicData" @navigate="enterModule" />

          <!-- 工作台 / 数据看板 -->
          <div v-else-if="currentModule === 'dashboard' && DB" key="dashboard">
            <Dashboard :db="DB" @navigate="enterModule" />
          </div>

          <Styles v-else-if="currentModule === 'styles' && DB" :db="DB" :initial-data="prefetchedStyles" key="styles" />

          <FabricLoadingList v-else-if="currentModule === 'fabricList'" key="fabricList" />

          <SewingWorkshopManage v-else-if="currentModule === 'sewingWorkshop'" key="sewingWorkshop" />

          <div v-else-if="currentModule === 'styleColorSize' && DB" class="placeholder-page" key="styleColorSize">
            <div class="page-header-bar">
              <h2 class="page-heading">款式分色分尺码清单</h2>
              <p class="page-desc">分色分尺码数量明细</p>
            </div>
            <div class="empty-state">
              <div class="empty-icon">📐</div>
              <p>功能开发中...</p>
            </div>
          </div>

          <MainPlan v-else-if="currentModule === 'mainPlan' && DB" :db="DB" key="mainPlan" />
          <ScheduleView v-else-if="currentModule === 'cutting' && DB" schedule-type="cutting" :db="DB" key="cutting" />
          <SecondaryHome v-else-if="currentModule === 'secondary' && !secondaryActiveType && DB" @enter="enterSecondaryDetail" @back="goHome" key="secondaryHome" />
          <SecondaryDetail v-else-if="currentModule === 'secondary' && secondaryActiveType && DB" :secondary-type="secondaryActiveType" :db="DB" @back="backToSecondaryHome" key="secondaryDetail" />
          <SewingHome v-else-if="currentModule === 'sewing' && !sewingActiveType && DB" @enter="enterSewingDetail" @back="goHome" key="sewingHome" />
          <SewingPlanDetail v-else-if="currentModule === 'sewing' && sewingActiveType === 'plan' && DB" @back="backToSewingHome" key="sewingPlan" />
          <VisualSchedule v-else-if="currentModule === 'sewing' && sewingActiveType === 'visual' && DB" :db="DB" @back="backToSewingHome" key="visualSchedule" />
          <WarehouseHome v-else-if="currentModule === 'warehouse' && !warehouseActiveType && DB" @enter="enterWarehouse" @exit="goHome" key="warehouseHome" />
          <WarehouseDetail v-else-if="currentModule === 'warehouse' && warehouseActiveType && DB" :warehouse-type="warehouseActiveType" @back="backToWarehouseHome" key="warehouseDetail" />
          <CapacityConfig v-else-if="currentModule === 'config' && DB" :db="DB" key="capacityConfig" />
          <OperationLogs v-else-if="currentModule === 'logs' && DB" key="logs" />
          <WorkCalendar v-else-if="currentModule === 'work-calendar' && DB" key="workCalendar" />
          <DispatchReport v-else-if="currentModule === 'dispatch' && DB" key="dispatch" />
          <DeliveryEstimation v-else-if="currentModule === 'estimation' && DB" key="estimation" />
          <ShippingPlan v-else-if="currentModule === 'shipping' && DB" key="shipping" />
          <SchedulingStrategy v-else-if="currentModule === 'strategy' && DB" key="strategy" />
        </KeepAlive>

        <div v-if="!DB" class="loading-state">
          <div class="loading-spinner"></div>
          <p>连接服务器中...</p>
        </div>
      </main>
    </div>
  </div>
</template>

<style>
:root {
  /* Dashboard 2 (Cliento CRM) 色彩方案 */
  --primary: #6e3ff3;
  --primary-hover: #5a2ee0;
  --primary-light: #f3f0ff;
  --primary-dark: #4c1d95;
  --success: #22c55e;
  --success-light: #f0fdf4;
  --warning: #eab308;
  --warning-light: #fefce8;
  --danger: #ef4444;
  --danger-light: #fef2f2;
  --bg: #f8f9fb;
  --card: #ffffff;
  --text: #111827;
  --text-secondary: #6b7280;
  --text-tertiary: #a1a1aa;
  --border: #e5e7eb;
  --border-light: #f3f4f6;
  --border-hover: #d1d5db;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,.08);
  --radius: 12px;
  --radius-sm: 8px;
  --radius-pill: 9999px;
  --transition: all .15s ease;
  --sidebar-width: 260px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  line-height: 1.5;
}

/* ===== Layout ===== */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ===== Sidebar ===== */
.sidebar {
  width: var(--sidebar-width);
  background: var(--card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width .2s ease;
  overflow: hidden;
}
.sidebar-collapsed .sidebar {
  width: 64px;
  overflow: visible;
}
.sidebar-collapsed .sidebar-header,
.sidebar-collapsed .sidebar-footer {
  overflow: hidden;
}
.sidebar-collapsed .sidebar-content {
  overflow: visible;
}
.sidebar-collapsed .logo-text,
.sidebar-collapsed .workspace-card,
.sidebar-collapsed .nav-section-label,
.sidebar-collapsed .nav-label,
.sidebar-collapsed .nav-arrow,
.sidebar-collapsed .user-info,
.sidebar-collapsed .nav-item .nav-icon + .nav-label {
  display: none;
}
.sidebar-collapsed .nav-item {
  justify-content: center;
  padding: 8px 0;
  position: relative;
}
.sidebar-collapsed .nav-item::after {
  content: attr(data-label);
  position: absolute;
  left: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
  padding: 5px 10px;
  background: var(--text);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  border-radius: 6px;
  pointer-events: none;
  opacity: 0;
  transition: opacity .15s ease;
  z-index: 100;
}
.sidebar-collapsed .nav-item:hover::after {
  opacity: 1;
}
.sidebar-collapsed .sidebar-nav {
  gap: 4px;
}
.sidebar-collapsed .sidebar-user {
  justify-content: center;
}

.sidebar-header {
  padding: 16px 20px 12px;
  flex-shrink: 0;
}
.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #6e3ff3, #aa8ef9);
  color: white;
  flex-shrink: 0;
}
.logo-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -.3px;
  white-space: nowrap;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}
.sidebar-content::-webkit-scrollbar { width: 4px; }
.sidebar-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

.back-to-home {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: var(--transition);
}
.back-to-home:hover {
  background: var(--primary-light);
  color: var(--primary);
}

.entry-mode .main-area {
  margin-left: 0;
}

.workspace-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--card);
}
.workspace-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--primary-light);
  color: var(--primary);
  flex-shrink: 0;
}
.workspace-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.workspace-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.workspace-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-section {
  margin-bottom: 8px;
}
.nav-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: .5px;
  padding: 8px 12px 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  position: relative;
}
.nav-item:hover {
  background: var(--primary-light);
  color: var(--text);
}
.nav-item.active {
  background: var(--primary-light);
  color: var(--primary);
}
.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}
.nav-item.active .nav-icon {
  color: var(--primary);
}
.nav-label {
  flex: 1;
  white-space: nowrap;
}
.nav-arrow {
  color: var(--text-tertiary);
  opacity: .6;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-top: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition);
}
.sidebar-user:hover {
  background: var(--primary-light);
}
.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6e3ff3, #aa8ef9);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.user-email {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== Main area ===== */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* ===== Header ===== */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 10;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-secondary);
  transition: var(--transition);
  flex-shrink: 0;
}
.sidebar-toggle:hover {
  background: var(--primary-light);
  color: var(--text);
}
.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.breadcrumb-sep {
  margin: 0 6px;
}
.breadcrumb-label.clickable {
  cursor: pointer;
  color: var(--text-secondary);
}
.breadcrumb-label.clickable:hover {
  color: var(--primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.status-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--border);
}
.status-chip.online { background: var(--card); color: var(--text-secondary); }
.status-chip.offline { background: var(--danger-light); color: var(--danger); border-color: var(--danger); }
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.status-chip.online .status-dot { background: var(--success); }
.status-chip.offline .status-dot { background: var(--danger); }
.header-date {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ===== Main content ===== */
.main-content {
  flex: 1;
  overflow: auto;
  padding: 24px;
  background: var(--bg);
}
.main-content::-webkit-scrollbar { width: 6px; }
.main-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 6px; }

/* ===== Page header bar ===== */
.page-header-bar {
  margin-bottom: 24px;
}
.page-heading {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}
.page-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ===== Placeholder pages ===== */
.placeholder-page { }
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--text-tertiary);
  gap: 12px;
}
.empty-icon { font-size: 48px; }
.empty-state p { font-size: 14px; }

/* ===== Loading ===== */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  gap: 16px;
}
.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-state p { color: var(--text-secondary); font-size: 13px; }

/* ===== Element Plus overrides — Dashboard 2 风格 ===== */

/* Buttons */
.el-button {
  border-radius: var(--radius-sm) !important;
  font-weight: 500 !important;
  font-size: 13px !important;
  height: 34px !important;
  padding: 0 14px !important;
  transition: all .15s ease !important;
}
.el-button--default {
  background: var(--card) !important;
  border: 1px solid var(--border) !important;
  color: var(--text) !important;
  box-shadow: var(--shadow-sm) !important;
}
.el-button--default:hover {
  background: var(--primary-light) !important;
  border-color: var(--border-hover) !important;
  color: var(--text) !important;
}
.el-button--primary {
  background: var(--primary) !important;
  border: 1px solid var(--primary) !important;
  color: #fff !important;
  box-shadow: none !important;
}
.el-button--primary:hover {
  background: var(--primary-hover) !important;
  border-color: var(--primary-hover) !important;
}
.el-button--success {
  background: var(--success) !important;
  border: 1px solid var(--success) !important;
  color: #fff !important;
}
.el-button--danger {
  background: transparent !important;
  border: 1px solid var(--danger) !important;
  color: var(--danger) !important;
}
.el-button--danger:hover {
  background: var(--danger-light) !important;
}
.el-button.is-text {
  background: transparent !important;
  border: none !important;
  padding: 0 6px !important;
  height: auto !important;
  color: var(--text-secondary) !important;
}
.el-button.is-text:hover {
  background: var(--primary-light) !important;
  color: var(--text) !important;
}
.el-button.is-link {
  background: transparent !important;
  border: none !important;
  color: var(--text) !important;
}
.el-button--small {
  height: 30px !important;
  padding: 0 10px !important;
  font-size: 12px !important;
}

/* Input */
.el-input__wrapper {
  border-radius: var(--radius-sm) !important;
  box-shadow: 0 0 0 1px var(--border) inset !important;
  background: var(--card) !important;
  padding: 0 10px !important;
  height: 34px !important;
  transition: all .15s ease !important;
}
.el-input__wrapper:hover {
  box-shadow: 0 0 0 1px var(--border-hover) inset !important;
}
.el-input__wrapper.is-focus {
  box-shadow: 0 0 0 1px var(--primary) inset !important;
}
.el-input__inner {
  font-size: 13px !important;
  color: var(--text) !important;
}
.el-input__inner::placeholder {
  color: var(--text-tertiary) !important;
}
.el-input__prefix, .el-input__suffix {
  color: var(--text-tertiary) !important;
}

/* Input Number */
.el-input-number {
  --el-input-number-step-button-border-radius: var(--radius-sm);
}
.el-input-number .el-input-number__decrease,
.el-input-number .el-input-number__increase {
  border: none !important;
  background: var(--primary-light) !important;
  color: var(--text-secondary) !important;
}
.el-input-number .el-input-number__decrease:hover,
.el-input-number .el-input-number__increase:hover {
  color: var(--text) !important;
  background: var(--border) !important;
}

/* Select */
.el-select__wrapper {
  border-radius: var(--radius-sm) !important;
  box-shadow: 0 0 0 1px var(--border) inset !important;
  padding: 0 10px !important;
  min-height: 34px !important;
}
.el-select__wrapper:hover {
  box-shadow: 0 0 0 1px var(--border-hover) inset !important;
}
.el-select__wrapper.is-focused {
  box-shadow: 0 0 0 1px var(--primary) inset !important;
}
.el-select__placeholder {
  color: var(--text-tertiary) !important;
  font-size: 13px !important;
}
.el-select__selected-item span {
  color: var(--text) !important;
  font-size: 13px !important;
}
.el-select-dropdown {
  border-radius: var(--radius) !important;
  border: 1px solid var(--border) !important;
  box-shadow: var(--shadow-lg) !important;
  padding: 4px !important;
}
.el-select-dropdown__item {
  border-radius: var(--radius-sm) !important;
  font-size: 13px !important;
  padding: 6px 10px !important;
  margin: 1px 0 !important;
  color: var(--text) !important;
}
.el-select-dropdown__item.is-hovering {
  background: var(--primary-light) !important;
}
.el-select-dropdown__item.is-selected {
  color: var(--primary) !important;
  font-weight: 600 !important;
}

/* Dialog */
.el-dialog {
  border-radius: var(--radius) !important;
  border: 1px solid var(--border) !important;
  box-shadow: var(--shadow-lg) !important;
  overflow: hidden;
}
.el-dialog__header {
  border-bottom: 1px solid var(--border);
  padding: 16px 20px !important;
  margin-right: 0 !important;
}
.el-dialog__title {
  font-size: 15px !important;
  font-weight: 600 !important;
  color: var(--text) !important;
}
.el-dialog__headerbtn {
  top: 16px !important;
  right: 16px !important;
}
.el-dialog__body {
  padding: 20px !important;
  color: var(--text) !important;
}
.el-dialog__footer {
  border-top: 1px solid var(--border);
  padding: 12px 20px !important;
  background: var(--card);
}

/* Table */
.el-table {
  --el-table-border-color: var(--border-light);
  --el-table-header-bg-color: var(--card);
  --el-table-header-text-color: var(--text-tertiary);
  --el-table-text-color: var(--text);
  --el-table-row-hover-bg-color: var(--primary-light);
  --el-table-bg-color: var(--card);
  --el-table-tr-bg-color: var(--card);
  font-size: 13px;
  --el-table-border: none;
  border-radius: var(--radius) !important;
  overflow: hidden;
}
.el-table th.el-table__cell {
  font-weight: 500 !important;
  font-size: 11px !important;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  border-bottom: 1px solid var(--border) !important;
  background: var(--card) !important;
  color: var(--text-tertiary) !important;
}
.el-table td.el-table__cell {
  border-bottom: 1px solid var(--border-light) !important;
  padding: 10px 0 !important;
}
.el-table--border th.el-table__cell,
.el-table--border td.el-table__cell {
  border-right: none !important;
}
.el-table--border::after,
.el-table--border::before,
.el-table__inner-wrapper::before {
  display: none !important;
}
.el-table .el-table__inner-wrapper {
  border: none !important;
}

/* Tag */
.el-tag {
  border-radius: var(--radius-sm) !important;
  font-weight: 500 !important;
  border: 1px solid var(--border) !important;
  padding: 1px 8px !important;
  font-size: 11px !important;
}
.el-tag--default {
  background: var(--card) !important;
  color: var(--text-secondary) !important;
}
.el-tag--info {
  background: var(--card) !important;
  color: var(--text-secondary) !important;
}
.el-tag--success {
  background: var(--success-light) !important;
  color: var(--success) !important;
  border-color: var(--success) !important;
}
.el-tag--warning {
  background: var(--warning-light) !important;
  color: var(--warning) !important;
  border-color: var(--warning) !important;
}
.el-tag--danger {
  background: var(--danger-light) !important;
  color: var(--danger) !important;
  border-color: var(--danger) !important;
}
.el-tag.is-light {
  border: 1px solid var(--border) !important;
}

/* Checkbox */
.el-checkbox__inner {
  border-radius: 4px !important;
  border-color: var(--border-hover) !important;
  width: 16px !important;
  height: 16px !important;
}
.el-checkbox__input.is-checked .el-checkbox__inner {
  background-color: var(--primary) !important;
  border-color: var(--primary) !important;
}
.el-checkbox__label {
  font-size: 13px !important;
  color: var(--text) !important;
}

/* Radio */
.el-radio__inner {
  border-color: var(--border-hover) !important;
  width: 16px !important;
  height: 16px !important;
}
.el-radio__input.is-checked .el-radio__inner {
  background-color: var(--primary) !important;
  border-color: var(--primary) !important;
}
.el-radio__label {
  font-size: 13px !important;
  color: var(--text) !important;
}

/* Form */
.el-form-item__label {
  font-size: 13px !important;
  font-weight: 500 !important;
  color: var(--text-secondary) !important;
}

/* Popover */
.el-popover.el-popper {
  border-radius: var(--radius) !important;
  border: 1px solid var(--border) !important;
  box-shadow: var(--shadow-lg) !important;
  padding: 8px !important;
}

/* Message */
.el-message {
  border-radius: var(--radius) !important;
  border: 1px solid var(--border) !important;
  box-shadow: var(--shadow-lg) !important;
  padding: 10px 16px !important;
}

/* MessageBox */
.el-message-box {
  border-radius: var(--radius) !important;
  border: 1px solid var(--border) !important;
  box-shadow: var(--shadow-lg) !important;
}

/* Divider */
.el-divider--vertical {
  border-left-color: var(--border) !important;
}

/* Loading */
.el-loading-mask {
  background: rgba(255,255,255,.9) !important;
}
.el-loading-spinner .circular {
  stroke: var(--primary) !important;
}

/* Tree */
.el-tree {
  font-size: 13px !important;
  color: var(--text) !important;
}
.el-tree-node__content:hover {
  background: var(--primary-light) !important;
}
.el-tree-node.is-current > .el-tree-node__content {
  background: var(--primary-light) !important;
}
.el-checkbox__input.is-indeterminate .el-checkbox__inner {
  background-color: var(--primary) !important;
  border-color: var(--primary) !important;
}

/* Tabs */
.el-tabs__item {
  font-size: 13px !important;
  color: var(--text-secondary) !important;
}
.el-tabs__item.is-active {
  color: var(--primary) !important;
}
.el-tabs__active-bar {
  background-color: var(--primary) !important;
}

/* Pagination */
.el-pagination {
  --el-pagination-button-color: var(--text-secondary);
  --el-pagination-hover-color: var(--primary);
}
</style>
