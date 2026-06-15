<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const emit = defineEmits(['navigate'])

const stats = ref({
  styles: 0, mainPlan: 0, busyLines: 0, totalLines: 0,
  sewingPending: 0, sewingOverdue: 0,
  warehouseTotal: 0,
  todayDispatch: 0, dispatchRate: 0,
})
const loading = ref(true)

async function loadStats() {
  loading.value = true
  try {
    const [stylesRes, planRes, sewingRes, invRes] = await Promise.all([
      api.getStyles(''),
      api.getMainPlan(),
      api.getSewingSummary(),
      api.getWarehouseInventory('raw_material'),
    ])
    const styles = stylesRes.data || []
    const plans = planRes.data || []
    const sewing = sewingRes.data || {}
    const inv = invRes.data || []

    stats.value.styles = styles.length
    stats.value.mainPlan = plans.length
    stats.value.sewingPending = sewing.plan?.totalCount || 0
    stats.value.sewingOverdue = sewing.plan?.overdue || 0
    stats.value.warehouseTotal = inv.reduce((s, r) => s + (r.current_qty || 0), 0)
  } catch { /* ignore */ }
  loading.value = false
}

const _d = new Date()
const today = `${_d.getFullYear()}年${_d.getMonth()+1}月${_d.getDate()}日`
const weekdays = ['日','一','二','三','四','五','六']
const weekday = weekdays[_d.getDay()]

const modules = [
  {
    key: 'dashboard', label: '工作台', icon: '📊', color: '#6e3ff3',
    desc: '数据看板与生产概览',
    stats: [
      { label: '款式总数', value: () => stats.value.styles, unit: '个' },
      { label: '主计划', value: () => stats.value.mainPlan, unit: '个' },
    ],
  },
  {
    key: 'styles', label: '基础数据', icon: '📋', color: '#3b82f6',
    desc: '款式、面料、车间管理',
    stats: [
      { label: '款式总数', value: () => stats.value.styles, unit: '个' },
      { label: '面料装柜', value: () => '-', unit: '条' },
    ],
  },
  {
    key: 'mainPlan', label: '计划管理', icon: '📅', color: '#f59e0b',
    desc: '主计划、排程、二次加工',
    stats: [
      { label: '主计划', value: () => stats.value.mainPlan, unit: '个' },
      { label: '缝制待排', value: () => stats.value.sewingPending, unit: '个' },
    ],
  },
  {
    key: 'warehouse', label: '仓库管理', icon: '📦', color: '#10b981',
    desc: '面料、辅料、裁片、成品',
    stats: [
      { label: '面料库存', value: () => stats.value.warehouseTotal, unit: 'KG' },
      { label: '仓库类型', value: () => 4, unit: '个' },
    ],
  },
  {
    key: 'dispatch', label: '报工管理', icon: '📝', color: '#8b5cf6',
    desc: '生产报工、产量统计',
    stats: [
      { label: '今日报工', value: () => stats.value.todayDispatch, unit: '条' },
      { label: '完成率', value: () => stats.value.dispatchRate, unit: '%' },
    ],
  },
  {
    key: 'config', label: '系统设置', icon: '⚙️', color: '#6b7280',
    desc: '工作日历、产能、排产策略',
    stats: [
      { label: '系统状态', value: () => '正常', unit: '' },
      { label: '在线人数', value: () => 1, unit: '人' },
    ],
  },
]

function enterModule(key) {
  emit('navigate', key)
}

onMounted(loadStats)
</script>

<template>
  <div class="entry-page">
    <!-- 顶部品牌 -->
    <div class="brand-bar">
      <div class="brand-logo">
        <div class="logo-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
        </div>
        <span class="brand-text">EUC 排程系统</span>
      </div>
    </div>

    <!-- 顶部欢迎区 -->
    <div class="welcome-section">
      <div class="welcome-left">
        <h1 class="welcome-title">欢迎回来 👋</h1>
        <p class="welcome-date">{{ today }} 星期{{ weekday }}</p>
      </div>
      <div class="welcome-right">
        <div class="quick-stat">
          <span class="qs-value">{{ stats.styles }}</span>
          <span class="qs-label">款式</span>
        </div>
        <div class="quick-stat">
          <span class="qs-value">{{ stats.mainPlan }}</span>
          <span class="qs-label">计划</span>
        </div>
        <div class="quick-stat">
          <span class="qs-value">{{ stats.sewingPending }}</span>
          <span class="qs-label">排程</span>
        </div>
      </div>
    </div>

    <!-- 模块卡片网格 -->
    <div class="module-grid">
      <div
        v-for="m in modules"
        :key="m.key"
        class="module-card"
        @click="enterModule(m.key)"
      >
        <div class="card-header">
          <div class="card-icon" :style="{ background: m.color + '15', color: m.color }">
            {{ m.icon }}
          </div>
          <div class="card-arrow">→</div>
        </div>
        <h3 class="card-title">{{ m.label }}</h3>
        <p class="card-desc">{{ m.desc }}</p>
        <div class="card-stats">
          <div v-for="s in m.stats" :key="s.label" class="card-stat">
            <span class="stat-value">{{ typeof s.value() === 'number' ? s.value().toLocaleString() : s.value() }}</span>
            <span class="stat-unit">{{ s.unit }}</span>
            <span class="stat-label">{{ s.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entry-page {
  max-width: 1100px;
  margin: 0 auto;
}

.brand-bar {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}
.brand-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-logo .logo-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #6e3ff3, #aa8ef9);
  color: white;
}
.brand-text {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -.3px;
}

.welcome-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
  padding: 28px 32px;
  background: linear-gradient(135deg, #6e3ff3 0%, #a78bfa 100%);
  border-radius: 16px;
  color: white;
}
.welcome-title {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 4px;
}
.welcome-date {
  font-size: 14px;
  opacity: 0.85;
}
.welcome-right {
  display: flex;
  gap: 24px;
}
.quick-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 12px 20px;
  min-width: 80px;
}
.qs-value {
  font-size: 24px;
  font-weight: 700;
}
.qs-label {
  font-size: 11px;
  opacity: 0.8;
  margin-top: 2px;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.module-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}
.module-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}
.card-arrow {
  font-size: 18px;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}
.module-card:hover .card-arrow {
  transform: translateX(4px);
  color: var(--primary);
}

.card-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}
.card-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.card-stats {
  display: flex;
  gap: 24px;
}
.card-stat {
  display: flex;
  flex-direction: column;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.stat-unit {
  font-size: 11px;
  color: var(--text-tertiary);
}
.stat-label {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

@media (max-width: 900px) {
  .module-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .module-grid { grid-template-columns: 1fr; }
  .welcome-section { flex-direction: column; gap: 16px; text-align: center; }
}
</style>
