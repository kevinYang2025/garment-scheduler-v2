<template>
  <div class="actual-review">
    <div class="page-header-bar">
      <h2 class="page-heading">实际产量复核</h2>
      <p class="page-desc">
        车间:<b>{{ workshopNames[auth.workshop] || auth.workshop }}</b>
        · 操作员:<b>{{ auth.user?.display_name }}</b>
        · 改完会锁定,dispatcher 当天不能再报;要重新报工可点"解锁"
      </p>
    </div>

    <div class="toolbar">
      <el-input v-model="filterStyle" placeholder="按款号过滤" clearable style="width: 240px" />
      <el-button @click="load" type="primary" :loading="loading">刷新</el-button>
    </div>

    <el-table :data="filteredRows" v-loading="loading" border style="width: 100%; margin-top: 12px;">
      <el-table-column prop="schedule_date" label="日期" width="120" sortable />
      <el-table-column prop="style_no" label="款号" min-width="180" />
      <el-table-column prop="color" label="颜色" width="100" />
      <el-table-column prop="size_spec" label="尺码" width="100" />
      <el-table-column label="实际数" width="160">
        <template #default="{ row }">
          <el-input-number
            v-model="row.qty"
            :min="0"
            size="small"
            :disabled="isLockedByOther(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="锁定状态" width="160">
        <template #default="{ row }">
          <el-tag v-if="!row.locked_by_user_id" type="info">未锁</el-tag>
          <el-tag v-else-if="row.locked_by_user_id === auth.user?.id" type="success">你锁的</el-tag>
          <el-tag v-else type="warning" effect="dark">他人锁定</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button @click="save(row)" type="primary" size="small" :disabled="isLockedByOther(row)">保存</el-button>
          <el-button
            v-if="row.locked_by_user_id === auth.user?.id"
            @click="unlock(row)"
            size="small"
          >解锁</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="!loading && filteredRows.length === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <p>暂无 ACTUAL 记录(可能 dispatcher 还没报工)</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import api from '../api'

const auth = useAuthStore()
const rows = ref([])
const loading = ref(false)
const filterStyle = ref('')

const workshopNames = {
  cutting: '裁剪车间', printing: '印花车间', embroidery: '刺绣车间',
  template: '模板车间', ironing: '烫标车间', sewing: '缝制车间'
}

const filteredRows = computed(() => {
  if (!filterStyle.value) return rows.value
  const kw = filterStyle.value.toLowerCase()
  return rows.value.filter(r => (r.style_no || '').toLowerCase().includes(kw))
})

function isLockedByOther(row) {
  return row.locked_by_user_id && row.locked_by_user_id !== auth.user?.id
}

async function load() {
  loading.value = true
  try {
    const r = await api.get('/schedule/daily/actuals', {
      params: { schedule_type: auth.workshop }
    })
    rows.value = r.data
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message))
  } finally {
    loading.value = false
  }
}

async function save(row) {
  try {
    await api.put(`/schedule/daily/actual/${row.id}`, { qty: row.qty })
    row.locked_by_user_id = auth.user?.id
    row.locked_at = new Date().toISOString()
    ElMessage.success('已保存并锁定')
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.response?.data?.error || e.message))
  }
}

async function unlock(row) {
  try {
    await ElMessageBox.confirm('解锁后 dispatcher 可以覆盖该行实际数,确认解锁?', '提示', { type: 'warning' })
    await api.post(`/schedule/daily/actual/${row.id}/unlock`)
    row.locked_by_user_id = null
    row.locked_at = null
    ElMessage.success('已解锁')
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error('解锁失败: ' + (e.response?.data?.error || e.message))
  }
}

onMounted(load)
</script>

<style scoped>
.actual-review {
  padding: 4px 0 24px;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
