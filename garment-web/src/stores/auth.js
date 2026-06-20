// [2026-06-18] 用户系统:pinia auth store
// 管当前用户状态 + 登录/登出/me
import { defineStore } from 'pinia'
import api from '../api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,           // 当前登录用户
    initialized: false,   // 是否已尝试过 /me 拉取
    lastFetchedAt: 0,     // [2026-06-20 fix#前端-P1-6] 上次 fetchMe 时间戳,路由守卫 5 分钟轮询
    loading: false,       // 登录中
  }),

  getters: {
    isLoggedIn: (state) => !!state.user,
    role: (state) => state.user?.role || null,
    workshop: (state) => state.user?.workshop || null,
    isAdmin: (state) => state.user?.role === 'admin',
    isPlanner: (state) => ['admin', 'planning_manager', 'planner'].includes(state.user?.role),
    isDispatcher: (state) => state.user?.role === 'dispatcher',
    isSupervisor: (state) => state.user?.role === 'supervisor',
  },

  actions: {
    // 拉取当前用户(session 启动时调一次)
    async fetchMe() {
      try {
        const res = await api.get('/auth/me')
        this.user = res.data.user
      } catch {
        this.user = null
      } finally {
        this.initialized = true
        this.lastFetchedAt = Date.now()
      }
    },

    // 登录(账号密码 或 工号+PIN)
    async login({ username, password, pin_no, pin }) {
      this.loading = true
      try {
        const body = username
          ? { username, password }
          : { pin_no, pin }
        const res = await api.post('/auth/login', body)
        this.user = res.data.user
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e.response?.data?.error || '登录失败' }
      } finally {
        this.loading = false
      }
    },

    // 登出
    async logout() {
      try {
        await api.post('/auth/logout', {})
      } catch { /* ignore */ }
      this.user = null
    },

    // 改密
    async changePassword(old_password, new_password) {
      try {
        await api.post('/auth/change-password', { old_password, new_password })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e.response?.data?.error || '改密失败' }
      }
    },
  },
})
