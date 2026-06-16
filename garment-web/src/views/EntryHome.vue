<script setup>
import { ref, onMounted } from 'vue'
import { useWebSocket } from '../composables/useWebSocket'
import api from '../api'

const emit = defineEmits(['navigate'])
const { connected } = useWebSocket()

const stats = ref({ styles: 0, mainPlan: 0, sewingPending: 0, sewingOverdue: 0, todayDispatch: 0, dispatchRate: 0 })

async function loadStats() {
  try {
    const [s, p, sw] = await Promise.all([api.getStyles(''), api.getMainPlan(), api.getSewingSummary()])
    stats.value.styles = (s.data || []).length
    stats.value.mainPlan = (p.data || []).length
    stats.value.sewingPending = (sw.data || {}).plan?.totalCount || 0
    stats.value.sewingOverdue = (sw.data || {}).plan?.overdue || 0
  } catch {}
}

const _d = new Date()
const today = `${_d.getFullYear()}年${_d.getMonth()+1}月${_d.getDate()}日`
const weekdays = ['日','一','二','三','四','五','六']
const weekday = weekdays[_d.getDay()]
const rate = () => stats.value.mainPlan > 0 ? Math.min(100, Math.max(0, Math.round((1 - stats.value.sewingOverdue / Math.max(stats.value.mainPlan * 10, 1)) * 100))) : 0

const rightModules = [
  { key: 'basicData', label: '基础数据', icon: '📋', color: '#3b82f6', bg: '#dbeafe', desc: '款式、面料、车间管理',
    stats: [{ l: '款式', v: () => stats.value.styles, u: '个' }, { l: '装柜', v: () => '-', u: '条' }] },
  { key: 'planManagement', label: '计划管理', icon: '📅', color: '#8b5cf6', bg: '#ede9fe', desc: '预排总计划、排程、二次加工',
    stats: [{ l: '计划', v: () => stats.value.mainPlan, u: '个' }, { l: '待排', v: () => stats.value.sewingPending, u: '个' }] },
  { key: 'dispatch', label: '报工管理', icon: '📝', color: '#ec4899', bg: '#fce7f3', desc: '裁剪、印花、刺绣、缝制报工',
    stats: [{ l: '报工', v: () => stats.value.todayDispatch, u: '条' }, { l: '完成率', v: () => stats.value.dispatchRate, u: '%' }] },
  { key: 'config', label: '系统设置', icon: '⚙️', color: '#6b7280', bg: '#f3f4f6', desc: '工作日历、产能、排产策略',
    stats: [{ l: '状态', v: () => '服务正常', u: '' }, { l: '在线', v: () => 1, u: '人' }] },
]

function go(k) { emit('navigate', k) }
function fmt(v) { return typeof v === 'number' ? v.toLocaleString() : v }

onMounted(loadStats)
</script>

<template>
  <div class="bg">
    <div class="wrap">
      <!-- 横幅 -->
      <header class="hdr">
        <div class="hdr-l">
          <div class="hdr-brand"><span class="hdr-dot"></span><span class="hdr-name">EUC 排程系统</span></div>
          <h1>欢迎回来 👋</h1>
          <p class="hdr-date">{{ today }} 星期{{ weekday }}</p>
        </div>
        <div class="hdr-pills">
          <div class="pill" v-for="p in [{v:stats.styles,l:'款式'},{v:stats.mainPlan,l:'计划'},{v:stats.sewingPending,l:'排程'}]" :key="p.l">
            <b>{{ fmt(p.v) }}</b><span>{{ p.l }}</span>
          </div>
        </div>
      </header>

      <!-- 主体 -->
      <div class="grid">
        <!-- 左：工作台 -->
        <div class="wb" @click="go('dashboard')">
          <div class="wb-top">
            <span class="wb-ico">📊</span>
            <div><h2>工作台</h2><small>数据看板与生产概览</small></div>
          </div>
          <div class="wb-rate">
            <span class="rv">{{ rate() }}<small>%</small></span>
            <span class="rl">计划达成率</span>
          </div>
          <div class="wb-row">
            <div class="wn"><b>{{ fmt(stats.styles) }}</b><span>款式总数</span></div>
            <div class="wn"><b>{{ fmt(stats.mainPlan) }}</b><span>预排总计划</span></div>
            <div class="wn"><b>{{ fmt(stats.sewingPending) }}</b><span>待排程</span></div>
          </div>
          <div class="wb-go">进入工作台 →</div>
        </div>

        <!-- 右：4模块 -->
        <div class="right">
          <div class="mod" v-for="m in rightModules" :key="m.key" @click="go(m.key)">
            <div class="mod-ico" :style="{background:m.bg,color:m.color}">{{ m.icon }}</div>
            <div class="mod-body">
              <h3>{{ m.label }}</h3>
              <p>{{ m.desc }}</p>
            </div>
            <div class="mod-nums">
              <div class="mn" v-for="s in m.stats" :key="s.l">
                <b>{{ typeof s.v()==='number'?s.v().toLocaleString():s.v() }}<small>{{ s.u }}</small></b>
                <span>{{ s.l }}</span>
              </div>
            </div>
            <svg class="mod-arr" width="20" height="20" viewBox="0 0 24 24" fill="none" :stroke="m.color" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
* { margin:0; padding:0; box-sizing:border-box; }

.bg {
  min-height: 100vh;
  background: linear-gradient(135deg, #f0f4ff 0%, #fdf2f8 50%, #fef9ee 100%);
  padding: 20px;
  display: flex;
  justify-content: center;
}

.wrap {
  width: 100%;
  max-width: 1100px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── 横幅 ── */
.hdr {
  background: linear-gradient(135deg, #6366f1, #8b5cf6 50%, #a78bfa);
  border-radius: 20px;
  padding: 24px 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #fff;
  position: relative;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(99,102,241,.3);
}
.hdr::before { content:''; position:absolute; width:200px; height:200px; right:-40px; top:-60px; background:rgba(255,255,255,.1); border-radius:50%; }
.hdr::after { content:''; position:absolute; width:120px; height:120px; right:120px; bottom:-40px; background:rgba(255,255,255,.06); border-radius:50%; }

.hdr-l { position:relative; z-index:1; }
.hdr-brand { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
.hdr-dot { width:10px; height:10px; background:#fff; border-radius:3px; }
.hdr-name { font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; opacity:.85; }
.hdr h1 { font-size:32px; font-weight:800; line-height:1.1; margin-bottom:4px; }
.hdr-date { font-size:14px; opacity:.7; }

.hdr-pills { display:flex; gap:12px; position:relative; z-index:1; }
.pill {
  background: rgba(255,255,255,.18);
  backdrop-filter: blur(10px);
  border-radius: 14px;
  padding: 16px 24px;
  min-width: 80px;
  text-align: center;
  border: 1px solid rgba(255,255,255,.15);
}
.pill b { display:block; font-size:28px; font-weight:800; line-height:1; }
.pill span { display:block; font-size:12px; opacity:.7; margin-top:4px; }

/* ── 主体 ── */
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  flex: 1;
}

/* ── 工作台 ── */
.wb {
  background: #fff;
  border-radius: 20px;
  padding: 28px;
  cursor: pointer;
  transition: all .3s;
  box-shadow: 0 2px 12px rgba(0,0,0,.04);
  border: 1px solid rgba(0,0,0,.04);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.wb:hover { transform: translateY(-4px); box-shadow: 0 16px 48px rgba(0,0,0,.1); }

.wb-top { display:flex; align-items:center; gap:14px; margin-bottom:20px; }
.wb-ico { font-size:28px; width:52px; height:52px; display:flex; align-items:center; justify-content:center; background:#ede9fe; border-radius:14px; }
.wb-top h2 { font-size:22px; font-weight:800; color:#1e293b; }
.wb-top small { font-size:13px; color:#94a3b8; }

.wb-rate {
  background: linear-gradient(135deg, #ede9fe, #e0e7ff);
  border-radius: 16px;
  padding: 24px;
  text-align: center;
  margin-bottom: 20px;
}
.rv { display:block; font-size:56px; font-weight:900; color:#6366f1; line-height:1; }
.rv small { font-size:24px; font-weight:600; color:#94a3b8; }
.rl { display:block; font-size:14px; color:#6b7280; margin-top:6px; font-weight:500; }

.wb-row { display:flex; gap:12px; margin-bottom:16px; }
.wn {
  flex:1;
  background: #f8fafc;
  border-radius: 12px;
  padding: 16px;
  text-align: center;
}
.wn b { display:block; font-size:24px; font-weight:800; color:#1e293b; }
.wn span { display:block; font-size:12px; color:#94a3b8; margin-top:4px; }

.wb-go {
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: #6366f1;
  padding-top: 14px;
  border-top: 1px solid #f1f5f9;
}

/* ── 右侧模块 ── */
.right {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mod {
  background: #fff;
  border-radius: 16px;
  padding: 20px 24px;
  cursor: pointer;
  transition: all .3s;
  box-shadow: 0 2px 8px rgba(0,0,0,.03);
  border: 1px solid rgba(0,0,0,.04);
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}
.mod:hover { transform: translateX(4px); box-shadow: 0 8px 24px rgba(0,0,0,.08); }

.mod-ico {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.mod-body { flex:1; min-width:0; }
.mod-body h3 { font-size:18px; font-weight:700; color:#1e293b; margin-bottom:2px; }
.mod-body p { font-size:13px; color:#94a3b8; }

.mod-nums { display:flex; gap:20px; flex-shrink:0; }
.mn { display:flex; flex-direction:column; align-items:flex-end; }
.mn b { font-size:20px; font-weight:800; color:#1e293b; font-variant-numeric:tabular-nums; }
.mn b small { font-size:12px; font-weight:500; color:#94a3b8; margin-left:2px; }
.mn span { font-size:11px; color:#94a3b8; margin-top:2px; }

.mod-arr { flex-shrink:0; opacity:0; transition:all .3s; }
.mod:hover .mod-arr { opacity:1; }

@media (max-width:800px) {
  .grid { grid-template-columns:1fr; }
  .hdr { flex-direction:column; gap:16px; text-align:center; }
  .hdr-pills { justify-content:center; }
}
</style>
