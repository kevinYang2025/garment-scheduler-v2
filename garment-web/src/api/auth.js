/**
 * Phase 9.3 — auth API
 *
 * 包含:
 *   - login / logout / me
 *   - changePassword
 *   - 用户管理(可选,Phase 3 未迁移则此模块仍 express)
 *
 * Phase 9.4:axios 通过 backend-routing 拦截器自动选 NestJS(/api/auth = nest)
 */
const authFactory = (api) => ({
  login: (body) => api.post('/auth/login', body),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (old_password, new_password) =>
    api.post('/auth/change-password', { old_password, new_password }),

  // 用户列表(管理员查看)
  getUsers: (params) => api.get('/system/users', { params }),
  createUser: (data) => api.post('/system/users', data),
  updateUser: (id, data) => api.put(`/system/users/${id}`, data),
  deleteUser: (id) => api.delete(`/system/users/${id}`),
});

export default authFactory;