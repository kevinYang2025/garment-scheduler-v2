/**
 * Phase 9.3 — plan API(计划管理)
 *
 * 包含:主计划 / 排程 / 排程汇总 / 目视化排程 / 自动排产
 *
 * /api/main-plan 和 /api/schedule 都已在 Phase 5 迁 NestJS
 * /api/visual-schedule /api/auto-schedule 仍 Express
 */
const planFactory = (api) => ({
  // 预排总计划
  getMainPlan: () => api.get('/main-plan'),
  getMainPlanStyles: (keyword) =>
    api.get('/main-plan/styles', { params: { keyword: keyword || '' } }),
  getMainPlanGantt: () => api.get('/main-plan/gantt'),
  getStyleColorSize: (keyword) =>
    api.get('/style-color-size', { params: { keyword: keyword || '' } }),
  saveMainPlan: (plan) => api.post('/main-plan', plan),
  updateMainPlan: (id, data) => api.put(`/main-plan/${id}`, data),
  deleteMainPlan: (id) => api.delete(`/main-plan/${id}`),
  autoSchedule: () => api.post('/main-plan/auto-schedule'),
  exportMainPlan: () => api.get('/main-plan/export', { responseType: 'blob' }),
  importMainPlan: (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/main-plan/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // 排程(统一三行模型)
  getSchedule: (scheduleType, secondaryType) =>
    api.get(`/schedule/${scheduleType}`, {
      params: { secondary_type: secondaryType || '' },
    }),
  getScheduleDaily: (scheduleType, masterId) =>
    api.get(`/schedule/${scheduleType}/${masterId}/daily`),
  createSchedule: (scheduleType, data) =>
    api.post(`/schedule/${scheduleType}`, data),
  updateSchedule: (scheduleType, id, data) =>
    api.put(`/schedule/${scheduleType}/${id}`, data),
  deleteSchedule: (scheduleType, id) =>
    api.delete(`/schedule/${scheduleType}/${id}`),

  // 印花排程
  getPrintingPlanData: () => api.get('/printing-plan-data'),
  getPrintingDailyPlan: () => api.get('/schedule/printing-daily-plan'),
  getEmbroideryDailyPlan: () => api.get('/schedule/embroidery-daily-plan'),
  getTemplateDailyPlan: () => api.get('/schedule/template-daily-plan'),
  getIroningDailyPlan: () => api.get('/schedule/ironing-daily-plan'),
  savePrintingActual: (data) => api.post('/schedule/sewing-daily-plan/actual', data),
  confirmPrintingPlan: (data) => api.post('/printing-plan-data/confirm', data),
  confirmTemplatePlan: (data) => api.post('/template-plan-data/confirm', data),

  // 排程汇总
  getSecondarySummary: () => api.get('/schedule/secondary/summary'),
  getSewingSummary: () => api.get('/schedule/sewing/summary'),

  // 自动排产 & 产能预排
  autoScheduleWithStrategy: (strategyId) =>
    api.post('/auto-schedule', { strategy_id: strategyId }),
  capacityPrecheck: () => api.get('/capacity-precheck'),

  // 目视化排程
  getVisualGantt: () => api.get('/visual-schedule/gantt'),
  getVisualDateRange: () => api.get('/visual-schedule/date-range'),
  assignVisual: (data) => api.post('/visual-schedule/assign', data),
  unassignVisual: (data) => api.post('/visual-schedule/unassign', data),
  moveVisual: (data) => api.post('/visual-schedule/move', data),
});

export default planFactory;