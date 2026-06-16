<script setup>
import { ref, onMounted } from 'vue'
import { useWebSocket } from '../composables/useWebSocket'
import api from '../api'

const emit = defineEmits(['navigate'])
const { connected } = useWebSocket()

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
    const [stylesRes, planRes, sewingRes] = await Promise.all([
      api.getStyles(''),
      api.getMainPlan(),
      api.getSewingSummary(),
    ])
    stats.value.styles = (stylesRes.data || []).length
    stats.value.mainPlan = (planRes.data || []).length
    stats.value.sewingPending = (sewingRes.data || {}).plan?.totalCount || 0
    stats.value.sewingOverdue = (sewingRes.data || {}).plan?.overdue || 0
  } catch { /* ignore */ }
  loading.value = false
}

const _d = new Date()
const today = `${_d.getFullYear()}年${_d.getMonth()+1}月${_d.getDate()}日`
const weekdays = ['日','一','二','三','四','五','六']
const weekday = weekdays[_d.getDay()]

const modules = [
  { key: 'basicData', label: '基础数据', icon: '📋', color: '#4a9eff', bg: '#eaf3ff', desc: '款式、面料、车间管理' },
  { key: 'planManagement', label: '计划管理', icon: '📅', color: '#f5a623', bg: '#fff6e8', desc: '预排总计划、排程、二次加工' },
  { key: 'dispatch', label: '报工管理', icon: '📝', color: '#a78bfa', bg: '#f3eeff', desc: '裁剪、印花、刺绣、缝制报工' },
  { key: 'config', label: '系统设置', icon: '⚙️', color: '#8e99a4', bg: '#f4f5f7', desc: '工作日历、产能、排产策略' },
]

const cardStats = {
  basicData: [
    { label: '款式', value: () => stats.value.styles, unit: '个' },
    { label: '装柜', value: () => '-', unit: '条' },
  ],
  planManagement: [
    { label: '计划', value: () => stats.value.mainPlan, unit: '个' },
    { label: '待排', value: () => stats.value.sewingPending, unit: '个' },
  ],
  dispatch: [
    { label: '报工', value: () => stats.value.todayDispatch, unit: '条' },
    { label: '完成率', value: () => stats.value.dispatchRate, unit: '%' },
  ],
  config: [
    { label: '状态', value: () => '服务正常', unit: '', isStatus: true },
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

      <!-- 主体：左侧工作台 + 右侧模块 -->
      <div class="main-grid">

        <!-- 左侧：工作台大卡片 -->
        <div class="workbench-card" @click="enterModule('dashboard')">
          <div class="wb-header">
            <div class="wb-icon">📊</div>
            <div>
              <h2>工作台</h2>
              <p>数据看板与生产概览</p>
            </div>
          </div>
          <div class="wb-metrics">
            <div class="wb-metric main-metric">
              <div class="wb-mv">{{ stats.mainPlan > 0 ? Math.round((1 - stats.sewingOverdue / (stats.mainPlan * 10)) * 100) : '--' }}<small v-if="stats.mainPlan > 0">%</small></div>
              <div class="wb-ml">计划达成率</div>
            </div>
            <div class="wb-metric">
              <div class="wb-mv">{{ fmtNum(stats.styles) }}<small>个</small></div>
              <div class="wb-ml">款式总数</div>
            </div>
            <div class="wb-metric">
              <div class="wb-mv">{{ fmtNum(stats.mainPlan) }}<small>个</small></div>
              <div class="wb-ml">预排总计划</div>
            </div>
            <div class="wb-metric">
              <div class="wb-mv">{{ fmtNum(stats.sewingPending) }}<small>个</small></div>
              <div class="wb-ml">待排程</div>
            </div>
          </div>
          <div class="wb-footer">
            <span>进入工作台 →</span>
          </div>
        </div>

        <!-- 右侧：4个模块卡片 -->
        <div class="side-cards">
          <div
            v-for="m in modules"
            :key="m.key"
            class="scard"
            @click="enterModule(m.key)"
          >
            <div class="sc-left">
              <div class="sc-icon" :style="{ background: m.bg, color: m.color }">
                <span>{{ m.icon }}</span>
              </div>
              <div class="sc-text">
                <h3>{{ m.label }}</h3>
                <p>{{ m.desc }}</p>
              </div>
            </div>
            <div class="sc-stats">
              <div class="sc-stat" v-for="s in cardStats[m.key]" :key="s.label">
                <span class="sc-sv">
                  <span v-if="s.isStatus" class="status-dot" :class="connected ? 'online' : 'offline'"></span>
                  {{ typeof s.value() === 'number' ? s.value().toLocaleString() : s.value() }}<small>{{ s.unit }}</small>
                </span>
                <span class="sc-sl">{{ s.label }}</span>
              </div>
            </div>
            <svg class="sc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" :stroke="m.color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.entry-bg {
  min-height: 100vh;
  background: linear-gradient(160deg, #f5f0ff 0%, #fdf2f8 40%, #fefce8 100%);
  padding: 0;
  display: flex;
  justify-content: center;
}
.entry-container {
  width: 100%;
  max-width: 1080px;
  background: #f3f4f6;
  border-radius: 0 0 28px 28px;
  padding: 20px 24px 24px;
  box-shadow: 0 4px 24px rgba(0,0,0,.04);
}

/* ── 横幅 ── */
.banner {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 28px; margin-bottom: 20px; border-radius: 20px;
  background: linear-gradient(135deg, #7c5cfc 0%, #a78bfa 60%, #c4b5fd 100%);
  color: #fff; position: relative; overflow: hidden;
}
.banner::before { content:''; position:absolute; width:200px; height:200px; right:-40px; top:-40px; background:rgba(255,255,255,.08); border-radius:50%; }
.banner::after { content:''; position:absolute; width:140px; height:140px; right:100px; bottom:-60px; background:rgba(255,255,255,.05); border-radius:50%; }
.banner-left { position:relative; z-index:1; }
.brand { display:flex; align-items:center; gap:8px; margin-bottom:14px; }
.brand-dot { width:10px; height:10px; background:#fff; border-radius:3px; opacity:.9; }
.brand-name { font-size:12px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; opacity:.8; }
.greeting { font-size:28px; font-weight:700; margin-bottom:2px; line-height:1.2; }
.wave { display:inline-block; animation:wave 1s ease-in-out; }
@keyframes wave { 0%,100%{transform:rotate(0)} 20%{transform:rotate(16deg)} 60%{transform:rotate(-8deg)} }
.sub-date { font-size:13px; opacity:.7; }
.banner-right { display:flex; gap:12px; position:relative; z-index:1; }
.pill { background:rgba(255,255,255,.15); backdrop-filter:blur(8px); border-radius:14px; padding:14px 20px; min-width:76px; text-align:center; border:1px solid rgba(255,255,255,.12); }
.pill-val { display:block; font-size:22px; font-weight:700; line-height:1.1; }
.pill-lbl { display:block; font-size:11px; opacity:.65; margin-top:3px; }

/* ── 主体网格 ── */
.main-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* ── 左侧工作台 ── */
.workbench-card {
  background: #fff; border-radius: 18px; padding: 24px;
  cursor: pointer; transition: all .25s cubic-bezier(.4,0,.2,1);
  box-shadow: 0 1px 4px rgba(0,0,0,.03); border: 1px solid rgba(0,0,0,.04);
  display: flex; flex-direction: column;
}
.workbench-card:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(0,0,0,.08); }

.wb-header { display:flex; align-items:center; gap:14px; margin-bottom:20px; }
.wb-icon { font-size:28px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; background:#f0ecff; border-radius:14px; }
.wb-header h2 { font-size:18px; font-weight:700; color:#1e293b; margin-bottom:2px; }
.wb-header p { font-size:12px; color:#94a3b8; }

.wb-metrics { display:grid; grid-template-columns:1fr 1fr; gap:16px; flex:1; margin-bottom:16px; }
.wb-metric { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px; background:#f8f9fa; border-radius:14px; }
.wb-metric.main-metric { grid-column:1/3; background:linear-gradient(135deg, #ede9fe, #f0ecff); }
.wb-mv { font-size:32px; font-weight:700; color:#1e293b; font-variant-numeric:tabular-nums; }
.main-metric .wb-mv { font-size:48px; color:#6366f1; }
.wb-mv small { font-size:14px; font-weight:500; color:#94a3b8; margin-left:2px; }
.main-metric .wb-mv small { font-size:18px; }
.wb-ml { font-size:12px; color:#94a3b8; margin-top:4px; }

.wb-footer { text-align:center; padding-top:12px; border-top:1px solid #f1f5f9; font-size:13px; color:#6366f1; font-weight:500; }

/* ── 右侧模块卡片 ── */
.side-cards { display:flex; flex-direction:column; gap:12px; }
.scard {
  background:#fff; border-radius:16px; padding:18px 20px;
  cursor:pointer; transition:all .25s cubic-bezier(.4,0,.2,1);
  box-shadow:0 1px 4px rgba(0,0,0,.03); border:1px solid rgba(0,0,0,.04);
  display:flex; align-items:center; gap:14px;
}
.scard:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.07); }

.sc-left { display:flex; align-items:center; gap:12px; flex:1; min-width:0; }
.sc-icon { width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }
.sc-text h3 { font-size:14px; font-weight:700; color:#1e293b; margin-bottom:1px; }
.sc-text p { font-size:11px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.sc-stats { display:flex; gap:16px; flex-shrink:0; }
.sc-stat { display:flex; flex-direction:column; align-items:flex-end; }
.sc-sv { font-size:16px; font-weight:700; color:#1e293b; font-variant-numeric:tabular-nums; display:flex; align-items:center; gap:4px; }
.sc-sv small { font-size:10px; font-weight:500; color:#94a3b8; }
.sc-sl { font-size:10px; color:#94a3b8; }

.sc-arrow { flex-shrink:0; opacity:0; transform:translateX(-4px); transition:all .25s; }
.scard:hover .sc-arrow { opacity:1; transform:translateX(0); }

.status-dot { width:6px; height:6px; border-radius:50%; }
.status-dot.online { background:#22c55e; }
.status-dot.offline { background:#ef4444; }

/* ── 响应式 ── */
@media (max-width: 800px) {
  .main-grid { grid-template-columns:1fr; }
  .banner { flex-direction:column; gap:16px; text-align:center; }
  .banner-right { justify-content:center; }
}
</style>
