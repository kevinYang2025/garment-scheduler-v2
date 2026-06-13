<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import StylePicker from '../components/StylePicker.vue'

const estimations = ref([])
const loading = ref(true)
const simulating = ref(false)
const selectedStyle = ref(null)
const stylePickerRef = ref(null)

const simForm = ref({
  plan_qty: 1000,
  start_date: '',
})

const simResult = ref(null)

async function loadEstimations() {
  loading.value = true
  try {
    const { data } = await api.getEstimations()
    estimations.value = data || []
  } catch {
    ElMessage.error('加载预估记录失败')
  }
  loading.value = false
}

async function doSimulate() {
  if (!selectedStyle.value) {
    ElMessage.warning('请先选择款式')
    return
  }
  if (!simForm.value.plan_qty || simForm.value.plan_qty <= 0) {
    ElMessage.warning('请输入计划数量')
    return
  }
  simulating.value = true
  try {
    const { data } = await api.simulateEstimation({
      style_id: selectedStyle.value.id,
      style_no: selectedStyle.value.style_no,
      product_name: selectedStyle.value.product_name,
      plan_qty: simForm.value.plan_qty,
      start_date: simForm.value.start_date || undefined,
    })
    if (data.ok) {
      simResult.value = data.estimation
    } else {
      ElMessage.error(data.error || '模拟失败')
    }
  } catch {
    ElMessage.error('模拟失败')
  }
  simulating.value = false
}

async function saveEstimation() {
  if (!simResult.value) return
  try {
    await api.saveEstimation(simResult.value)
    ElMessage.success('预估记录已保存')
    simResult.value = null
    await loadEstimations()
  } catch {
    ElMessage.error('保存失败')
  }
}

async function confirmEstimation(id) {
  try {
    await ElMessageBox.confirm('确认此交期预估？确认后不可修改。')
    await api.confirmEstimation(id)
    ElMessage.success('已确认')
    await loadEstimations()
  } catch {}
}

const statusColors = { ESTIMATED: 'info', CONFIRMED: 'success', SHIPPED: 'primary' }
const statusLabels = { ESTIMATED: '预估中', CONFIRMED: '已确认', SHIPPED: '已出货' }

function formatTime(ts) {
  if (!ts) return '-'
  return ts.replace('T', ' ').slice(0, 16)
}

onMounted(loadEstimations)
</script>

<template>
  <div class="estimation-page">
    <div class="page-header-bar">
      <h2 class="page-heading">交期预估</h2>
      <p class="page-desc">输入款式和数量，自动模拟交期（考虑工作日历和产能）</p>
    </div>

    <!-- 模拟区域 -->
    <div class="sim-section">
      <h3 class="section-title">交期模拟</h3>
      <div class="sim-form">
        <div class="form-row">
          <label>选择款式</label>
          <div class="style-pick">
            <span v-if="selectedStyle">{{ selectedStyle.style_no }} - {{ selectedStyle.product_name }}</span>
            <span v-else style="color:var(--text-tertiary)">未选择</span>
            <el-button size="small" @click="stylePickerRef?.open()">选择款式</el-button>
          </div>
          <StylePicker ref="stylePickerRef" v-model="selectedStyle" />
        </div>
        <div class="form-row">
          <label>计划数量</label>
          <el-input-number v-model="simForm.plan_qty" :min="1" style="width:200px" />
        </div>
        <div class="form-row">
          <label>开始日期（默认今天）</label>
          <el-input v-model="simForm.start_date" type="date" style="width:200px" />
        </div>
        <el-button type="primary" @click="doSimulate" :loading="simulating">模拟交期</el-button>
      </div>

      <!-- 模拟结果 -->
      <div v-if="simResult" class="sim-result">
        <div class="result-header">
          <h4>模拟结果</h4>
          <el-button type="primary" size="small" @click="saveEstimation">保存预估</el-button>
        </div>
        <div class="result-cards">
          <div class="result-card">
            <div class="result-label">预估总天数</div>
            <div class="result-value">{{ simResult.estimated_days }} 天</div>
          </div>
          <div class="result-card">
            <div class="result-label">开始日期</div>
            <div class="result-value">{{ simResult.estimated_start }}</div>
          </div>
          <div class="result-card">
            <div class="result-label">预估交期</div>
            <div class="result-value" style="color:#22c55e;font-weight:700">{{ simResult.estimated_end }}</div>
          </div>
        </div>

        <div class="breakdown" v-if="simResult.breakdown">
          <h4>各阶段明细</h4>
          <div class="breakdown-steps">
            <div class="step">
              <span class="step-name">裁剪</span>
              <span class="step-days">{{ simResult.breakdown.cutting.days }}天</span>
              <span class="step-range">{{ simResult.breakdown.cutting.start }} → {{ simResult.breakdown.cutting.end }}</span>
            </div>
            <div class="step">
              <span class="step-name">挑片</span>
              <span class="step-days">{{ simResult.breakdown.picking.days }}天</span>
            </div>
            <div class="step">
              <span class="step-name">二次加工</span>
              <span class="step-days">{{ simResult.breakdown.secondary.days }}天</span>
              <span class="step-range">{{ simResult.breakdown.secondary.start }} → {{ simResult.breakdown.secondary.end }}</span>
            </div>
            <div class="step">
              <span class="step-name">缝制</span>
              <span class="step-days">{{ simResult.breakdown.sewing.days }}天</span>
              <span class="step-range">{{ simResult.breakdown.sewing.start }} → {{ simResult.breakdown.sewing.end }}</span>
            </div>
            <div class="step">
              <span class="step-name">出货缓冲</span>
              <span class="step-days">{{ simResult.breakdown.shipping_buffer.days }}天</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 历史记录 -->
    <div class="history-section">
      <h3 class="section-title">预估记录</h3>
      <el-table :data="estimations" v-loading="loading" stripe size="small">
        <el-table-column prop="style_no" label="款号" width="150" />
        <el-table-column prop="product_name" label="品名" width="120" />
        <el-table-column prop="plan_qty" label="数量" width="80" align="right" />
        <el-table-column prop="estimated_days" label="预估天数" width="90" align="right" />
        <el-table-column prop="estimated_start" label="开始" width="110" />
        <el-table-column prop="estimated_end" label="预估交期" width="110" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusColors[row.status]" size="small">{{ statusLabels[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button v-if="row.status === 'ESTIMATED'" size="small" text type="primary" @click="confirmEstimation(row.id)">确认</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.estimation-page { max-width: 1000px; }
.page-header-bar { margin-bottom: 24px; }
.page-heading { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.page-desc { font-size: 13px; color: var(--text-secondary); }

.section-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }

.sim-section {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 24px;
}
.sim-form { display: flex; flex-direction: column; gap: 12px; max-width: 500px; }
.form-row { display: flex; flex-direction: column; gap: 4px; }
.form-row label { font-size: 13px; font-weight: 500; }
.style-pick { display: flex; align-items: center; gap: 12px; }

.sim-result { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.result-header h4 { margin: 0; }
.result-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
.result-card {
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 16px;
  text-align: center;
}
.result-label { font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px; }
.result-value { font-size: 20px; font-weight: 700; }

.breakdown h4 { font-size: 14px; margin-bottom: 12px; }
.breakdown-steps { display: flex; flex-direction: column; gap: 8px; }
.step {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: var(--bg);
  border-radius: 6px;
  font-size: 13px;
}
.step-name { font-weight: 600; width: 80px; }
.step-days { color: var(--primary); font-weight: 600; width: 50px; }
.step-range { color: var(--text-secondary); font-size: 12px; }

.history-section {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}
</style>
