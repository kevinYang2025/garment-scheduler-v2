import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export default {
  // 通用 HTTP 方法（供直接调用）
  get: (url, config) => api.get(url, config),
  post: (url, data, config) => api.post(url, data, config),
  put: (url, data, config) => api.put(url, data, config),
  delete: (url, config) => api.delete(url, config),

  // 款式
  getStyles: (keyword) => api.get('/styles', { params: { keyword } }),
  getDistinctStyles: () => api.get('/styles/distinct'),
  getStyle: (id) => api.get(`/styles/${id}`),
  saveStyle: (style) => api.post('/styles', style),
  deleteStyle: (id) => api.delete(`/styles/${id}`),
  exportStyles: () => api.get('/styles/export', { responseType: 'blob' }),
  importStyles: (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        api.post('/styles/import', { file: base64 }).then(resolve).catch(reject)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  },

  // 车间 & 产线
  getWorkshops: () => api.get('/workshops'),
  getWorkshopLines: (id) => api.get(`/workshops/${id}/lines`),
  getProductionLines: () => api.get('/production-lines'),
  updateProductionLine: (id, data) => api.put(`/production-lines/${id}`, data),

  // 缝制车间管理（三层树）
  getSewingWorkshopTree: () => api.get('/sewing-workshop-tree'),
  addSewingWorkshopNode: (data) => api.post('/sewing-workshop-tree', data),
  updateSewingWorkshopNode: (id, data) => api.put(`/sewing-workshop-tree/${id}`, data),
  deleteSewingWorkshopNode: (id, type) => api.delete(`/sewing-workshop-tree/${id}`, { params: { type } }),
  batchAddCategories: (items) => api.post('/sewing-workshop-tree/batch', { type: 'category', items }),
  batchUpdateNodes: (items) => api.put('/sewing-workshop-tree/batch', { items }),
  exportSewingWorkshopTree: () => api.get('/sewing-workshop-tree/export', { responseType: 'blob' }),
  importSewingWorkshopTree: (file, mode) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        api.post('/sewing-workshop-tree/import', { file: base64, mode: mode || 'append' }).then(resolve).catch(reject)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  },

  // 预排总计划
  getMainPlan: () => api.get('/main-plan'),
  saveMainPlan: (plan) => api.post('/main-plan', plan),
  updateMainPlan: (id, data) => api.put(`/main-plan/${id}`, data),
  deleteMainPlan: (id) => api.delete(`/main-plan/${id}`),
  exportMainPlan: () => api.get('/main-plan/export', { responseType: 'blob' }),
  importMainPlan: (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/main-plan/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  // 排程（统一三行模型）
  getSchedule: (scheduleType, secondaryType) => api.get(`/schedule/${scheduleType}`, { params: { secondary_type: secondaryType || '' } }),
  getScheduleDaily: (scheduleType, masterId) => api.get(`/schedule/${scheduleType}/${masterId}/daily`),
  createSchedule: (scheduleType, data) => api.post(`/schedule/${scheduleType}`, data),
  updateSchedule: (scheduleType, id, data) => api.put(`/schedule/${scheduleType}/${id}`, data),
  deleteSchedule: (scheduleType, id) => api.delete(`/schedule/${scheduleType}/${id}`),

  // 实际生产数据
  getActual: (scheduleType) => api.get('/actual', { params: { scheduleType } }),
  getActualById: (id) => api.get(`/actual/${id}`),
  saveActual: (data) => api.post('/actual', data),
  updateActual: (id, data) => api.put(`/actual/${id}`, data),
  deleteActual: (id) => api.delete(`/actual/${id}`),
  batchImportActual: (records) => api.post('/actual/batch', { records }),
  // [#32] Missing sewing API methods
  saveSewing: (data) => api.post('/schedule/sewing', data),
  deleteSewing: (id) => api.delete(`/schedule/sewing/${id}`),
  // Missing cutting API methods
  saveCutting: (data) => api.post('/schedule/cutting', data),
  deleteCutting: (id) => api.delete(`/schedule/cutting/${id}`),
  // Missing secondary API methods
  saveSecondary: (data) => api.post('/schedule/secondary', data),
  deleteSecondary: (id) => api.delete(`/schedule/secondary/${id}`),
  // Missing daily report API
  getDaily: () => api.get('/daily'),
  saveDaily: (data) => api.post('/daily', data),
  // Missing inventory API
  getInventory: () => api.get('/inventory'),
  saveInventory: (data) => api.post('/inventory', data),
  // Missing line update API
  // (updateLine removed — use updateProductionLine instead)

  // 排程汇总
  getSecondarySummary: () => api.get('/schedule/secondary/summary'),
  getSewingSummary: () => api.get('/schedule/sewing/summary'),
  exportSchedule: (scheduleType, secondaryType) => api.get(`/schedule/${scheduleType}/export`, { params: { secondary_type: secondaryType || '' } }),
  importSchedule: (scheduleType, records, mode) => api.post(`/schedule/${scheduleType}/import`, { records, mode }),

  // 仓库
  getWarehouseInbound: (type) => api.get(`/warehouse/${type}/inbound`),
  addWarehouseInbound: (type, data) => api.post(`/warehouse/${type}/inbound`, data),
  getWarehouseOutbound: (type) => api.get(`/warehouse/${type}/outbound`),
  addWarehouseOutbound: (type, data) => api.post(`/warehouse/${type}/outbound`, data),
  getWarehouseInventory: (type) => api.get(`/warehouse/${type}/inventory`),
  importWarehouse: (type, records) => api.post(`/warehouse/${type}/import`, { records }),

  // 目视化排程
  getVisualGantt: () => api.get('/visual-schedule/gantt'),
  getVisualDateRange: () => api.get('/visual-schedule/date-range'),
  assignVisual: (data) => api.post('/visual-schedule/assign', data),
  unassignVisual: (data) => api.post('/visual-schedule/unassign', data),
  moveVisual: (data) => api.post('/visual-schedule/move', data),

  // 配置
  getCapacityConfig: () => api.get('/config/capacity'),
  updateCapacityConfig: (id, data) => api.put(`/config/capacity/${id}`, data),
  getSystemConfig: () => api.get('/config/system'),
  updateSystemConfig: (key, data) => api.put(`/config/system/${key}`, data),

  // 甘特图字段配置
  getGanttConfig: () => api.get('/config/gantt'),
  updateGanttConfig: (type, data) => api.put(`/config/gantt/${type}`, data),

  // 工作日历
  getWorkModes: () => api.get('/work-modes'),
  createWorkMode: (data) => api.post('/work-modes', data),
  deleteWorkMode: (id) => api.delete(`/work-modes/${id}`),
  getWorkCalendars: () => api.get('/work-calendars'),
  createWorkCalendar: (data) => api.post('/work-calendars', data),
  updateWorkCalendar: (id, data) => api.put(`/work-calendars/${id}`, data),
  deleteWorkCalendar: (id) => api.delete(`/work-calendars/${id}`),
  getCalendarExceptions: (calId) => api.get(`/work-calendars/${calId}/exceptions`),
  addCalendarException: (calId, data) => api.post(`/work-calendars/${calId}/exceptions`, data),
  deleteCalendarException: (calId, exId) => api.delete(`/work-calendars/${calId}/exceptions/${exId}`),
  checkWorkday: (date) => api.get('/workday-check', { params: { date } }),

  // 报工汇总
  getDispatchSummary: (params) => api.get('/dispatch-summary', { params }),
  getDispatchDailyTrend: (params) => api.get('/dispatch-daily-trend', { params }),
  getDispatchPlanVsActual: (params) => api.get('/dispatch-plan-vs-actual', { params }),
  getDispatchAlerts: () => api.get('/dispatch-alerts'),
  exportDispatchReport: (params) => api.get('/dispatch-export', { params, responseType: 'blob' }),
  getDispatchByLine: (params) => api.get('/dispatch-by-line', { params }),
  getDispatchByWorkshop: (params) => api.get('/dispatch-by-workshop', { params }),
  getDispatchByWorker: (params) => api.get('/dispatch-by-worker', { params }),

  // 交期预估
  getEstimations: () => api.get('/estimations'),
  simulateEstimation: (data) => api.post('/estimations/simulate', data),
  saveEstimation: (data) => api.post('/estimations', data),
  confirmEstimation: (id) => api.put(`/estimations/${id}/confirm`),

  // 出货计划
  getShippingPlans: () => api.get('/shipping-plans'),
  createShippingPlan: (data) => api.post('/shipping-plans', data),
  updateShippingPlan: (id, data) => api.put(`/shipping-plans/${id}`, data),
  deleteShippingPlan: (id) => api.delete(`/shipping-plans/${id}`),
  generateShippingPlans: () => api.post('/shipping-plans/generate'),

  // 排产策略
  getStrategies: () => api.get('/strategies'),
  createStrategy: (data) => api.post('/strategies', data),
  updateStrategy: (id, data) => api.put(`/strategies/${id}`, data),
  deleteStrategy: (id) => api.delete(`/strategies/${id}`),

  // 自动排产 & 产能预排
  autoSchedule: (strategyId) => api.post('/auto-schedule', { strategy_id: strategyId }),
  capacityPrecheck: () => api.get('/capacity-precheck'),

  // ASN 到货通知单
  getAsnList: (params) => api.get('/asn', { params }),
  getAsnDetail: (id) => api.get(`/asn/${id}`),
  createAsn: (data) => api.post('/asn', data),
  updateAsnStatus: (id, data) => api.put(`/asn/${id}/status`, data),
  addAsnDetail: (id, data) => api.post(`/asn/${id}/details`, data),
  deleteAsn: (id) => api.delete(`/asn/${id}`),

  // DN 发货通知单
  getDnList: (params) => api.get('/dn', { params }),
  getDnDetail: (id) => api.get(`/dn/${id}`),
  createDn: (data) => api.post('/dn', data),
  updateDnStatus: (id, data) => api.put(`/dn/${id}/status`, data),
  addDnDetail: (id, data) => api.post(`/dn/${id}/details`, data),
  deleteDn: (id) => api.delete(`/dn/${id}`),

  // 批量入库
  batchInbound: (ids) => api.post('/fabric-loading/batch-inbound', { ids }),

  // 操作日志
  getLogs: (params) => api.get('/logs', { params }),
}
