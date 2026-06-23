/**
 * Phase 9.3 — base API(基础资料)
 *
 * 包含:款式 / 车间 / 产线 / 缝制车间树 / 容量配置 / 甘特图配置 / 工作日历 / 排产策略
 *
 * 大部分 Phase 4 已迁 NestJS,但还有一些(如 work-calendar / capacity)在 Express
 * 拦截器自动按 path 选 nest / express
 */
const baseFactory = (api) => ({
  // 款式
  getStyles: (keyword) => api.get('/styles', { params: { keyword } }),
  getDistinctStyles: () => api.get('/styles/distinct'),
  getStyle: (id) => api.get(`/styles/${id}`),
  saveStyle: (style) => api.post('/styles', style),
  updateStyle: (id, style) => api.put(`/styles/${id}`, style),
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

  // 缝制车间管理(三层树)
  getSewingWorkshopTree: () => api.get('/sewing-workshop-tree'),
  addSewingWorkshopNode: (data) => api.post('/sewing-workshop-tree', data),
  updateSewingWorkshopNode: (id, data) => api.put(`/sewing-workshop-tree/${id}`, data),
  deleteSewingWorkshopNode: (id, type) =>
    api.delete(`/sewing-workshop-tree/${id}`, { params: { type } }),
  batchAddCategories: (items) =>
    api.post('/sewing-workshop-tree/batch', { type: 'category', items }),
  batchUpdateNodes: (items) => api.put('/sewing-workshop-tree/batch', { items }),
  exportSewingWorkshopTree: () =>
    api.get('/sewing-workshop-tree/export', { responseType: 'blob' }),
  importSewingWorkshopTree: (file, mode) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        api
          .post('/sewing-workshop-tree/import', {
            file: base64,
            mode: mode || 'append',
          })
          .then(resolve)
          .catch(reject)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  },

  // 排产策略(Phase 9 还没迁 NestJS,保留原路径)
  getStrategies: () => api.get('/strategies'),
  createStrategy: (data) => api.post('/strategies', data),
  updateStrategy: (id, data) => api.put(`/strategies/${id}`, data),
  deleteStrategy: (id) => api.delete(`/strategies/${id}`),

  // 容量配置 + 甘特图字段配置
  getCapacityConfig: () => api.get('/config/capacity'),
  updateCapacityConfig: (id, data) => api.put(`/config/capacity/${id}`, data),
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
  addCalendarException: (calId, data) =>
    api.post(`/work-calendars/${calId}/exceptions`, data),
  deleteCalendarException: (calId, exId) =>
    api.delete(`/work-calendars/${calId}/exceptions/${exId}`),
  checkWorkday: (date) => api.get('/workday-check', { params: { date } }),
  getCurrentWorkCalendar: () => api.get('/work-calendar/current'),
});

export default baseFactory;