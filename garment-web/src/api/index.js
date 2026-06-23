import axios from 'axios'
import router from '@/router'
import { installRoutingInterceptor } from '@/config/backend-routing'

// Phase 9.3 拆分:业务方法按模块拆到 7 个文件
// 引入各模块 factory(接受 api 实例,返回对应模块的方法集)
import authFactory from './auth'
import baseFactory from './base'
import planFactory from './plan'
import reportFactory from './report'
import warehouseFactory from './warehouse'
import workflowFactory from './workflow'
import systemFactory from './system'

// [2026-06-18] 用户系统:加 withCredentials 让 session cookie 跨请求保持
// [2026-06-20 fix#前端-P3-2] 加 timeout 30s,避免请求 hang 死锁页面
// Phase 9.1:不再写死 baseURL,/api 路径交给拦截器按模块动态指向 3001 或 3002
const api = axios.create({
  withCredentials: true,
  timeout: 30000,
})

// Phase 9.1:挂载模块路由拦截器(根据 URL 自动选 NestJS 或 Express)
installRoutingInterceptor(api)

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // 排除 auth 相关请求,避免重定向循环
      const url = error.config?.url || ''
      if (url.includes('/auth/login') || url.includes('/auth/logout') || url.includes('/auth/me')) {
        return Promise.reject(error)
      }
      if (typeof window !== 'undefined' && !window.location.hash.includes('/login')) {
        router.push('/login').catch(() => {})
      }
    }
    return Promise.reject(error)
  }
)

// 各模块方法合并(命名空间 prefix,避免冲突)
const apiObj = {
  // 通用 HTTP 方法(供直接调用)
  get: (url, config) => api.get(url, config),
  post: (url, data, config) => api.post(url, data, config),
  put: (url, data, config) => api.put(url, data, config),
  delete: (url, config) => api.delete(url, config),

  // 模块方法(用命名空间)
  auth: authFactory(api),
  base: baseFactory(api),
  plan: planFactory(api),
  report: reportFactory(api),
  warehouse: warehouseFactory(api),
  workflow: workflowFactory(api),
  system: systemFactory(api),

  // [2026-06-20 fix#前端-P2-5] 统一下载 helper,axios 带 cookie + 处理 401 + 触发 blob 下载
  downloadFile: async (url, params, defaultFilename = 'download.xlsx') => {
    const res = await api.get(url, { params, responseType: 'blob' })
    const cd = res.headers?.['content-disposition'] || ''
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/)
    const filename = m ? decodeURIComponent(m[1]) : defaultFilename
    const blobUrl = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl)
      a.remove()
    }, 0)
  },

  // [2026-06-20 fix#业务-P2-4] ETag/If-Match 乐观锁 helper
  etagPut: async (url, data, opts = {}) => {
    const maxRetries = opts.maxRetries ?? 1
    let attempt = 0
    while (true) {
      attempt++
      let etag
      try {
        const getRes = await api.get(url)
        etag = getRes.headers?.etag
      } catch (e) {
        etag = null
      }
      try {
        const config = etag ? { headers: { 'If-Match': etag } } : {}
        return await api.put(url, data, config)
      } catch (err) {
        const status = err.response?.status
        if (status === 412 && attempt <= maxRetries) continue
        if (status === 412) {
          const e = new Error('资源已被其他用户修改,请刷新页面后重试')
          e.code = 'ETAG_CONFLICT'
          e.attempts = attempt
          throw e
        }
        throw err
      }
    }
  },
}

// 同时保留平铺方式(向后兼容 — 老代码用 `api.getStyles()` 也仍能用)
// 把各模块的方法平铺到顶层
for (const mod of [
  apiObj.auth,
  apiObj.base,
  apiObj.plan,
  apiObj.report,
  apiObj.warehouse,
  apiObj.workflow,
  apiObj.system,
]) {
  Object.assign(apiObj, mod)
}

export default apiObj