/**
 * Phase 9.3 — warehouse API(仓库)
 *
 * Phase 7 Scope Freeze:NestJS 端已实现 5 端点(Phase 7 验收),
 * 但 frontend 默认仍走 Express(降级路径),避免覆盖 Express 久经考验的业务
 *
 * Phase 11 Express 下线时,改 backend-routing.js 把 /api/warehouse 改成 nest
 */
const warehouseFactory = (api) => ({
  getWarehouseInbound: (type) => api.get(`/warehouse/${type}/inbound`),
  addWarehouseInbound: (type, data) => api.post(`/warehouse/${type}/inbound`, data),
  getWarehouseOutbound: (type) => api.get(`/warehouse/${type}/outbound`),
  addWarehouseOutbound: (type, data) => api.post(`/warehouse/${type}/outbound`, data),
  getWarehouseInventory: (type, params) =>
    api.get(`/warehouse/${type}/inventory`, { params: params || {} }),
  importWarehouse: (type, records) => api.post(`/warehouse/${type}/import`, { records }),

  // 批量入库(面料装载清单)
  batchInbound: (ids) => api.post('/fabric-loading/batch-inbound', { ids }),
});

export default warehouseFactory;