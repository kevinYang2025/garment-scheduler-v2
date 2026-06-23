/**
 * Phase 9.3 — workflow API(工作流)
 *
 * 包含:ASN 到货通知单 / DN 发货通知单 / 操作日志
 *
 * Phase 9 这些模块仍未迁 NestJS,保持走 Express
 */
const workflowFactory = (api) => ({
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

  // 操作日志
  getLogs: (params) => api.get('/logs', { params }),
});

export default workflowFactory;