import axios from 'axios';

/**
 * Phase 9.1 — 模块动态路由表
 *
 * 与 架构与重构方案.md §6.3 / §6.3.1 完全一致
 *
 * - value: 'nest'    → 走 3002 (NestJS)
 * - value: 'express' → 走 3001 (Express 旧)
 *
 * 启动时拉 /api/system/migration-status 覆盖静态表,
 * 失败时降级回静态表(全量默认走 nest,与方案一致)
 */

// 模块迁移状态:启动时从后端拉取一次,失败降级全量 Express
// Phase 11:warehouse 解冻 Scope Freeze,默认走 NestJS
// 仅 asn/dn 仍未迁(Phase 11 范围外)
const ROUTING_RULES = {
  '/api/auth':         'nest',       // Phase 2/3
  '/api/system':       'nest',       // Phase 3
  '/api/styles':       'nest',       // Phase 4
  '/api/main-plan':    'nest',       // Phase 5
  '/api/schedule':     'nest',       // Phase 5
  '/api/report':       'nest',       // Phase 6
  '/api/actual':       'nest',       // Phase 6
  '/api/warehouse':    'nest',       // Phase 7 (Phase 11 解冻)
  '/api/asn':          'express',    // 暂未迁
  '/api/dn':           'express',    // 暂未迁
};

// 后端地址映射
const BACKENDS = {
  nest:    'http://localhost:3002',
  express: 'http://localhost:3001',
};

// 运行时可变的路由表(静态表是 fallback)
let routingRules = { ...ROUTING_RULES };
let routingReady = false;

/**
 * 应用启动时调用,异步拉取后端真实迁移状态
 * 失败降级,绝不阻塞首屏
 */
export async function initBackendRouting() {
  try {
    // 注意:此时 axios 拦截器尚未挂载,直接走相对路径 + 短超时
    // 相对路径通过 vite proxy 转发(开发期)或 Nginx(生产期)
    const { data } = await axios.get('/api/system/migration-status', {
      timeout: 3000,
    });
    if (data && data.modules) {
      routingRules = { ...ROUTING_RULES, ...data.modules };
    }
    routingReady = true;
  } catch (err) {
    // 降级:保持静态表,不抛错,前端继续可用
    // eslint-disable-next-line no-console
    console.warn('[backend-routing] 拉取迁移状态失败,使用静态路由表:', err.message);
  }
}

/**
 * 根据 URL 解析目标后端
 * @param {string} url 请求路径(以 / 开头)
 * @returns {string} 后端 baseURL
 */
export function resolveBackend(url) {
  if (!url || typeof url !== 'string') return BACKENDS.nest;
  const rule = Object.entries(routingRules).find(([p]) => url.startsWith(p));
  const target = rule ? rule[1] : 'nest';
  return BACKENDS[target];
}

/**
 * 在 axios 实例上挂载 baseURL 拦截器
 * 必须在所有业务请求前调用
 */
export function installRoutingInterceptor(http) {
  http.interceptors.request.use((cfg) => {
    cfg.baseURL = resolveBackend(cfg.url);
    return cfg;
  });
}

export { routingReady, ROUTING_RULES, BACKENDS };