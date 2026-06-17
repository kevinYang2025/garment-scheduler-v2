// [Dashboard] 数据指标注册表(适配 EntryHome 的 stats 接口)
// 每个指标: { key, label, color, calc(stats) }
// calc 接收 stats(扁平字段),返回 { value, total, percent }
// 加新指标:往数组 push 一个对象,calc 函数自己定义

export const DASHBOARD_METRICS = [
  {
    key: 'sewing_completion',
    label: '缝制计划完成率',
    color: '#6366f1',
    calc(s = {}) {
      const total = (s.mainPlan || 0) + (s.sewingPending || 0)
      const done = total - (s.sewingPending || 0)
      return {
        value: done,
        total,
        percent: total ? Math.round((done / total) * 100) : 0
      }
    }
  },
  {
    key: 'cutting_completion',
    label: '裁剪计划完成率',
    color: '#3b82f6',
    calc() {
      // 待后端补裁剪数据接口
      return { value: 0, total: 0, percent: 0 }
    }
  },
  {
    key: 'secondary_completion',
    label: '二次加工完成率',
    color: '#22c55e',
    calc() {
      // 待后端补二次加工数据接口
      return { value: 0, total: 0, percent: 0 }
    }
  },
  {
    key: 'template_completion',
    label: '模板完成率',
    color: '#f59e0b',
    calc(s = {}) {
      const total = s.styles || 0
      const done = 0  // 待后端补模板字段
      return {
        value: done,
        total,
        percent: total ? Math.round((done / total) * 100) : 0
      }
    }
  }
]

export const DEFAULT_METRIC_KEY = 'sewing_completion'
