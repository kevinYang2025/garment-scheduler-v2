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
    stats.value.styles = (stylesRes.data || []).length
    stats.value.mainPlan = (planRes.data || []).length
    stats.value.sewingPending = (sewingRes.data || {}).plan?.totalCount || 0
    stats.value.sewingOverdue = (sewingRes.data || {}).plan?.overdue || 0
    stats.value.warehouseTotal = (invRes.data || []).reduce((s, r) => s + (r.current_qty || 0), 0)
  } catch { /* ignore */ }
  loading.value = false
}

const _d = new Date()
const today = `${_d.getFullYear()}年${_d.getMonth()+1}月${_d.getDate()}日`
const weekdays = ['日','一','二','三','四','五','六']
const weekday = weekdays[_d.getDay()]

const modules = [
  {
    key: 'dashboard', label: '工作台', icon: '📊',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    desc: '数据看板与生产概览',
    stats: [
      { label: '款式总数', value: () => stats.value.styles, unit: '个' },
      { label: '主计划', value: () => stats.value.mainPlan, unit: '个' },
    ],
  },
  {
    key: 'styles', label: '基础数据', icon: '📋',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
    desc: '款式、面料、车间管理',
    stats: [
      { label: '款式总数', value: () => stats.value.styles, unit: '个' },
      { label: '面料装柜', value: () => '-', unit: '条' },
    ],
  },
  {
    key: 'mainPlan', label: '计划管理', icon: '📅',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
    desc: '主计划、排程、二次加工',
    stats: [
      { label: '主计划', value: () => stats.value.mainPlan, unit: '个' },
      { label: '缝制待排', value: () => stats.value.sewingPending, unit: '个' },
    ],
  },
  {
    key: 'warehouse', label: '仓库管理', icon: '📦',
    gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
    desc: '面料、辅料、裁片、成品',
    stats: [
      { label: '面料库存', value: () => stats.value.warehouseTotal, unit: 'KG' },
      { label: '仓库类型', value: () => 4, unit: '个' },
    ],
  },
  {
    key: 'dispatch', label: '报工管理', icon: '📝',
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
    desc: '生产报工、产量统计',
    stats: [
      { label: '今日报工', value: () => stats.value.todayDispatch, unit: '条' },
      { label: '完成率', value: () => stats.value.dispatchRate, unit: '%' },
    ],
  },
  {
    key: 'config', label: '系统设置', icon: '⚙️',
    gradient: 'linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)',
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

function fmtNum(v) {
  return typeof v === 'number' ? v.toLocaleString() : v
}

onMounted(loadStats)
</script>

<template>
  <div class="entry-page">
    <!-- 欢迎横幅 -->
    <div class="welcome-banner">
      <div class="welcome-content">
        <div class="brand">
          <span class="brand-icon">🌐</span>
          <span class="brand-name">EUC 排程系统</span>
        </div>
        <div class="welcome-text">
          <h1>欢迎回来 <span class="wave">👋</span></h1>
          <p class="date">{{ today }} 星期{{ weekday }}</p>
        </div>
      </div>
      <div class="welcome-stats">
        <div class="ws-item" v-for="s in [
          { v: stats.styles, l: '款式', color: '#c4b5fd' },
          { v: stats.mainPlan, l: '计划', color: '#fde68a' },
          { v: stats.sewingPending, l: '排程', color: '#a7f3d0' },
        ]" :key="s.l">
          <div class="ws-value">{{ fmtNum(s.v) }}</div>
          <div class="ws-label">{{ s.l }}</div>
        </div>
      </div>
    </div>

    <!-- 模块卡片 -->
    <div class="module-grid">
      <div
        v-for="m in modules"
        :key="m.key"
        class="module-card"
        @click="enterModule(m.key)"
      >
        <div class="mc-top">
          <div class="mc-icon-wrap" :style="{ background: m.gradient }">
            <span class="mc-icon">{{ m.icon }}</span>
          </div>
          <div class="mc-arrow">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
        </div>
        <div class="mc-body">
          <h3>{{ m.label }}</h3>
          <p>{{ m.desc }}</p>
        </div>
        <div class="mc-stats">
          <div class="mc-stat" v-for="s in m.stats" :key="s.label">
            <span class="mc-sv">{{ fmtNum(s.value()) }}<small>{{ s.unit }}</small></span>
            <span class="mc-sl">{{ s.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entry-page {
  max-width: 1060px;
  margin: 0 auto;
  padding: 32px 24px;
}

/* ── 欢迎横幅 ── */
.welcome-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px 36px;
  margin-bottom: 36px;
  border-radius: 20px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%);
  color: #fff;
  box-shadow: 0 8px 32px rgba(99, 102, 241, .35);
  position: relative;
  overflow: hidden;
}
.welcome-banner::before {
  content: '';
  position: absolute;
  right: -60px;
  top: -60px;
  width: 220px;
  height: 220px;
  background: rgba(255,255,255,0.08);
  border-radius: 50%;
}
.welcome-banner::after {
  content: '';
  position: absolute;
  right: 120px;
  bottom: -80px;
  width: 180px;
  height: 180px;
  background: rgba(255,255,255,0.05);
  border-radius: 50%;
}

.welcome-content { position: relative; z-index: 1; }

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.brand-icon {
  font-size: 18px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.18);
  border-radius: 8px;
  backdrop-filter: blur(4px);
}
.brand-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  opacity: 0.85;
}

.welcome-text h1 {
  font-size: 30px;
  font-weight: 700;
  margin-bottom: 4px;
  line-height: 1.2;
}
.wave { display: inline-block; animation: wave .8s ease-in-out; }
@keyframes wave {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(20deg); }
  75% { transform: rotate(-10deg); }
}
.date {
  font-size: 14px;
  opacity: 0.75;
}

.welcome-stats {
  display: flex;
  gap: 16px;
  position: relative;
  z-index: 1;
}
.ws-item {
  background: rgba(255,255,255,0.15);
  backdrop-filter: blur(8px);
  border-radius: 14px;
  padding: 16px 22px;
  min-width: 88px;
  text-align: center;
  border: 1px solid rgba(255,255,255,0.1);
}
.ws-value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
}
.ws-label {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 4px;
  letter-spacing: .5px;
}

/* ── 模块卡片 ── */
.module-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.module-card {
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  cursor: pointer;
  transition: all .25s cubic-bezier(.4,0,.2,1);
  border: 1px solid #f0f0f0;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
  display: flex;
  flex-direction: column;
}
.module-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0,0,0,.08);
  border-color: transparent;
}

.mc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}
.mc-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}
.mc-icon {
  font-size: 22px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.15));
}
.mc-arrow {
  color: #d1d5db;
  transition: all .25s;
}
.module-card:hover .mc-arrow {
  color: #6366f1;
  transform: translateX(3px);
}

.mc-body {
  flex: 1;
  margin-bottom: 18px;
}
.mc-body h3 {
  font-size: 17px;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 4px;
}
.mc-body p {
  font-size: 13px;
  color: #9ca3af;
  line-height: 1.4;
}

.mc-stats {
  display: flex;
  gap: 20px;
  padding-top: 16px;
  border-top: 1px solid #f3f4f6;
}
.mc-stat {
  display: flex;
  flex-direction: column;
}
.mc-sv {
  font-size: 20px;
  font-weight: 700;
  color: #1f2937;
  font-variant-numeric: tabular-nums;
}
.mc-sv small {
  font-size: 11px;
  font-weight: 500;
  color: #9ca3af;
  margin-left: 2px;
}
.mc-sl {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 2px;
}

/* ── 响应式 ── */
@media (max-width: 900px) {
  .module-grid { grid-template-columns: repeat(2, 1fr); }
  .welcome-banner { flex-direction: column; gap: 20px; text-align: center; }
}
@media (max-width: 600px) {
  .module-grid { grid-template-columns: 1fr; }
}
</style>
