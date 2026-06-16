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

      <!-- 横幅 -->
      <div class="banner">
        <div class="banner-left">
          <div class="brand"><span class="brand-dot"></span><span class="brand-name">EUC 排程系统</span></div>
          <h1 class="greeting">欢迎回来 <span class="wave">👋</span></h1>
          <p class="sub-date">{{ today }} 星期{{ weekday }}</p>
        </div>
        <div class="banner-right">
          <div class="pill" v-for="s in [{ v: stats.styles, l: '款式' }, { v: stats.mainPlan, l: '计划' }, { v: stats.sewingPending, l: '排程' }]" :key="s.l">
            <span class="pill-val">{{ fmtNum(s.v) }}</span>
            <span class="pill-lbl">{{ s.l }}</span>
          </div>
        </div>
      </div>

      <!-- 主体 -->
      <div class="main-grid">
        <!-- 左：工作台 -->
        <div class="wb" @click="enterModule('dashboard')">
          <div class="wb-head"><span class="wb-icon">📊</span><div><h2>工作台</h2><p>数据看板与生产概览</p></div></div>
          <div class="wb-rate">
            <span class="rate-val">{{ stats.mainPlan > 0 ? Math.round((1 - stats.sewingOverdue / (stats.mainPlan * 10)) * 100) : '--' }}<small v-if="stats.mainPlan > 0">%</small></span>
            <span class="rate-lbl">计划达成率</span>
          </div>
          <div class="wb-row">
            <div class="wb-num"><span class="wn">{{ fmtNum(stats.styles) }}</span><span class="wl">款式</span></div>
            <div class="wb-num"><span class="wn">{{ fmtNum(stats.mainPlan) }}</span><span class="wl">计划</span></div>
            <div class="wb-num"><span class="wn">{{ fmtNum(stats.sewingPending) }}</span><span class="wl">待排</span></div>
          </div>
          <div class="wb-go">进入工作台 →</div>
        </div>

        <!-- 右：4卡片 -->
        <div class="side">
          <div v-for="m in modules" :key="m.key" class="sc" @click="enterModule(m.key)">
            <div class="sc-icon" :style="{ background: m.bg, color: m.color }"><span>{{ m.icon }}</span></div>
            <div class="sc-body">
              <h3>{{ m.label }}</h3>
              <p>{{ m.desc }}</p>
            </div>
            <div class="sc-stats">
              <div class="ss" v-for="s in cardStats[m.key]" :key="s.label">
                <span class="sv"><span v-if="s.isStatus" class="dot" :class="connected?'on':'off'"></span>{{ typeof s.value()==='number'?s.value().toLocaleString():s.value() }}<small>{{ s.unit }}</small></span>
                <span class="sl">{{ s.label }}</span>
              </div>
            </div>
            <svg class="sc-arr" width="16" height="16" viewBox="0 0 24 24" fill="none" :stroke="m.color" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entry-bg { height:100vh; background:linear-gradient(160deg,#f5f0ff 0%,#fdf2f8 40%,#fefce8 100%); display:flex; justify-content:center; overflow:hidden; }
.entry-container { width:100%; max-width:1080px; background:#f3f4f6; border-radius:0 0 28px 28px; padding:16px 20px 20px; box-shadow:0 4px 24px rgba(0,0,0,.04); display:flex; flex-direction:column; overflow:hidden; }

/* 横幅 */
.banner { display:flex; justify-content:space-between; align-items:center; padding:14px 24px; margin-bottom:14px; border-radius:16px; background:linear-gradient(135deg,#7c5cfc,#a78bfa 60%,#c4b5fd); color:#fff; position:relative; overflow:hidden; }
.banner::before { content:''; position:absolute; width:160px; height:160px; right:-30px; top:-30px; background:rgba(255,255,255,.08); border-radius:50%; }
.banner-left { position:relative; z-index:1; }
.brand { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
.brand-dot { width:8px; height:8px; background:#fff; border-radius:2px; opacity:.9; }
.brand-name { font-size:11px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; opacity:.8; }
.greeting { font-size:24px; font-weight:700; margin-bottom:2px; line-height:1.2; }
.wave { display:inline-block; animation:wave 1s ease-in-out; }
@keyframes wave { 0%,100%{transform:rotate(0)} 20%{transform:rotate(16deg)} 60%{transform:rotate(-8deg)} }
.sub-date { font-size:12px; opacity:.7; }
.banner-right { display:flex; gap:10px; position:relative; z-index:1; }
.pill { background:rgba(255,255,255,.15); backdrop-filter:blur(8px); border-radius:12px; padding:10px 16px; min-width:64px; text-align:center; border:1px solid rgba(255,255,255,.12); }
.pill-val { display:block; font-size:20px; font-weight:700; line-height:1.1; }
.pill-lbl { display:block; font-size:10px; opacity:.65; margin-top:2px; }

/* 主体 */
.main-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; flex:1; }

/* 工作台 */
.wb { background:#fff; border-radius:16px; padding:18px; cursor:pointer; transition:all .25s; box-shadow:0 1px 4px rgba(0,0,0,.03); border:1px solid rgba(0,0,0,.04); display:flex; flex-direction:column; }
.wb:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.07); }
.wb-head { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
.wb-icon { font-size:22px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; background:#f0ecff; border-radius:10px; }
.wb-head h2 { font-size:16px; font-weight:700; color:#1e293b; }
.wb-head p { font-size:11px; color:#94a3b8; }

.wb-rate { background:linear-gradient(135deg,#ede9fe,#f0ecff); border-radius:12px; padding:14px; text-align:center; margin-bottom:12px; }
.rate-val { display:block; font-size:36px; font-weight:700; color:#6366f1; }
.rate-val small { font-size:16px; font-weight:500; color:#94a3b8; }
.rate-lbl { display:block; font-size:11px; color:#94a3b8; margin-top:2px; }

.wb-row { display:flex; gap:8px; margin-bottom:10px; }
.wb-num { flex:1; background:#f8f9fa; border-radius:10px; padding:10px; text-align:center; }
.wn { display:block; font-size:18px; font-weight:700; color:#1e293b; }
.wl { display:block; font-size:10px; color:#94a3b8; margin-top:2px; }

.wb-go { text-align:center; font-size:12px; color:#6366f1; font-weight:500; padding-top:8px; border-top:1px solid #f1f5f9; }

/* 右侧卡片 */
.side { display:flex; flex-direction:column; gap:10px; }
.sc { background:#fff; border-radius:14px; padding:14px 16px; cursor:pointer; transition:all .25s; box-shadow:0 1px 4px rgba(0,0,0,.03); border:1px solid rgba(0,0,0,.04); display:flex; align-items:center; gap:12px; flex:1; }
.sc:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(0,0,0,.06); }

.sc-icon { width:38px; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:17px; flex-shrink:0; }
.sc-body { flex:1; min-width:0; }
.sc-body h3 { font-size:14px; font-weight:700; color:#1e293b; margin-bottom:1px; }
.sc-body p { font-size:11px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.sc-stats { display:flex; gap:14px; flex-shrink:0; }
.ss { display:flex; flex-direction:column; align-items:flex-end; }
.sv { font-size:14px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:3px; }
.sv small { font-size:9px; font-weight:500; color:#94a3b8; }
.sl { font-size:9px; color:#94a3b8; }
.dot { width:5px; height:5px; border-radius:50%; }
.dot.on { background:#22c55e; }
.dot.off { background:#ef4444; }

.sc-arr { flex-shrink:0; opacity:0; transform:translateX(-3px); transition:all .25s; }
.sc:hover .sc-arr { opacity:1; transform:translateX(0); }

@media (max-width:800px) { .main-grid { grid-template-columns:1fr; } .banner { flex-direction:column; gap:12px; text-align:center; } .banner-right { justify-content:center; } }
</style>
