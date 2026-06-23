/**
 * Phase 9.3 — report API(报工管理)
 *
 * 包含:5 类工序报工 + 实际生产数据 + 报工汇总
 *
 * /api/actual /api/report 都已在 Phase 6 迁 NestJS
 * /api/dispatch-summary /api/daily 等仍 Express
 */
const reportFactory = (api) => ({
  // 实际生产数据
  getActual: (scheduleType, keyword, is_second_inspection, secondary_type) =>
    api.get('/actual', {
      params: { scheduleType, keyword: keyword || '', is_second_inspection, secondary_type },
    }),
  getActualById: (id) => api.get(`/actual/${id}`),
  saveActual: (data) => api.post('/actual', data),
  updateActual: (id, data) => api.put(`/actual/${id}`, data),
  deleteActual: (id) => api.delete(`/actual/${id}`),
  batchImportActual: (records) => api.post('/actual/batch', { records }),
  saveSewing: (data) => api.post('/schedule/sewing', data),
  deleteSewing: (id) => api.delete(`/schedule/sewing/${id}`),
  saveCutting: (data) => api.post('/schedule/cutting', data),
  deleteCutting: (id) => api.delete(`/schedule/cutting/${id}`),
  getCuttingSchedule: () => api.get('/schedule/cutting'),
  exportCuttingSchedule: () => api.get('/schedule/cutting/export', { responseType: 'blob' }),
  getCuttingDailyActual: (params) => api.get('/schedule/cutting/daily', { params }),
  updateMainPlanCutting: (id, data) => api.put(`/main-plan/${id}/cutting`, data),
  saveSecondary: (data) => api.post('/schedule/secondary', data),
  deleteSecondary: (id) => api.delete(`/schedule/secondary/${id}`),
  getDaily: () => api.get('/daily'),
  saveDaily: (data) => api.post('/daily', data),
  getInventory: () => api.get('/inventory'),
  saveInventory: (data) => api.post('/inventory', data),

  // 报工汇总
  getDispatchSummary: (params) => api.get('/dispatch-summary', { params }),
  getDispatchDailyTrend: (params) => api.get('/dispatch-daily-trend', { params }),
  getDispatchPlanVsActual: (params) => api.get('/dispatch-plan-vs-actual', { params }),
  getDispatchAlerts: () => api.get('/dispatch-alerts'),
  exportDispatchReport: (params) =>
    api.get('/dispatch-export', { params, responseType: 'blob' }),
  getDispatchByLine: (params) => api.get('/dispatch-by-line', { params }),
  getDispatchByWorkshop: (params) => api.get('/dispatch-by-workshop', { params }),
  getDispatchByWorker: (params) => api.get('/dispatch-by-worker', { params }),

  // 出货计划
  getShippingPlans: () => api.get('/shipping-plans'),
  createShippingPlan: (data) => api.post('/shipping-plans', data),
  updateShippingPlan: (id, data) => api.put(`/shipping-plans/${id}`, data),
  deleteShippingPlan: (id) => api.delete(`/shipping-plans/${id}`),
  generateShippingPlans: () => api.post('/shipping-plans/generate'),

  // 仪表盘
  getAchievementRate: () => api.get('/dashboard/achievement-rate'),
  getLineStatus: () => api.get('/dashboard/line-status'),
  getSecondaryStatus: () => api.get('/dashboard/secondary-status'),
  getOrderStats: (mode) => api.get('/dashboard/order-stats', { params: { mode: mode || 'week' } }),

  // 排程导出导入
  exportSchedule: (scheduleType, secondaryType) =>
    api.get(`/schedule/${scheduleType}/export`, {
      params: { secondary_type: secondaryType || '' },
    }),
  importSchedule: (scheduleType, records, mode) =>
    api.post(`/schedule/${scheduleType}/import`, { records, mode }),
});

export default reportFactory;