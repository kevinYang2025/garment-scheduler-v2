<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const logs = ref([])
const total = ref(0)
const loading = ref(true)
const currentPage = ref(1)
const pageSize = ref(30)

const filters = ref({
  module: '',
  action: '',
})

const moduleOptions = [
  { value: '', label: '全部模块' },
  { value: 'styles', label: '款式管理' },
  { value: 'main_plan', label: '预排总计划' },
  { value: 'schedule_cutting', label: '裁剪排程' },
  { value: 'schedule_secondary', label: '二次加工' },
  { value: 'schedule_sewing', label: '缝制排程' },
  { value: 'warehouse', label: '仓库管理' },
]

const actionOptions = [
  { value: '', label: '全部操作' },
  { value: 'create', label: '新增' },
  { value: 'update', label: '修改' },
  { value: 'delete', label: '删除' },
  { value: 'import', label: '导入' },
  { value: 'export', label: '导出' },
]

const actionColors = {
  create: 'success',
  update: 'primary',
  delete: 'danger',
  import: 'warning',
  export: 'info',
  inbound: 'success',
  outbound: 'warning',
}

const actionLabels = {
  create: '新增',
  update: '修改',
  delete: '删除',
  import: '导入',
  export: '导出',
  inbound: '入库',
  outbound: '出库',
}

async function loadLogs() {
  loading.value = true
  try {
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
    }
    if (filters.value.module) params.module = filters.value.module
    if (filters.value.action) params.action = filters.value.action
    const { data } = await api.getLogs(params)
    logs.value = data.rows || []
    total.value = data.total || 0
  } catch {
    ElMessage.error('加载日志失败')
  }
  loading.value = false
}

function handlePageChange(page) {
  currentPage.value = page
  loadLogs()
}

function handleFilter() {
  currentPage.value = 1
  loadLogs()
}

function formatTime(ts) {
  if (!ts) return '-'
  return ts.replace('T', ' ').slice(0, 19)
}

const moduleLabels = {
  styles: '款式管理',
  main_plan: '预排总计划',
  schedule_cutting: '裁剪排程',
  schedule_secondary: '二次加工',
  schedule_sewing: '缝制排程',
  warehouse: '仓库管理',
}

onMounted(loadLogs)
</script>

<template>
  <div class="logs-page">
    <div class="logs-toolbar">
      <el-select v-model="filters.module" placeholder="模块" clearable style="width: 140px" @change="handleFilter">
        <el-option v-for="o in moduleOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="filters.action" placeholder="操作类型" clearable style="width: 120px" @change="handleFilter">
        <el-option v-for="o in actionOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="loadLogs" :icon="'Refresh'" circle />
    </div>

    <el-table :data="logs" v-loading="loading" stripe size="small" style="width: 100%">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="模块" width="110">
        <template #default="{ row }">
          <span>{{ moduleLabels[row.module] || row.module }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-tag :type="actionColors[row.action] || 'info'" size="small">
            {{ actionLabels[row.action] || row.action }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="target_name" label="对象" min-width="120" show-overflow-tooltip />
      <el-table-column prop="detail" label="详情" min-width="150" show-overflow-tooltip />
      <el-table-column prop="operator" label="操作人" width="80" />
      <el-table-column label="时间" width="170">
        <template #default="{ row }">
          {{ formatTime(row.created_at) }}
        </template>
      </el-table-column>
    </el-table>

    <div class="logs-pagination" v-if="total > pageSize">
      <el-pagination
        background
        layout="prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="currentPage"
        @current-change="handlePageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  max-width: 1000px;
}
.logs-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}
.logs-pagination {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
