/**
 * Phase 9.3 — system API(系统配置 / 迁移状态)
 *
 * 包含:系统配置 / 系统参数 / 迁移状态(由 NestJS 提供)
 */
const systemFactory = (api) => ({
  // 系统参数
  getSystemConfig: () => api.get('/system-config'),
  updateSystemConfig: (key, value) =>
    api.put(`/system-config/${key}`, { config_value: value }),
  getSystemParams: () => api.get('/system-params'),
  updateSystemParam: (key, value, remark) =>
    api.put(`/system-params/${key}`, { value, remark }),

  // Phase 9.2 迁移状态(NestJS 提供,前端用于动态路由)
  getMigrationStatus: () => api.get('/system/migration-status'),
});

export default systemFactory;