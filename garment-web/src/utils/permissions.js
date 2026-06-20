// [2026-06-20] 用户系统:前端权限工具函数
// 集中维护"谁能改 actual 行"的判断逻辑,
// 避免在 4 个 secondary 详情页 + SewingPlanDetail 重复实现

// schedule_type → workshop 映射(与后端 SCHEDULE_TYPE_WORKSHOP 同步)
export const SCHEDULE_TYPE_WORKSHOP = {
  cutting: 'cutting',
  printing: 'printing',
  embroidery: 'embroidery',
  template: 'template',
  ironing: 'ironing',
  sewing: 'sewing',
  // secondary 详情页里 row.schedule_type = 'secondary',secondary_type = 'printing' 等
  // 这里 secondary 不映射,需要 row.secondary_type 二次映射
}

// secondary_type → workshop 映射
export const SECONDARY_TYPE_WORKSHOP = {
  printing: 'printing',
  embroidery: 'embroidery',
  template: 'template',
  ironing: 'ironing',
}

/**
 * 判断当前用户能否编辑某行的 actual 数据
 * @param {object} row - 排程行(row.schedule_type, row.secondary_type, row.workshop)
 * @param {object} user - 当前用户(auth.user)
 * @returns {boolean}
 */
export function canEditActual(row, user) {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'dispatcher') return true  // 报工员自己写的不拦
  if (user.role === 'supervisor') {
    // supervisor 必须匹配车间
    const need = row.workshop
      || (row.schedule_type && SCHEDULE_TYPE_WORKSHOP[row.schedule_type])
      || (row.secondary_type && SECONDARY_TYPE_WORKSHOP[row.secondary_type])
    if (!need) return false
    return user.workshop === need
  }
  return false  // planner / planning_manager 不允许改 actual(权限矩阵定义)
}

/**
 * 判断当前用户能否查看某页(对应 route.meta.roles 检查的补充)
 * @param {string[]} roles - 允许的角色列表
 * @param {object} user - 当前用户
 * @returns {boolean}
 */
export function hasRole(roles, user) {
  if (!user) return false
  if (user.role === 'admin') return true
  return roles.includes(user.role)
}