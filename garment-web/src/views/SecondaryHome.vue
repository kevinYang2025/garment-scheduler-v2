<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()

const secondaryTypes = [
  { key: 'printing', label: '印花排程', icon: '🎨', routeName: 'printing-plan' },
  { key: 'embroidery', label: '刺绣排程', icon: '🧵', routeName: 'embroidery-plan' },
  { key: 'template', label: '模板排程', icon: '📐', routeName: 'template-plan' },
  { key: 'ironing', label: '烫标排程', icon: '🔥', routeName: 'ironing-plan' },
]

const summaries = ref({})
const loading = ref(true)

// TODO: 权限判断接口，后续对接实际权限系统
// 每个排程模块独立权限：view/edit/import/export
function hasPermission(perm) {
  // eslint-disable-next-line no-unused-vars
  const _p = perm
  return true
}

async function loadSummaries() {
  loading.value = true
  try {
    const { data } = await api.getSecondarySummary()
    summaries.value = data || {}
  } catch {
    summaries.value = {}
  }
  loading.value = false
}

function enterDetail(key) {
  const t = secondaryTypes.find(x => x.key === key)
  if (t) router.push({ name: t.routeName })
}

function formatTime(ts) {
  if (!ts) return '-'
  return ts.replace('T', ' ').slice(0, 16)
}

onMounted(loadSummaries)
</script>

<template>
  <div class="secondary-home">
    <div class="page-header">
      <button class="back-btn" @click="router.push('/')">
        <span class="back-arrow">←</span> 返回工作台
      </button>
    </div>

    <div v-if="loading" class="loading">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>

    <div v-else class="card-grid">
      <div
        v-for="t in secondaryTypes"
        :key="t.key"
        v-show="hasPermission(`secondary:${t.key}:view`)"
        class="secondary-card"
        @click="enterDetail(t.key)"
      >
        <div class="card-icon-wrap" :style="{ background: ['#f3f0ff','#f0fdf4','#eff6ff','#fffbeb'][secondaryTypes.indexOf(t) % 4] }">{{ t.icon }}</div>
        <div class="card-name">{{ t.label }}</div>
        <div class="card-stats">
          <div class="stat-item">
            <span class="stat-value">{{ summaries[t.key]?.weekPending ?? 0 }}</span>
            <span class="stat-label">本周待处理</span>
          </div>
          <div class="stat-item overdue">
            <span class="stat-value">{{ summaries[t.key]?.overdue ?? 0 }}</span>
            <span class="stat-label">逾期任务</span>
          </div>
        </div>
        <div class="card-time">最近更新：{{ formatTime(summaries[t.key]?.lastUpdate) }}</div>
        <div class="card-action">
          <button class="enter-btn" @click.stop="enterDetail(t.key)">进入管理</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.secondary-home {
  max-width: 1000px;
}
.page-header {
  margin-bottom: 24px;
}
.back-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  padding: 0;
  margin-bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: var(--transition);
}
.back-btn:hover { color: var(--primary); }
.back-arrow { font-size: 14px; }
.page-header h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}
.page-header p {
  font-size: 13px;
  color: var(--text-secondary);
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.secondary-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px 20px;
  cursor: pointer;
  transition: all .15s ease;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
}
.secondary-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.card-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
}
.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.card-stats {
  display: flex;
  gap: 24px;
  margin: 4px 0;
}
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.stat-item.overdue .stat-value {
  color: var(--danger);
}
.stat-label {
  font-size: 11px;
  color: var(--text-tertiary);
}
.card-time {
  font-size: 11px;
  color: var(--text-tertiary);
}
.card-action {
  margin-top: 4px;
  width: 100%;
}
.enter-btn {
  width: 100%;
  padding: 8px 0;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s ease;
}
.enter-btn:hover {
  background: var(--primary-hover);
}

.loading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-secondary);
  padding: 40px 0;
}
.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
