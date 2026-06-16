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
  { key: 'dashboard', label: '工作台', icon: '📊', color: '#7c5cfc', bg: '#f0ecff', desc: '数据看板与生产概览' },
  { key: 'basicData', label: '基础数据', icon: '📋', color: '#4a9eff', bg: '#eaf3ff', desc: '款式、面料、车间管理' },
  { key: 'planManagement', label: '计划管理', icon: '📅', color: '#f5a623', bg: '#fff6e8', desc: '预排总计划、排程、二次加工' },
  { key: 'dispatch', label: '报工管理', icon: '📝', color: '#a78bfa', bg: '#f3eeff', desc: '裁剪、印花、刺绣、缝制报工' },
  { key: 'warehouse', label: '仓库管理', icon: '📦', color: '#34c77b', bg: '#e8faf0', desc: '面料、辅料、裁片、成品' },
  { key: 'config', label: '系统设置', icon: '⚙️', color: '#8e99a4', bg: '#f4f5f7', desc: '工作日历、产能、排产策略' },
]

const cardStats = {
  dashboard: [
    { label: '款式', value: () => stats.value.styles, unit: '个' },
    { label: '计划', value: () => stats.value.mainPlan, unit: '个' },
  ],
  basicData: [
    { label: '款式', value: () => stats.value.styles, unit: '个' },
    { label: '装柜', value: () => '-', unit: '条' },
  ],
  planManagement: [
    { label: '计划', value: () => stats.value.mainPlan, unit: '个' },
    { label: '待排', value: () => stats.value.sewingPending, unit: '个' },
  ],
  warehouse: [
    { label: '面料', value: () => stats.value.warehouseTotal, unit: 'KG' },
    { label: '仓库', value: () => 4, unit: '个' },
  ],
  dispatch: [
    { label: '报工', value: () => stats.value.todayDispatch, unit: '条' },
    { label: '完成率', value: () => stats.value.dispatchRate, unit: '%' },
  ],
  config: [
    { label: '状态', value: () => '正常', unit: '' },
    { label: '在线', value: () => 1, unit: '人' },
  ],
}

function enterModule(key) { emit('navigate', key) }
function fmtNum(v) { return typeof v === 'number' ? v.toLocaleString() : v }

onMounted(loadStats)
</script>

<template>
  <div class="entry-bg">
    <div class="entry-container">

      <!-- 顶部横幅 -->
      <div class="banner">
        <div class="banner-left">
          <div class="brand">
            <span class="brand-dot"></span>
            <span class="brand-name">EUC 排程系统</span>
          </div>
          <h1 class="greeting">欢迎回来 <span class="wave">👋</span></h1>
          <p class="sub-date">{{ today }} 星期{{ weekday }}</p>
        </div>
        <div class="banner-right">
          <div class="pill" v-for="s in [
            { v: stats.styles, l: '款式', c: '#c4b5fd' },
            { v: stats.mainPlan, l: '计划', c: '#fde68a' },
            { v: stats.sewingPending, l: '排程', c: '#a7f3d0' },
          ]" :key="s.l">
            <span class="pill-val">{{ fmtNum(s.v) }}</span>
            <span class="pill-lbl">{{ s.l }}</span>
          </div>
        </div>
      </div>

      <!-- 模块卡片 -->
      <div class="cards">
        <div
          v-for="m in modules"
          :key="m.key"
          class="card"
          @click="enterModule(m.key)"
        >
          <div class="card-top">
            <div class="card-icon" :style="{ background: m.bg, color: m.color }">
              <span>{{ m.icon }}</span>
            </div>
            <svg class="card-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" :stroke="m.color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
          <div class="card-body">
            <h3>{{ m.label }}</h3>
            <p>{{ m.desc }}</p>
          </div>
          <div class="card-footer">
            <div class="cf-item" v-for="s in cardStats[m.key]" :key="s.label">
              <span class="cf-val">{{ fmtNum(s.value()) }}<small>{{ s.unit }}</small></span>
              <span class="cf-lbl">{{ s.label }}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── 背景 ── */
.entry-bg {
  min-height: 100vh;
  background: linear-gradient(160deg, #f5f0ff 0%, #fdf2f8 40%, #fefce8 100%);
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.entry-container {
  width: 100%;
  max-width: 1040px;
  background: #f3f4f6;
  border-radius: 0 0 28px 28px;
  padding: 20px 24px 24px;
  box-shadow: 0 4px 24px rgba(0,0,0,.04);
}

/* ── 横幅 ── */
.banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 28px;
  margin-bottom: 20px;
  border-radius: 20px;
  background: linear-gradient(135deg, #7c5cfc 0%, #a78bfa 60%, #c4b5fd 100%);
  color: #fff;
  position: relative;
  overflow: hidden;
}
.banner::before {
  content: '';
  position: absolute;
  width: 200px; height: 200px;
  right: -40px; top: -40px;
  background: rgba(255,255,255,.08);
  border-radius: 50%;
}
.banner::after {
  content: '';
  position: absolute;
  width: 140px; height: 140px;
  right: 100px; bottom: -60px;
  background: rgba(255,255,255,.05);
  border-radius: 50%;
}

.banner-left { position: relative; z-index: 1; }
.brand {
  display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
}
.brand-dot {
  width: 10px; height: 10px;
  background: #fff;
  border-radius: 3px;
  opacity: .9;
}
.brand-name {
  font-size: 12px; font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  opacity: .8;
}

.greeting {
  font-size: 28px; font-weight: 700;
  margin-bottom: 2px;
  line-height: 1.2;
}
.wave { display: inline-block; animation: wave 1s ease-in-out; }
@keyframes wave {
  0%,100% { transform: rotate(0); }
  20% { transform: rotate(16deg); }
  60% { transform: rotate(-8deg); }
}
.sub-date {
  font-size: 13px; opacity: .7;
}

.banner-right {
  display: flex; gap: 12px;
  position: relative; z-index: 1;
}
.pill {
  background: rgba(255,255,255,.15);
  backdrop-filter: blur(8px);
  border-radius: 14px;
  padding: 14px 20px;
  min-width: 76px;
  text-align: center;
  border: 1px solid rgba(255,255,255,.12);
}
.pill-val {
  display: block;
  font-size: 22px; font-weight: 700;
  line-height: 1.1;
}
.pill-lbl {
  display: block;
  font-size: 11px; opacity: .65;
  margin-top: 3px;
}

/* ── 卡片网格 ── */
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.card {
  background: #fff;
  border-radius: 18px;
  padding: 18px;
  cursor: pointer;
  transition: all .25s cubic-bezier(.4,0,.2,1);
  box-shadow: 0 1px 4px rgba(0,0,0,.03);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0,0,0,.04);
}
.card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 30px rgba(0,0,0,.07);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.card-icon {
  width: 40px; height: 40px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
}
.card-arrow {
  opacity: 0;
  transform: translateX(-4px);
  transition: all .25s;
}
.card:hover .card-arrow {
  opacity: 1;
  transform: translateX(0);
}

.card-body {
  flex: 1;
  margin-bottom: 10px;
}
.card-body h3 {
  font-size: 15px; font-weight: 700;
  color: #1e293b;
  margin-bottom: 3px;
}
.card-body p {
  font-size: 12px; color: #94a3b8;
}

.card-footer {
  display: flex; gap: 20px;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
}
.cf-item { display: flex; flex-direction: column; }
.cf-val {
  font-size: 18px; font-weight: 700;
  color: #1e293b;
  font-variant-numeric: tabular-nums;
}
.cf-val small {
  font-size: 10px; font-weight: 500;
  color: #94a3b8; margin-left: 2px;
}
.cf-lbl {
  font-size: 10px; color: #94a3b8;
  margin-top: 1px;
}

/* ── 响应式 ── */
@media (max-width: 900px) {
  .cards { grid-template-columns: repeat(2, 1fr); }
  .banner { flex-direction: column; gap: 20px; text-align: center; }
  .banner-right { justify-content: center; }
}
@media (max-width: 600px) {
  .cards { grid-template-columns: 1fr; }
  .entry-bg { padding: 16px; }
  .entry-container { padding: 16px; border-radius: 20px; }
}
</style>
