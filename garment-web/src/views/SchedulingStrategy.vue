<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const strategies = ref([])
const precheckResult = ref(null)
const loading = ref(true)
const scheduling = ref(false)
const prechecking = ref(false)
const scheduleResult = ref(null)

const ruleTypes = {
  due_date: '交期优先',
  batch_size: '批量优先',
  balanced: '均衡排产',
}

async function loadStrategies() {
  loading.value = true
  try {
    const { data } = await api.getStrategies()
    strategies.value = data || []
  } catch { ElMessage.error('加载策略失败') }
  loading.value = false
}

async function activateStrategy(id) {
  try {
    for (const s of strategies.value) {
      await api.updateStrategy(s.id, { ...s, active: s.id === id ? 1 : 0, config: typeof s.config === 'string' ? JSON.parse(s.config) : s.config })
    }
    ElMessage.success('已激活')
    await loadStrategies()
  } catch { ElMessage.error('激活失败') }
}

async function doAutoSchedule() {
  scheduling.value = true
  scheduleResult.value = null
  try {
    const { data } = await api.autoSchedule()
    scheduleResult.value = data
    if (data.ok) {
      ElMessage.success(`自动排产完成：${data.scheduled} 条计划已分配到产线`)
    } else if (data.message) {
      ElMessage.info(data.message)
    } else {
      ElMessage.error(data.error || '排产失败')
    }
  } catch { ElMessage.error('自动排产失败') }
  scheduling.value = false
}

async function doPrecheck() {
  prechecking.value = true
  try {
    const { data } = await api.capacityPrecheck()
    precheckResult.value = data
  } catch { ElMessage.error('产能预排失败') }
  prechecking.value = false
}

onMounted(loadStrategies)
</script>

<template>
  <div class="strategy-page">
    <div class="page-header-bar">
      <h2 class="page-heading">排产策略</h2>
      <p class="page-desc">配置排产规则，一键自动排产，产能预排验证</p>
    </div>

    <!-- 一键操作区 -->
    <div class="action-section">
      <div class="action-card">
        <h3>🚀 一键自动排产</h3>
        <p>根据当前激活的策略，自动将未排产的预排总计划分配到产线</p>
        <el-button type="primary" size="large" @click="doAutoSchedule" :loading="scheduling">
          {{ scheduling ? '排产中...' : '开始自动排产' }}
        </el-button>
      </div>
      <div class="action-card">
        <h3>📊 产能预排验证</h3>
        <p>检查待排产计划的产能可行性，发现瓶颈和风险</p>
        <el-button type="warning" size="large" @click="doPrecheck" :loading="prechecking">
          {{ prechecking ? '验证中...' : '开始产能验证' }}
        </el-button>
      </div>
    </div>

    <!-- 排产结果 -->
    <div v-if="scheduleResult" class="result-section">
      <h3>排产结果</h3>
      <div v-if="scheduleResult.ok" class="result-success">
        <el-tag type="success" size="large">排产成功</el-tag>
        <span>策略：{{ scheduleResult.strategy }} | 分配：{{ scheduleResult.scheduled }} 条</span>
      </div>
      <div v-else class="result-error">
        <el-tag type="danger" size="large">排产失败</el-tag>
        <span>{{ scheduleResult.error || scheduleResult.message }}</span>
      </div>
    </div>

    <!-- 产能预排结果 -->
    <div v-if="precheckResult && precheckResult.ok" class="precheck-section">
      <h3>产能预排报告</h3>
      <div class="precheck-summary">
        <span>待排产：{{ precheckResult.plans.length }} 条</span>
        <span>可用产线：{{ precheckResult.lineCount }} 条</span>
        <span>缝制日产能：{{ precheckResult.dailyCapacity }} 件/线</span>
      </div>
      <el-table :data="precheckResult.plans" stripe size="small" style="margin-top:12px">
        <el-table-column prop="style_no" label="款号" width="150" />
        <el-table-column prop="plan_qty" label="计划数量" width="100" align="right" />
        <el-table-column prop="sewing_days" label="缝制天数" width="90" align="right" />
        <el-table-column prop="parallel_days" label="并行天数" width="90" align="right" />
        <el-table-column prop="due_date" label="交期" width="110" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.warning" type="warning" size="small">{{ row.warning }}</el-tag>
            <el-tag v-else type="success" size="small">可行</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 策略列表 -->
    <div class="strategies-section">
      <h3>排产策略列表</h3>
      <div class="strategy-cards">
        <div v-for="s in strategies" :key="s.id" class="strategy-card" :class="{ active: s.active }">
          <div class="strategy-header">
            <span class="strategy-name">{{ s.name }}</span>
            <el-tag v-if="s.active" type="success" size="small">当前激活</el-tag>
          </div>
          <div class="strategy-type">{{ ruleTypes[s.rule_type] || s.rule_type }}</div>
          <div class="strategy-desc">{{ s.description }}</div>
          <el-button v-if="!s.active" size="small" type="primary" @click="activateStrategy(s.id)">激活</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.strategy-page { max-width: 1100px; }
.page-header-bar { margin-bottom: 24px; }
.page-heading { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.page-desc { font-size: 13px; color: var(--text-secondary); }

.action-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
.action-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  text-align: center;
}
.action-card h3 { font-size: 16px; margin-bottom: 8px; }
.action-card p { font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; }

.result-section, .precheck-section {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 24px;
}
.result-section h3, .precheck-section h3, .strategies-section h3 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.result-success, .result-error { display: flex; align-items: center; gap: 12px; }
.precheck-summary { display: flex; gap: 20px; font-size: 13px; color: var(--text-secondary); }

.strategies-section {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.strategy-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.strategy-card {
  border: 2px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  transition: all .15s;
}
.strategy-card.active { border-color: var(--primary); background: var(--primary-light); }
.strategy-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.strategy-name { font-size: 16px; font-weight: 600; }
.strategy-type { font-size: 12px; color: var(--primary); margin-bottom: 8px; }
.strategy-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
</style>
