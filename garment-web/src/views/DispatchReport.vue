<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const reports = ref([])
const loading = ref(true)
const filters = ref({
  schedule_type: '',
  style_no: '',
  date_from: '',
  date_to: '',
})

const scheduleTypes = [
  { value: '', label: '全部类型' },
  { value: 'sewing', label: '缝制' },
  { value: 'cutting', label: '裁剪' },
  { value: 'secondary', label: '二次加工' },
]

// 汇总统计
const summary = ref({ totalCompleted: 0, totalDefects: 0, qualityRate: 0, recordCount: 0 })

async function loadReports() {
  loading.value = true
  try {
    const params = {}
    if (filters.value.schedule_type) params.schedule_type = filters.value.schedule_type
    if (filters.value.style_no) params.style_no = filters.value.style_no
    if (filters.value.date_from) params.date_from = filters.value.date_from
    if (filters.value.date_to) params.date_to = filters.value.date_to
    const { data } = await api.getDispatchSummary(params)
    reports.value = data || []
    // 计算汇总
    let totalCompleted = 0, totalDefects = 0
    for (const r of reports.value) {
      totalCompleted += r.total_completed || 0
      totalDefects += r.total_defects || 0
    }
    summary.value = {
      totalCompleted,
      totalDefects,
      qualityRate: totalCompleted + totalDefects > 0
        ? Math.round(totalCompleted * 100 / (totalCompleted + totalDefects) * 10) / 10
        : 0,
      recordCount: reports.value.length,
    }
  } catch {
    ElMessage.error('加载报工汇总失败')
  }
  loading.value = false
}

function handleFilter() {
  loadReports()
}

onMounted(loadReports)
</script>

<template>
  <div class="dispatch-page">
    <div class="page-header-bar">
      <h2 class="page-heading">报工汇总</h2>
      <p class="page-desc">按日期/款号/班组汇总生产数据</p>
    </div>

    <!-- 汇总卡片 -->
    <div class="summary-cards">
      <div class="summary-card">
        <div class="card-value">{{ summary.totalCompleted.toLocaleString() }}</div>
        <div class="card-label">总完成量</div>
      </div>
      <div class="summary-card">
        <div class="card-value" style="color:#ef4444">{{ summary.totalDefects.toLocaleString() }}</div>
        <div class="card-label">总次品数</div>
      </div>
      <div class="summary-card">
        <div class="card-value" style="color:#22c55e">{{ summary.qualityRate }}%</div>
        <div class="card-label">合格率</div>
      </div>
      <div class="summary-card">
        <div class="card-value">{{ summary.recordCount }}</div>
        <div class="card-label">记录数</div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-select v-model="filters.schedule_type" placeholder="类型" clearable style="width:120px" @change="handleFilter">
        <el-option v-for="o in scheduleTypes" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-input v-model="filters.style_no" placeholder="款号搜索" clearable style="width:160px" @change="handleFilter" />
      <el-date-picker v-model="filters.date_from" type="date" placeholder="开始日期" value-format="YYYY-MM-DD" style="width:140px" @change="handleFilter" />
      <el-date-picker v-model="filters.date_to" type="date" placeholder="结束日期" value-format="YYYY-MM-DD" style="width:140px" @change="handleFilter" />
      <el-button @click="loadReports" :icon="'Refresh'" circle />
    </div>

    <!-- 表格 -->
    <el-table :data="reports" v-loading="loading" stripe size="small" style="width:100%">
      <el-table-column prop="production_date" label="日期" width="110" />
      <el-table-column prop="style_no" label="款号" min-width="120" show-overflow-tooltip />
      <el-table-column prop="workshop" label="车间" width="80" />
      <el-table-column prop="line_team" label="班组" width="80" />
      <el-table-column prop="total_completed" label="完成量" width="90" align="right">
        <template #default="{ row }">
          <span style="font-weight:600">{{ row.total_completed?.toLocaleString() }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="total_defects" label="次品" width="80" align="right">
        <template #default="{ row }">
          <span :style="{ color: row.total_defects > 0 ? '#ef4444' : '' }">{{ row.total_defects }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="quality_rate" label="合格率" width="90" align="right">
        <template #default="{ row }">
          <span :style="{ color: row.quality_rate >= 95 ? '#22c55e' : row.quality_rate >= 90 ? '#eab308' : '#ef4444', fontWeight: 600 }">
            {{ row.quality_rate }}%
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="record_count" label="记录数" width="70" align="right" />
    </el-table>
  </div>
</template>

<style scoped>
.dispatch-page { max-width: 1100px; }
.page-header-bar { margin-bottom: 20px; }
.page-heading { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.page-desc { font-size: 13px; color: var(--text-secondary); }

.summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
.summary-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
}
.card-value { font-size: 28px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.card-label { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }

.filter-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
</style>
