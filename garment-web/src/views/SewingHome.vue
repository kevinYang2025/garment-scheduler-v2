<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const router = useRouter()

const sewingCards = [
  { key: 'visual', label: '目视化班组排程', icon: '📊', desc: '甘特图拖拽排班', routeName: 'sewing-visual' },
  { key: 'plan', label: '班组缝制计划', icon: '📋', desc: '缝制工序计划与排程管理', routeName: 'sewing-plan' },
]

const summaries = ref({})
const loading = ref(true)
const scheduling = ref(false)

async function doAutoSchedule() {
  try {
    await ElMessageBox.confirm('将根据预排总计划和当前激活策略，自动分配到缝制产线。确定继续？', '一键自动排产', { type: 'info' })
  } catch { return }
  scheduling.value = true
  try {
    const { data } = await api.autoSchedule()
    if (data.ok) {
      ElMessage.success(`排产完成：${data.scheduled} 条计划已分配到产线`)
      loadSummaries()
    } else if (data.message) {
      ElMessage.info(data.message)
    } else {
      ElMessage.error(data.error || '排产失败')
    }
  } catch { ElMessage.error('自动排产失败') }
  scheduling.value = false
}

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
    const { data } = await api.getSewingSummary()
    summaries.value = data || {}
  } catch {
    summaries.value = {}
    ElMessage.error('加载缝制排程失败')
  }
  loading.value = false
}

function enterDetail(key) {
  const c = sewingCards.find(x => x.key === key)
  if (c) router.push({ name: c.routeName })
}

function formatTime(ts) {
  if (!ts) return '-'
  return ts.replace('T', ' ').slice(0, 16)
}

onMounted(loadSummaries)
</script>

<template>
  <div class="sewing-home">

    <!-- 顶部操作栏 -->
    <div class="top-actions">
      <h2 class="page-heading">缝制排程</h2>
      <el-button type="primary" size="large" @click="doAutoSchedule" :loading="scheduling">
        🚀 {{ scheduling ? '排产中...' : '一键自动排产' }}
      </el-button>
    </div>

    <div v-if="loading" class="loading">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>

    <div v-else class="card-grid">
      <div
        v-for="c in sewingCards"
        :key="c.key"
        v-show="hasPermission(`sewing:${c.key}:view`)"
        class="sewing-card"
        @click="enterDetail(c.key)"
      >
        <div class="card-icon-wrap" :style="{ background: ['#f3f0ff','#eff6ff'][sewingCards.indexOf(c) % 2] }">{{ c.icon }}</div>
        <div class="card-name">{{ c.label }}</div>
        <div class="card-desc">{{ c.desc }}</div>
        <div class="card-stats">
          <div class="stat-item">
            <span class="stat-value">{{ summaries[c.key]?.totalCount ?? 0 }}</span>
            <span class="stat-label">总任务</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ summaries[c.key]?.weekPending ?? 0 }}</span>
            <span class="stat-label">本周待处理</span>
          </div>
          <div class="stat-item overdue">
            <span class="stat-value">{{ summaries[c.key]?.overdue ?? 0 }}</span>
            <span class="stat-label">逾期任务</span>
          </div>
        </div>
        <div class="card-time">最近更新：{{ formatTime(summaries[c.key]?.lastUpdate) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sewing-home {
  max-width: 800px;
}
.top-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.page-heading {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.sewing-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px 24px;
  cursor: pointer;
  transition: all .15s ease;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
}
.sewing-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.card-icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  flex-shrink: 0;
}
.card-name { font-size: 16px; font-weight: 600; color: var(--text); }
.card-desc { font-size: 13px; color: var(--text-secondary); }
.card-stats {
  display: flex;
  gap: 24px;
  margin: 8px 0;
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
.stat-item.overdue .stat-value { color: var(--danger); }
.stat-label {
  font-size: 11px;
  color: var(--text-tertiary);
}
.card-time {
  font-size: 11px;
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
