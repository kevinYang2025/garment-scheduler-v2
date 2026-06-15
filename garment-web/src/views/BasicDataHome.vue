<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const emit = defineEmits(['navigate'])

const stats = ref({ styles: 0, fabricList: 0, workshops: 0 })
const loading = ref(true)

async function loadStats() {
  loading.value = true
  try {
    const [stylesRes, fabricRes] = await Promise.all([
      api.getStyles(''),
      api.get('/fabric-loading'),
    ])
    stats.value.styles = (stylesRes.data || []).length
    stats.value.fabricList = (fabricRes.data || []).length
  } catch { /* ignore */ }
  loading.value = false
}

const cards = [
  { key: 'styles', label: '款式管理', icon: '🏷️', desc: '管理所有款式的颜色、尺码、工艺等信息', color: '#4a9eff', bg: '#eaf3ff', stat: () => stats.value.styles, statLabel: '个款式' },
  { key: 'sewingWorkshop', label: '缝制车间管理', icon: '🏭', desc: '管理车间、班组、产线信息', color: '#34c77b', bg: '#e8faf0', stat: () => '-', statLabel: '' },
  { key: 'preWorkshopOutput', label: '前置车间产量管理', icon: '⚙️', desc: '设置裁剪、印花、刺绣、模板、烫标的标准日产量', color: '#f59e0b', bg: '#fef3c7', stat: () => '-', statLabel: '' },
  { key: 'styleColorSize', label: '分色分尺码', icon: '📐', desc: '按颜色和尺码拆分款式数量', color: '#a78bfa', bg: '#f3eeff', stat: () => '-', statLabel: '' },
]

function enterCard(key) { emit('navigate', key) }
function fmtNum(v) { return typeof v === 'number' ? v.toLocaleString() : v }

onMounted(loadStats)
</script>

<template>
  <div class="basic-home">
    <div class="page-header">
      <h2>基础数据</h2>
      <p>管理款式、面料、车间等基础信息</p>
    </div>
    <div class="card-grid">
      <div v-for="c in cards" :key="c.key" class="bcard" @click="enterCard(c.key)">
        <div class="bcard-icon" :style="{ background: c.bg, color: c.color }">
          <span>{{ c.icon }}</span>
        </div>
        <div class="bcard-body">
          <h3>{{ c.label }}</h3>
          <p>{{ c.desc }}</p>
        </div>
        <div class="bcard-stat" v-if="c.stat()">
          <span class="bsv">{{ fmtNum(c.stat()) }}</span>
          <span class="bsl">{{ c.statLabel }}</span>
        </div>
        <svg class="bcard-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" :stroke="c.color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.basic-home {
  padding: 24px;
}
.page-header {
  margin-bottom: 24px;
}
.page-header h2 {
  font-size: 22px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 4px;
}
.page-header p {
  font-size: 13px;
  color: #94a3b8;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.bcard {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 22px;
  background: #fff;
  border-radius: 16px;
  cursor: pointer;
  transition: all .25s cubic-bezier(.4,0,.2,1);
  box-shadow: 0 1px 4px rgba(0,0,0,.03);
  border: 1px solid rgba(0,0,0,.04);
}
.bcard:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,.07);
}

.bcard-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.bcard-body {
  flex: 1;
  min-width: 0;
}
.bcard-body h3 {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 2px;
}
.bcard-body p {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.bcard-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
}
.bsv {
  font-size: 20px;
  font-weight: 700;
  color: #1e293b;
}
.bsl {
  font-size: 11px;
  color: #94a3b8;
}

.bcard-arrow {
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(-4px);
  transition: all .25s;
}
.bcard:hover .bcard-arrow {
  opacity: 1;
  transform: translateX(0);
}

@media (max-width: 700px) {
  .card-grid { grid-template-columns: 1fr; }
}
</style>
