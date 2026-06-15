<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const emit = defineEmits(['navigate'])

const stats = ref({ mainPlan: 0, sewingPending: 0, secondary: 0, cutting: 0 })
const loading = ref(true)

async function loadStats() {
  loading.value = true
  try {
    const [planRes, sewingRes] = await Promise.all([
      api.getMainPlan(),
      api.getSewingSummary(),
    ])
    stats.value.mainPlan = (planRes.data || []).length
    stats.value.sewingPending = (sewingRes.data || {}).plan?.totalCount || 0
  } catch { /* ignore */ }
  loading.value = false
}

const cards = [
  { key: 'mainPlan', label: '主计划', icon: '📅', desc: '管理所有款式的生产计划，反算排程日期', color: '#f5a623', bg: '#fff6e8', stat: () => stats.value.mainPlan, statLabel: '个计划' },
  { key: 'sewing', label: '缝制排程', icon: '🧵', desc: '班组缝制计划与目视化甘特图排班', color: '#7c5cfc', bg: '#f0ecff', stat: () => stats.value.sewingPending, statLabel: '个待排' },
  { key: 'secondary', label: '二次加工', icon: '🎨', desc: '印花、刺绣、模板、烫标等二次加工排程', color: '#34c77b', bg: '#e8faf0', stat: () => '-', statLabel: '' },
  { key: 'cutting', label: '裁剪排程', icon: '✂️', desc: '裁剪工序排程与产能分配', color: '#4a9eff', bg: '#eaf3ff', stat: () => '-', statLabel: '' },
]

function enterCard(key) { emit('navigate', key) }
function fmtNum(v) { return typeof v === 'number' ? v.toLocaleString() : v }

onMounted(loadStats)
</script>

<template>
  <div class="plan-home">
    <div class="page-header">
      <h2>计划管理</h2>
      <p>主计划、缝制排程、二次加工、裁剪排程</p>
    </div>
    <div class="card-grid">
      <div v-for="c in cards" :key="c.key" class="pcard" @click="enterCard(c.key)">
        <div class="pcard-icon" :style="{ background: c.bg, color: c.color }">
          <span>{{ c.icon }}</span>
        </div>
        <div class="pcard-body">
          <h3>{{ c.label }}</h3>
          <p>{{ c.desc }}</p>
        </div>
        <div class="pcard-stat" v-if="c.stat()">
          <span class="psv">{{ fmtNum(c.stat()) }}</span>
          <span class="psl">{{ c.statLabel }}</span>
        </div>
        <svg class="pcard-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" :stroke="c.color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plan-home { padding: 24px; }
.page-header { margin-bottom: 24px; }
.page-header h2 { font-size: 22px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
.page-header p { font-size: 13px; color: #94a3b8; }

.card-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }

.pcard {
  display: flex; align-items: center; gap: 16px;
  padding: 20px 22px; background: #fff; border-radius: 16px;
  cursor: pointer; transition: all .25s cubic-bezier(.4,0,.2,1);
  box-shadow: 0 1px 4px rgba(0,0,0,.03); border: 1px solid rgba(0,0,0,.04);
}
.pcard:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.07); }

.pcard-icon {
  width: 48px; height: 48px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
}
.pcard-body { flex: 1; min-width: 0; }
.pcard-body h3 { font-size: 15px; font-weight: 700; color: #1e293b; margin-bottom: 2px; }
.pcard-body p { font-size: 12px; color: #94a3b8; line-height: 1.4; }

.pcard-stat { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
.psv { font-size: 20px; font-weight: 700; color: #1e293b; }
.psl { font-size: 11px; color: #94a3b8; }

.pcard-arrow {
  flex-shrink: 0; opacity: 0; transform: translateX(-4px); transition: all .25s;
}
.pcard:hover .pcard-arrow { opacity: 1; transform: translateX(0); }

@media (max-width: 700px) { .card-grid { grid-template-columns: 1fr; } }
</style>
