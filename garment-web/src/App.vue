<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWebSocket } from './composables/useWebSocket'
import { useAuthStore } from './stores/auth'
import api from './api'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const { DB, connected, onlineUsers } = useWebSocket()
const prefetchedStyles = ref(null)
const sidebarCollapsed = ref(false)

const _d = new Date()
const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`

// 预加载款式数据(Dashboard 用)
import { watch } from 'vue'
watch(() => DB.value, async (db) => {
  if (db && !prefetchedStyles.value) {
    try {
      const { data } = await api.getStyles('')
      prefetchedStyles.value = data
    } catch { /* ignore */ }
  }
}, { immediate: true })

// ==================== 导航 ====================
// 每个 group 内含若干 route name,sidebar 自动按"当前 route 属于哪个 group"高亮
// 嵌套 view(secondary/*, sewing/* 等)通过 groupIncludes 匹配
const navGroups = [
  {
    label: '工作台',
    match: ['home', 'dashboard', 'dispatch', 'dispatch-report'],
  },
  {
    label: '基础数据',
    // [2026-06-18] 辅料清单暂不开放
    match: ['basicData', 'styles', 'fabricList', 'sewingWorkshop', 'preWorkshopOutput', 'styleColorSize'],
  },
  {
    label: '计划管理',
    match: ['planManagement', 'mainPlan', 'mainPlanGantt', 'cutting', 'secondary', 'secondary-detail', 'sewing', 'sewing-plan', 'sewing-visual', 'actualReview'],
  },
  {
    label: '报工管理',
    match: ['cutting-dispatch', 'printing-dispatch', 'embroidery-dispatch', 'template-dispatch', 'ironing-dispatch', 'sewing-dispatch', 'sewing-dispatch-detail', 'estimation', 'shipping'],
  },
  {
    label: '仓库',
    match: ['warehouse', 'warehouse-detail'],
  },
  {
    label: '设置',
    match: ['config', 'work-calendar', 'strategy', 'logs', 'users'],
  },
]

// 当前 group:
// - planning 类(planner/planning_manager/admin)按 route 算(切到哪 group 就显示哪)
// - supervisor / dispatcher 固定 1 个 group(他们只关心自己的车间)
const currentGroup = computed(() => {
  const role = auth.role
  if (!role) return null
  if (role === 'dispatcher') return navGroups.find(g => g.label === '报工管理')
  if (role === 'supervisor') return navGroups.find(g => g.label === '计划管理')
  return navGroups.find(g => g.match.includes(route.name)) || navGroups[0]
})

// 当前 group 内的菜单项(简化版:label 从 navItems 找)
// 权限规则:
//   - 不标 roles = 全员可见
//   - 标 roles: [...]: 只这些角色可见
//   - 标 workshop: 仅当 user.workshop === workshop 时可见(supervisor / dispatcher 限定)
const navItems = {
  // 工作台(全员)
  home: { label: '工作台', icon: 'home' },
  // 数据看板(只 planning 类)
  dashboard: { label: '数据看板', icon: 'grid', roles: ['admin', 'planning_manager', 'planner'] },
  // 报工总览(全员 — dispatcher 是主用户)
  dispatch: { label: '报工总览', icon: 'data-analysis' },
  // 基础数据(只 planning)
  basicData: { label: '基础数据总览', icon: 'grid', roles: ['admin', 'planning_manager', 'planner'] },
  styles: { label: '款式管理', icon: 'tag', roles: ['admin', 'planning_manager', 'planner'] },
  fabricList: { label: '面料装柜清单', icon: 'list', roles: ['admin', 'planning_manager', 'planner'] },
  // [2026-06-18] 辅料清单暂不开放
  // auxiliaryList: { label: '辅料清单', icon: 'package', roles: ['admin', 'planning_manager', 'planner'] },
  sewingWorkshop: { label: '缝制车间管理', icon: 'factory', roles: ['admin', 'planning_manager', 'planner'] },
  preWorkshopOutput: { label: '前置车间产量', icon: 'data-analysis', roles: ['admin', 'planning_manager', 'planner'] },
  styleColorSize: { label: '分色分尺码', icon: 'ruler', roles: ['admin', 'planning_manager', 'planner'] },
  // 计划管理(planning 全看,supervisor 只看自己车间)
  planManagement: { label: '计划管理总览', icon: 'grid', roles: ['admin', 'planning_manager', 'planner'] },
  mainPlan: { label: '预排总计划', icon: 'calendar', roles: ['admin', 'planning_manager', 'planner'] },
  mainPlanGantt: { label: '预排甘特图', icon: 'calendar', roles: ['admin', 'planning_manager', 'planner'] },
  cutting: { label: '裁剪排程', icon: 'cut', roles: ['admin', 'planning_manager', 'planner', 'supervisor'], workshop: 'cutting' },
  secondary: { label: '二次加工', icon: 'palette', roles: ['admin', 'planning_manager', 'planner', 'supervisor'] },
  'secondary-detail': { label: '二次加工详情', icon: 'palette', roles: ['admin', 'planning_manager', 'planner', 'supervisor'] },
  sewing: { label: '缝制排程', icon: 'scissors', roles: ['admin', 'planning_manager', 'planner', 'supervisor'], workshop: 'sewing' },
  'sewing-plan': { label: '缝制排程详情', icon: 'scissors', roles: ['admin', 'planning_manager', 'planner', 'supervisor'], workshop: 'sewing' },
  'sewing-visual': { label: '目视化排程', icon: 'scissors', roles: ['admin', 'planning_manager', 'planner', 'supervisor'], workshop: 'sewing' },
  // 实际产量复核(supervisor / admin 复核)
  actualReview: { label: '实际产量复核', icon: 'ruler', roles: ['admin', 'supervisor'] },
  // 报工(planning + dispatcher,supervisor 不报工)
  'cutting-dispatch': { label: '裁剪报工', icon: 'cut', roles: ['admin', 'planning_manager', 'planner', 'dispatcher'], workshop: 'cutting' },
  'printing-dispatch': { label: '印花报工', icon: 'printer', roles: ['admin', 'planning_manager', 'planner', 'dispatcher'], workshop: 'printing' },
  'embroidery-dispatch': { label: '刺绣报工', icon: 'star', roles: ['admin', 'planning_manager', 'planner', 'dispatcher'], workshop: 'embroidery' },
  'template-dispatch': { label: '模板报工', icon: 'copy', roles: ['admin', 'planning_manager', 'planner', 'dispatcher'], workshop: 'template' },
  'ironing-dispatch': { label: '烫标报工', icon: 'flame', roles: ['admin', 'planning_manager', 'planner', 'dispatcher'], workshop: 'ironing' },
  'sewing-dispatch': { label: '缝制报工', icon: 'scissors', roles: ['admin', 'planning_manager', 'planner', 'dispatcher'], workshop: 'sewing' },
  'sewing-dispatch-detail': { label: '缝制报工', icon: 'scissors', roles: ['admin', 'planning_manager', 'planner', 'dispatcher'], workshop: 'sewing' },
  estimation: { label: '交期预估', icon: 'timer', roles: ['admin', 'planning_manager', 'planner'] },
  shipping: { label: '出货计划', icon: 'van', roles: ['admin', 'planning_manager', 'planner'] },
  // 仓库(planning only — 仓库 freeze 中,暂不开新用户)
  warehouse: { label: '仓库管理', icon: 'package', roles: ['admin', 'planning_manager', 'planner'] },
  'warehouse-detail': { label: '仓库详情', icon: 'package', roles: ['admin', 'planning_manager', 'planner'] },
  // 设置(planning only)
  config: { label: '系统设置', icon: 'settings', roles: ['admin', 'planning_manager', 'planner'] },
  'work-calendar': { label: '工作日历', icon: 'calendar', roles: ['admin', 'planning_manager', 'planner'] },
  strategy: { label: '排产策略', icon: 'magic-stick', roles: ['admin', 'planning_manager', 'planner'] },
  logs: { label: '操作日志', icon: 'list', roles: ['admin', 'planning_manager', 'planner'] },
  users: { label: '用户管理', icon: 'user', roles: ['admin'] },
}

// 菜单项是否对当前用户可见
function isItemVisible(item) {
  if (!item) return false
  const role = auth.role
  if (!role) return false
  // roles 限制
  if (item.roles && !item.roles.includes(role)) return false
  // workshop 限制(supervisor / dispatcher 限定本车间)
  if (item.workshop && item.workshop !== auth.workshop) return false
  return true
}

// role 标签
const roleLabels = {
  admin: '系统管理员',
  planning_manager: '计划主管',
  planner: '计划员',
  dispatcher: '报工员',
  supervisor: '车间主任',
}

const workshopNames = {
  cutting: '裁剪车间',
  printing: '印花车间',
  embroidery: '刺绣车间',
  template: '模板车间',
  ironing: '烫标车间',
  sewing: '缝制车间',
}

const pageTitle = computed(() => navItems[route.name]?.label || 'EUC 排程系统')

// ==================== 事件处理 ====================
function enterModule(name) {
  router.push({ name })
}
function goHome() {
  router.push({ name: 'home' })
}
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}
async function onLogout() {
  await auth.logout()
  router.push({ name: 'login' })
}

// SVG icon 字典
const icons = {
  home: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  grid: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
  tag: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
  list: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
  ruler: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>`,
  calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`,
  scissors: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2 8 12"/><circle cx="10" cy="10" r="1"/><path d="M14.5 5.5c-2 2-4 1-6 3s-1 4 1 6c2 2 4 1 6 3"/></svg>`,
  palette: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
  cut: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>`,
  package: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/></svg>`,
  factory: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8L8 13V8L2 12Z"/><path d="M11 7H4"/><path d="M13 7H8"/><path d="M16 7h-2"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  'chevron-right': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  'panel-left': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>`,
  'arrow-left': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  printer: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>`,
  star: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  copy: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  flame: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  'data-analysis': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>`,
  timer: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>`,
  van: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h14v8H2z"/><path d="M16 10h4l2 3v3h-6z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>`,
  'magic-stick': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4-3 3"/><path d="M2 22 11 13"/><path d="m18 6 4 4"/><path d="m17 7 3 3"/><path d="m19 9 3 3"/><path d="m21 11 3 3"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  logout: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`,
}
function getIcon(name) {
  return icons[name] || ''
}
</script>

<template>
  <div class="app-layout" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'entry-mode': route.name === 'home' }">
    <!-- Sidebar(首页隐藏) -->
    <aside v-if="route.name !== 'home' && route.name !== 'login'" class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <div class="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
          </div>
          <span class="logo-text">EUC 排程系统</span>
        </div>
      </div>

      <div class="sidebar-content">
        <div class="workspace-card">
          <div class="workspace-icon" v-html="getIcon('factory')"></div>
          <div class="workspace-info">
            <span class="workspace-name">服装工厂</span>
            <div class="workspace-meta">
              <span v-html="getIcon('user')"></span>
              <span>{{ onlineUsers.length || 1 }} 人在线</span>
            </div>
          </div>
        </div>

        <div class="back-to-home" @click="goHome">
          <span v-html="getIcon('arrow-left')"></span>
          <span>返回首页</span>
        </div>

        <nav class="sidebar-nav">
          <div v-if="currentGroup" class="nav-section">
            <div class="nav-section-label">{{ currentGroup.label }}</div>
            <template v-for="name in currentGroup.match" :key="name">
              <div
                v-if="navItems[name] && isItemVisible(navItems[name])"
                class="nav-item"
                :class="{ active: route.name === name }"
                :data-label="navItems[name].label"
                @click="enterModule(name)"
              >
                <span class="nav-icon" v-html="getIcon(navItems[name].icon)"></span>
                <span class="nav-label">{{ navItems[name].label }}</span>
                <span v-if="route.name === name" class="nav-arrow" v-html="getIcon('chevron-right')"></span>
              </div>
            </template>
          </div>
        </nav>
      </div>

      <div class="sidebar-footer">
        <div class="sidebar-user" @click="onLogout" title="点击注销">
          <div class="user-avatar">{{ (auth.user?.display_name || 'U').slice(0, 2) }}</div>
          <div class="user-info">
            <span class="user-name">{{ auth.user?.display_name || '未登录' }}</span>
            <span class="user-email">
              {{ roleLabels[auth.role] || auth.role }}
              <template v-if="auth.workshop"> · {{ workshopNames[auth.workshop] }}</template>
            </span>
          </div>
          <span class="logout-icon" v-html="getIcon('logout')"></span>
        </div>
      </div>
    </aside>

    <!-- Main area -->
    <div class="main-area">
      <!-- Header(首页/登录页隐藏) -->
      <header v-if="route.name !== 'home' && route.name !== 'login'" class="app-header">
        <div class="header-left">
          <button class="sidebar-toggle" @click="toggleSidebar" v-html="getIcon('panel-left')"></button>
          <h1 class="header-title">{{ pageTitle }}</h1>
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
        <router-view v-slot="{ Component }">
          <KeepAlive :max="8">
            <component :is="Component" :key="route.fullPath" :db="DB" :initial-data="prefetchedStyles" @navigate="enterModule" />
          </KeepAlive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style>
/* 全局样式(从原 App.vue 完整保留) */
:root {
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

.app-layout { display: flex; height: 100vh; overflow: hidden; }

.sidebar {
  width: var(--sidebar-width);
  background: var(--card);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
  transition: width .2s ease; overflow: hidden;
}
.sidebar-collapsed .sidebar { width: 64px; overflow: visible; }
.sidebar-collapsed .sidebar-header,
.sidebar-collapsed .sidebar-footer { overflow: hidden; }
.sidebar-collapsed .sidebar-content { overflow: visible; }
.sidebar-collapsed .logo-text,
.sidebar-collapsed .workspace-card,
.sidebar-collapsed .nav-section-label,
.sidebar-collapsed .nav-label,
.sidebar-collapsed .nav-arrow,
.sidebar-collapsed .user-info,
.sidebar-collapsed .nav-item .nav-icon + .nav-label { display: none; }
.sidebar-collapsed .nav-item { justify-content: center; padding: 8px 0; position: relative; }
.sidebar-collapsed .nav-item::after {
  content: attr(data-label);
  position: absolute; left: calc(100% + 12px); top: 50%;
  transform: translateY(-50%);
  padding: 5px 10px; background: var(--text); color: #fff;
  font-size: 12px; font-weight: 500; white-space: nowrap;
  border-radius: 6px; pointer-events: none; opacity: 0;
  transition: opacity .15s ease; z-index: 100;
}
.sidebar-collapsed .nav-item:hover::after { opacity: 1; }
.sidebar-collapsed .sidebar-nav { gap: 4px; }
.sidebar-collapsed .sidebar-user { justify-content: center; }

.sidebar-header { padding: 16px 20px 12px; flex-shrink: 0; }
.sidebar-logo { display: flex; align-items: center; gap: 10px; }
.logo-icon {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #6e3ff3, #aa8ef9);
  color: white; flex-shrink: 0;
}
.logo-text { font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -.3px; white-space: nowrap; }

.sidebar-content { flex: 1; overflow-y: auto; padding: 0 12px; }
.sidebar-content::-webkit-scrollbar { width: 4px; }
.sidebar-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

.back-to-home {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; margin-bottom: 12px;
  border-radius: var(--radius-sm);
  cursor: pointer; font-size: 13px; font-weight: 500;
  color: var(--text-secondary); transition: var(--transition);
}
.back-to-home:hover { background: var(--primary-light); color: var(--primary); }
.entry-mode .main-area { margin-left: 0; }

.workspace-card {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin-bottom: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--card);
}
.workspace-icon {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px; background: var(--primary-light);
  color: var(--primary); flex-shrink: 0;
}
.workspace-info { display: flex; flex-direction: column; min-width: 0; }
.workspace-name { font-size: 13px; font-weight: 600; color: var(--text); }
.workspace-meta {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-tertiary);
}

.sidebar-nav { display: flex; flex-direction: column; gap: 4px; }
.nav-section { margin-bottom: 8px; }
.nav-section-label {
  font-size: 11px; font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: .5px;
  padding: 8px 12px 4px;
}
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: var(--radius-sm);
  cursor: pointer; transition: var(--transition);
  color: var(--text-secondary); font-size: 13px; font-weight: 500;
  position: relative;
}
.nav-item:hover { background: var(--primary-light); color: var(--text); }
.nav-item.active { background: var(--primary-light); color: var(--primary); }
.nav-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 20px; height: 20px; }
.nav-item.active .nav-icon { color: var(--primary); }
.nav-label { flex: 1; white-space: nowrap; }
.nav-arrow { color: var(--text-tertiary); opacity: .6; }

.sidebar-footer { padding: 12px; border-top: 1px solid var(--border); flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
.sidebar-user {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin-top: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer; transition: var(--transition);
}
.sidebar-user:hover { background: var(--primary-light); }
.user-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: linear-gradient(135deg, #6e3ff3, #aa8ef9);
  color: white; display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0;
}
.user-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.user-name { font-size: 13px; font-weight: 600; color: var(--text); }
.user-email { font-size: 11px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.logout-icon { color: var(--text-tertiary); opacity: 0; transition: opacity .15s ease; }
.sidebar-user:hover .logout-icon { opacity: 1; color: var(--danger); }

.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.app-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; height: 56px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0; position: sticky; top: 0; z-index: 10;
}
.header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.sidebar-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; background: none;
  border-radius: var(--radius-sm);
  cursor: pointer; color: var(--text-secondary);
  transition: var(--transition); flex-shrink: 0;
}
.sidebar-toggle:hover { background: var(--primary-light); color: var(--text); }
.header-title { font-size: 16px; font-weight: 600; color: var(--text); white-space: nowrap; }

.header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.status-chip {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: var(--radius-sm);
  font-size: 11px; font-weight: 500;
  border: 1px solid var(--border);
}
.status-chip.online { background: var(--card); color: var(--text-secondary); }
.status-chip.offline { background: var(--danger-light); color: var(--danger); border-color: var(--danger); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; }
.status-chip.online .status-dot { background: var(--success); }
.status-chip.offline .status-dot { background: var(--danger); }
.header-date { font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }

.main-content { flex: 1; overflow: auto; padding: 4px 24px 24px 24px; background: var(--bg); }
.main-content::-webkit-scrollbar { width: 6px; }
.main-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 6px; }

.page-header-bar { margin-bottom: 24px; }
.page-heading { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
.page-desc { font-size: 13px; color: var(--text-secondary); }

.placeholder-page { }
.sewing-dispatch-home { max-width: 800px; padding: 40px 20px; }
.sdh-header { text-align: center; margin-bottom: 40px; }
.sdh-title { font-size: 22px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.sdh-desc { font-size: 14px; color: var(--text-secondary); }
.sdh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
.sdh-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 32px 20px;
  text-align: center; cursor: pointer; transition: all 0.2s; position: relative;
}
.sdh-card:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 16px rgba(124,58,237,0.1);
  transform: translateY(-2px);
}
.sdh-card-icon { font-size: 36px; margin-bottom: 12px; }
.sdh-card-name { font-size: 16px; font-weight: 600; color: var(--text); }
.sdh-card-arrow {
  position: absolute; right: 16px; top: 50%;
  transform: translateY(-50%);
  font-size: 18px; color: var(--text-tertiary);
  opacity: 0; transition: opacity 0.2s;
}
.sdh-card:hover .sdh-card-arrow { opacity: 1; color: var(--primary); }
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; color: var(--text-tertiary); gap: 12px;
}
.empty-icon { font-size: 48px; }
.empty-state p { font-size: 14px; }

.loading-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 60vh; gap: 16px;
}
.loading-spinner {
  width: 28px; height: 28px;
  border: 2.5px solid var(--border); border-top-color: var(--primary);
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-state p { color: var(--text-secondary); font-size: 13px; }

.el-button { border-radius: var(--radius-sm) !important; font-weight: 500 !important; font-size: 13px !important; height: 34px !important; padding: 0 14px !important; transition: all .15s ease !important; }
.el-button--default { background: var(--card) !important; border: 1px solid var(--border) !important; color: var(--text) !important; box-shadow: var(--shadow-sm) !important; }
.el-button--default:hover { background: var(--primary-light) !important; border-color: var(--border-hover) !important; color: var(--text) !important; }
.el-button--primary { background: var(--primary) !important; border: 1px solid var(--primary) !important; color: #fff !important; box-shadow: none !important; }
.el-button--primary:hover { background: var(--primary-hover) !important; border-color: var(--primary-hover) !important; }
.el-button--success { background: var(--success) !important; border: 1px solid var(--success) !important; color: #fff !important; }
.el-button--danger { background: transparent !important; border: 1px solid var(--danger) !important; color: var(--danger) !important; }
.el-button--danger:hover { background: var(--danger-light) !important; }
.el-button.is-text { background: transparent !important; border: none !important; padding: 0 6px !important; height: auto !important; color: var(--text-secondary) !important; }
.el-button.is-text:hover { background: var(--primary-light) !important; color: var(--text) !important; }
.el-button.is-link { background: transparent !important; border: none !important; color: var(--text) !important; }
.el-button--small { height: 30px !important; padding: 0 10px !important; font-size: 12px !important; }

.el-input__wrapper { border-radius: var(--radius-sm) !important; box-shadow: 0 0 0 1px var(--border) inset !important; background: var(--card) !important; padding: 0 10px !important; height: 34px !important; transition: all .15s ease !important; }
.el-input__wrapper:hover { box-shadow: 0 0 0 1px var(--border-hover) inset !important; }
.el-input__wrapper.is-focus { box-shadow: 0 0 0 1px var(--primary) inset !important; }
.el-input__inner { font-size: 13px !important; color: var(--text) !important; }
.el-input__inner::placeholder { color: var(--text-tertiary) !important; }
.el-input__prefix, .el-input__suffix { color: var(--text-tertiary) !important; }

.el-input-number { --el-input-number-step-button-border-radius: var(--radius-sm); }
.el-input-number .el-input-number__decrease, .el-input-number .el-input-number__increase { border: none !important; background: var(--primary-light) !important; color: var(--text-secondary) !important; }
.el-input-number .el-input-number__decrease:hover, .el-input-number .el-input-number__increase:hover { color: var(--text) !important; background: var(--border) !important; }

.el-select__wrapper { border-radius: var(--radius-sm) !important; box-shadow: 0 0 0 1px var(--border) inset !important; padding: 0 10px !important; min-height: 34px !important; }
.el-select__wrapper:hover { box-shadow: 0 0 0 1px var(--border-hover) inset !important; }
.el-select__wrapper.is-focused { box-shadow: 0 0 0 1px var(--primary) inset !important; }
.el-select__placeholder { color: var(--text-tertiary) !important; font-size: 13px !important; }
.el-select__selected-item span { color: var(--text) !important; font-size: 13px !important; }
.el-select-dropdown { border-radius: var(--radius) !important; border: 1px solid var(--border) !important; box-shadow: var(--shadow-lg) !important; padding: 4px !important; }
.el-select-dropdown__item { border-radius: var(--radius-sm) !important; font-size: 13px !important; padding: 6px 10px !important; margin: 1px 0 !important; color: var(--text) !important; }
.el-select-dropdown__item.is-hovering { background: var(--primary-light) !important; }
.el-select-dropdown__item.is-selected { color: var(--primary) !important; font-weight: 600 !important; }

.el-dialog { border-radius: var(--radius) !important; border: 1px solid var(--border) !important; box-shadow: var(--shadow-lg) !important; overflow: hidden; }
.el-dialog__header { border-bottom: 1px solid var(--border); padding: 16px 20px !important; margin-right: 0 !important; }
.el-dialog__title { font-size: 15px !important; font-weight: 600 !important; color: var(--text) !important; }
.el-dialog__headerbtn { top: 16px !important; right: 16px !important; }
.el-dialog__body { padding: 20px !important; color: var(--text) !important; }
.el-dialog__footer { border-top: 1px solid var(--border); padding: 12px 20px !important; background: var(--card); }

.el-table { --el-table-border-color: var(--border-light); --el-table-header-bg-color: var(--card); --el-table-header-text-color: var(--text-tertiary); --el-table-text-color: var(--text); --el-table-row-hover-bg-color: var(--primary-light); --el-table-bg-color: var(--card); --el-table-tr-bg-color: var(--card); font-size: 13px; --el-table-border: none; border-radius: var(--radius) !important; overflow: hidden; }
.el-table th.el-table__cell { font-weight: 500 !important; font-size: 11px !important; letter-spacing: 0.3px; text-transform: uppercase; border-bottom: 1px solid var(--border) !important; background: var(--card) !important; color: var(--text-tertiary) !important; }
.el-table td.el-table__cell { border-bottom: 1px solid var(--border-light) !important; padding: 10px 0 !important; }
.el-table--border th.el-table__cell, .el-table--border td.el-table__cell { border-right: none !important; }
.el-table--border::after, .el-table--border::before, .el-table__inner-wrapper::before { display: none !important; }
.el-table .el-table__inner-wrapper { border: none !important; }

.el-tag { border-radius: var(--radius-sm) !important; font-weight: 500 !important; border: 1px solid var(--border) !important; padding: 1px 8px !important; font-size: 11px !important; }
.el-tag--default, .el-tag--info { background: var(--card) !important; color: var(--text-secondary) !important; }
.el-tag--success { background: var(--success-light) !important; color: var(--success) !important; border-color: var(--success) !important; }
.el-tag--warning { background: var(--warning-light) !important; color: var(--warning) !important; border-color: var(--warning) !important; }
.el-tag--danger { background: var(--danger-light) !important; color: var(--danger) !important; border-color: var(--danger) !important; }
.el-tag.is-light { border: 1px solid var(--border) !important; }

.el-checkbox__inner { border-radius: 4px !important; border-color: var(--border-hover) !important; width: 16px; height: 16px; }
.el-checkbox__input.is-checked .el-checkbox__inner { background-color: var(--primary) !important; border-color: var(--primary) !important; }
.el-checkbox__label { font-size: 13px !important; color: var(--text) !important; }

.el-radio__inner { border-color: var(--border-hover) !important; width: 16px; height: 16px; }
.el-radio__input.is-checked .el-radio__inner { background-color: var(--primary) !important; border-color: var(--primary) !important; }
.el-radio__label { font-size: 13px !important; color: var(--text) !important; }

.el-form-item__label { font-size: 13px !important; font-weight: 500 !important; color: var(--text-secondary) !important; }
.el-popover.el-popper { border-radius: var(--radius) !important; border: 1px solid var(--border) !important; box-shadow: var(--shadow-lg) !important; padding: 8px !important; }
.el-message { border-radius: var(--radius) !important; border: 1px solid var(--border) !important; box-shadow: var(--shadow-lg) !important; padding: 10px 16px !important; }
.el-message-box { border-radius: var(--radius) !important; border: 1px solid var(--border) !important; box-shadow: var(--shadow-lg) !important; }
.el-divider--vertical { border-left-color: var(--border) !important; }
.el-loading-mask { background: rgba(255,255,255,.9) !important; }
.el-loading-spinner .circular { stroke: var(--primary) !important; }
.el-tree { font-size: 13px !important; color: var(--text) !important; }
.el-tree-node__content:hover { background: var(--primary-light) !important; }
.el-tree-node.is-current > .el-tree-node__content { background: var(--primary-light) !important; }
.el-checkbox__input.is-indeterminate .el-checkbox__inner { background-color: var(--primary) !important; border-color: var(--primary) !important; }
.el-tabs__item { font-size: 13px !important; color: var(--text-secondary) !important; }
.el-tabs__item.is-active { color: var(--primary) !important; }
.el-tabs__active-bar { background-color: var(--primary) !important; }
.el-pagination { --el-pagination-button-color: var(--text-secondary); --el-pagination-hover-color: var(--primary); }
</style>
