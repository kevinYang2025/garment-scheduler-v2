<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const list = ref([])
const loading = ref(true)
const saving = ref(false)

const typeLabels = {
  cutting: '裁剪',
  printing: '印花',
  embroidery: '刺绣',
  template: '模板',
  ironing: '烫标',
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.getCapacityConfig()
    const allowed = ['cutting', 'printing', 'embroidery', 'template', 'ironing']
    list.value = (data || []).filter(r => allowed.includes(r.process_type))
  } catch {
    ElMessage.error('加载失败')
  }
  loading.value = false
}

async function saveRow(row) {
  saving.value = true
  try {
    await api.updateCapacityConfig(row.id, row)
    ElMessage.success(`${typeLabels[row.process_type] || row.process_type} 保存成功`)
  } catch {
    ElMessage.error('保存失败')
  }
  saving.value = false
}

async function saveAll() {
  saving.value = true
  try {
    for (const row of list.value) {
      await api.updateCapacityConfig(row.id, row)
    }
    ElMessage.success('全部保存成功')
  } catch {
    ElMessage.error('保存失败')
  }
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div class="output-page">
    <div class="page-header-bar">
      <h2 class="page-heading">前置车间产量管理</h2>
      <el-button type="primary" @click="saveAll" :loading="saving">全部保存</el-button>
    </div>
    <p class="page-desc">设置各前置工序的标准日产量，用于排程时自动计算工序时长。</p>

    <el-table :data="list" v-loading="loading" stripe style="max-width:700px">
      <el-table-column label="工序类型" width="150">
        <template #default="{ row }">
          <span class="type-label">{{ typeLabels[row.process_type] || row.process_type }}</span>
        </template>
      </el-table-column>
      <el-table-column label="标准日产量" width="220">
        <template #default="{ row }">
          <el-input-number v-model="row.daily_capacity" :min="0" :step="100" size="small" style="width:160px" />
        </template>
      </el-table-column>
      <el-table-column label="单位" width="100">
        <template #default="{ row }">
          <el-tag size="small">{{ row.unit }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button size="small" type="primary" text @click="saveRow(row)" :loading="saving">保存</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.output-page { max-width: 800px; }
.page-header-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-heading { font-size: 20px; font-weight: 700; margin: 0; }
.page-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; }
.type-label { font-weight: 600; font-size: 14px; }
</style>
