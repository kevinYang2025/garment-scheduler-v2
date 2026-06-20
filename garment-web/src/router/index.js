// [2026-06-18] 用户系统:vue-router 4 路由表 + 守卫
// 36 个 view,扁平路由 + 嵌套用 param(secondary/:type 等)
// 守卫:未登录 → /login;无权限 → /403 + ElMessage.warning
import { createRouter, createWebHashHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

// [2026-06-20 fix#前端-P1-6] 路由守卫刷新:5 分钟内已拉取过 /me 则不重拉
// 防御:admin 停用某 supervisor → session 7 天内仍可访问(后端鉴权还在但前端不感知)
// 5 分钟轮询一次,代价低,响应 401 时由 api/index.js 拦截器主动 logout
const ME_REFRESH_INTERVAL_MS = 5 * 60 * 1000

// 静态路由(不按需加载,首次全加载,工厂场景页面不多)
import Login from '../views/Login.vue'
import Forbidden from '../views/Forbidden.vue'

// 工作台
import EntryHome from '../views/EntryHome.vue'
import Dashboard from '../views/Dashboard.vue'

// 基础数据
import BasicDataHome from '../views/BasicDataHome.vue'
import Styles from '../views/Styles.vue'
import FabricLoadingList from '../views/FabricLoadingList.vue'
import SewingWorkshopManage from '../views/SewingWorkshopManage.vue'
import PreWorkshopOutput from '../views/PreWorkshopOutput.vue'
import StyleColorSize from '../views/StyleColorSize.vue'

// 计划管理
import PlanManagementHome from '../views/PlanManagementHome.vue'
import MainPlan from '../views/MainPlan.vue'
import CuttingSchedule from '../views/CuttingSchedule.vue'
import PrintingPlanDetail from '../views/PrintingPlanDetail.vue'
import EmbroideryPlanDetail from '../views/EmbroideryPlanDetail.vue'
import TemplatePlanDetail from '../views/TemplatePlanDetail.vue'
import IroningPlanDetail from '../views/IroningPlanDetail.vue'
import SecondaryHome from '../views/SecondaryHome.vue'
import SewingHome from '../views/SewingHome.vue'
import SewingPlanDetail from '../views/SewingPlanDetail.vue'
import VisualSchedule from '../views/VisualSchedule.vue'

// 报工管理
import DispatchHome from '../views/DispatchHome.vue'
import DispatchReport from '../views/DispatchReport.vue'
import CuttingDispatch from '../views/CuttingDispatch.vue'
import CuttingSecondDispatch from '../views/CuttingSecondDispatch.vue'
import SecondaryDispatch from '../views/SecondaryDispatch.vue'
import SewingDispatchSelect from '../views/SewingDispatchSelect.vue'
import SewingDispatch from '../views/SewingDispatch.vue'

// 仓库
import WarehouseHome from '../views/WarehouseHome.vue'
import WarehouseDetail from '../views/WarehouseDetail.vue'

// 设置 / 日志
import CapacityConfig from '../views/CapacityConfig.vue'
import OperationLogs from '../views/OperationLogs.vue'
import WorkCalendar from '../views/WorkCalendar.vue'
import SchedulingStrategy from '../views/SchedulingStrategy.vue'
import SystemParams from '../views/SystemParams.vue'
// [2026-06-18] 辅料清单暂不开放,注释路由
// import AuxiliaryList from '../views/AuxiliaryList.vue'

// 用户管理(admin 专属)
import UserManagement from '../views/UserManagement.vue'

// 实际产量复核(supervisor 专属)
import ActualReview from '../views/ActualReview.vue'

// 个人设置
import UserSettings from '../views/UserSettings.vue'

const routes = [
  { path: '/login', name: 'login', component: Login, meta: { public: true, noAuth: true } },
  { path: '/403', name: 'forbidden', component: Forbidden, meta: { public: true } },

  // 工作台
  { path: '/', name: 'home', component: EntryHome },
  { path: '/dashboard', name: 'dashboard', component: Dashboard, props: (route) => ({ fromRoute: true }) },

  // 基础数据
  { path: '/basic-data', name: 'basicData', component: BasicDataHome },
  { path: '/styles', name: 'styles', component: Styles },
  { path: '/fabric-list', name: 'fabricList', component: FabricLoadingList },
  // [2026-06-18] 辅料清单暂不开放
  // { path: '/auxiliary-list', name: 'auxiliaryList', component: AuxiliaryList },
  { path: '/sewing-workshop', name: 'sewingWorkshop', component: SewingWorkshopManage },
  { path: '/pre-workshop-output', name: 'preWorkshopOutput', component: PreWorkshopOutput },
  { path: '/style-color-size', name: 'styleColorSize', component: StyleColorSize },

  // 计划管理
  { path: '/plan-management', name: 'planManagement', component: PlanManagementHome },
  { path: '/main-plan', name: 'mainPlan', component: MainPlan },
  { path: '/cutting', name: 'cutting', component: CuttingSchedule },
  { path: '/secondary', name: 'secondary', component: SecondaryHome },
  { path: '/printing-plan', name: 'printing-plan', component: PrintingPlanDetail },
  { path: '/embroidery-plan', name: 'embroidery-plan', component: EmbroideryPlanDetail },
  { path: '/template-plan', name: 'template-plan', component: TemplatePlanDetail },
  { path: '/ironing-plan', name: 'ironing-plan', component: IroningPlanDetail },
  { path: '/sewing', name: 'sewing', component: SewingHome },
  { path: '/sewing/plan', name: 'sewing-plan', component: SewingPlanDetail },
  { path: '/sewing/visual', name: 'sewing-visual', component: VisualSchedule },

  // 报工管理
  { path: '/dispatch', name: 'dispatch', component: DispatchHome },
  { path: '/dispatch/report', name: 'dispatch-report', component: DispatchReport },
  { path: '/cutting-dispatch', name: 'cutting-dispatch', component: CuttingDispatch },
  { path: '/cutting-second-dispatch', name: 'cutting-second-dispatch', component: CuttingSecondDispatch },
  { path: '/printing-dispatch', name: 'printing-dispatch', component: SecondaryDispatch, props: { reportType: 'printing' } },
  { path: '/embroidery-dispatch', name: 'embroidery-dispatch', component: SecondaryDispatch, props: { reportType: 'embroidery' } },
  { path: '/template-dispatch', name: 'template-dispatch', component: SecondaryDispatch, props: { reportType: 'template' } },
  { path: '/ironing-dispatch', name: 'ironing-dispatch', component: SecondaryDispatch, props: { reportType: 'ironing' } },
  { path: '/sewing-dispatch', name: 'sewing-dispatch', component: SewingDispatchSelect },
  { path: '/sewing-dispatch/detail', name: 'sewing-dispatch-detail', component: SewingDispatch, props: (route) => ({ workshop: route.query.workshop }) },

  // 仓库（直接进裁片库详情，跳过卡片页）
  { path: '/warehouse', name: 'warehouse', redirect: { name: 'warehouse-detail', params: { type: 'cutting_piece' } } },
  { path: '/warehouse/:type', name: 'warehouse-detail', component: WarehouseDetail, props: true },

  // 设置
  { path: '/config', name: 'config', component: CapacityConfig },
  { path: '/work-calendar', name: 'work-calendar', component: WorkCalendar },
  { path: '/strategy', name: 'strategy', component: SchedulingStrategy },
  { path: '/system-params', name: 'system-params', component: SystemParams },
  { path: '/logs', name: 'logs', component: OperationLogs },

  // 用户管理(admin)
  { path: '/users', name: 'users', component: UserManagement, meta: { roles: ['admin'] } },

  // 实际产量复核(supervisor / admin)
  { path: '/actual-review', name: 'actualReview', component: ActualReview, meta: { roles: ['admin', 'supervisor'] } },

  // 个人设置
  { path: '/user-settings', name: 'userSettings', component: UserSettings },
]

const router = createRouter({
  // 用 hash 模式(工厂网络可能没配 history fallback)
  history: createWebHashHistory(),
  routes,
})

// 路由元 → 角色映射
function checkRole(route, userRole) {
  if (route.meta?.public) return true
  if (!route.meta?.roles) return true  // 无 roles 限制 = 任何登录用户都能进
  if (userRole === 'admin') return true  // admin bypass
  return route.meta.roles.includes(userRole)
}

// 全局守卫
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 首次启动拉取 me(session cookie 自动带)
  // [2026-06-20 fix#前端-P1-6] 每 5 分钟刷新一次,防已停用账号在前端缓存中仍能访问
  const now = Date.now()
  if (!auth.initialized || (auth.lastFetchedAt && now - auth.lastFetchedAt > ME_REFRESH_INTERVAL_MS)) {
    await auth.fetchMe()
  }

  // 已登录用户访问 /login → 跳到首页
  if (to.name === 'login' && auth.isLoggedIn) {
    return { path: '/' }
  }

  // 公开页(login)直接放行
  if (to.meta?.public) return true

  // 未登录 → 跳 login
  if (!auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 角色检查
  if (!checkRole(to, auth.role)) {
    // [2026-06-20] 跳 403 专用页 + toast 提示,而不是之前静默跳首页
    ElMessage.warning(`无权访问该页面(需要角色: ${to.meta.roles?.join('/') || '更高权限'})`)
    return { path: '/403', query: { from: to.fullPath } }
  }

  return true
})

export default router
