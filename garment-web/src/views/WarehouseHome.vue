<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()

// [2026-06-19] F:只显示裁片库,其它库路由保留(直接访问可用)
const ALL_WAREHOUSE_TYPES = [
  { key: 'raw_material', label: '面料库', icon: '🧵', unit: '米' },
  { key: 'auxiliary', label: '辅料库', icon: '📎', unit: '个/卷' },
  { key: 'cutting_piece', label: '裁片库', icon: '✂️', unit: '片' },
  { key: 'finished', label: '成品库', icon: '📦', unit: '件' },
]
const warehouseTypes = ALL_WAREHOUSE_TYPES.filter(w => w.key === 'cutting_piece')

const summaries = ref({})
const loading = ref(true)

// TODO: 权限判断接口，后续对接实际权限系统
function hasPermission(perm) {
  // eslint-disable-next-line no-unused-vars
  const _p = perm
  return true
}

async function loadSummaries() {
  loading.value = true
  const results = {}
  for (const w of warehouseTypes) {
    try {
      const { data } = await api.getWarehouseInventory(w.key)
      const items = Array.isArray(data) ? data : []
      const totalQty = items.reduce((sum, r) => sum + (r.current_qty || 0), 0)
      const lastUpdate = items.reduce((latest, r) => {
        if (!r.updated_at) return latest
        return !latest || r.updated_at > latest ? r.updated_at : latest
      }, null)
      results[w.key] = { totalQty, lastUpdate }
    } catch {
      results[w.key] = { totalQty: 0, lastUpdate: null }
    }
  }
  summaries.value = results
  loading.value = false
}

function enterWarehouse(key) {
  router.push({ name: 'warehouse-detail', params: { type: key } })
}

function formatTime(ts) {
  if (!ts) return '-'
  return ts.replace('T', ' ').slice(0, 16)
}

onMounted(loadSummaries)
</script>

<template>
  <div class="warehouse-home">
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
        v-for="w in warehouseTypes"
        :key="w.key"
        v-show="hasPermission(`warehouse:${w.key}:view`)"
        class="warehouse-card"
        @click="enterWarehouse(w.key)"
      >
        <div class="card-top">
          <span class="card-icon-wrap" :style="{ background: ['#f3f0ff','#eff6ff','#f0fdf4','#fffbeb'][warehouseTypes.indexOf(w) % 4] }">{{ w.icon }}</span>
          <span class="card-unit">{{ w.unit }}</span>
        </div>
        <div class="card-name">{{ w.label }}</div>
        <div class="card-qty">{{ summaries[w.key]?.totalQty ?? 0 }}</div>
        <div class="card-time">最近操作：{{ formatTime(summaries[w.key]?.lastUpdate) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.warehouse-home {
  max-width: 900px;
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
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.warehouse-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  cursor: pointer;
  transition: all .15s ease;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.warehouse-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}
.card-unit {
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--border-light);
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 500;
}
.card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.card-qty {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.card-time {
  font-size: 12px;
  color: var(--text-tertiary);
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
