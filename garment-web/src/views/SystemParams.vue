<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const configs = ref([])
const editing = ref({})  // key -> value
const loading = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.getSystemConfig()
    configs.value = data || []
    // 初始化编辑 buffer
    for (const c of data || []) editing.value[c.config_key] = c.config_value
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message))
  }
  loading.value = false
}

async function saveOne(key) {
  const value = editing.value[key]
  try {
    await ElMessageBox.confirm(
      `确认将 "${key}" 改为 "${value}"?`,
      '修改系统参数',
      { type: 'warning' }
    )
  } catch { return }
  saving.value = true
  try {
    await api.updateSystemConfig(key, value)
    ElMessage.success('已保存')
    // 同步到列表显示
    const item = configs.value.find(c => c.config_key === key)
    if (item) item.config_value = String(value)
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.response?.data?.error || e.message))
  }
  saving.value = false
}

async function saveAll() {
  const changes = configs.value
    .filter(c => String(editing.value[c.config_key]) !== c.config_value)
    .map(c => ({ key: c.config_key, value: editing.value[c.config_key] }))
  if (changes.length === 0) {
    ElMessage.info('无修改')
    return
  }
  try {
    await ElMessageBox.confirm(
      `共 ${changes.length} 项修改,确认保存?`,
      '批量保存',
      { type: 'warning' }
    )
  } catch { return }
  saving.value = true
  let ok = 0
  for (const c of changes) {
    try {
      await api.updateSystemConfig(c.key, c.value)
      ok++
    } catch (e) {
      ElMessage.error(`${c.key} 失败: ${e.response?.data?.error || e.message}`)
    }
  }
  saving.value = false
  ElMessage.success(`保存完成 ${ok}/${changes.length}`)
  await load()
}

function isChanged(c) {
  return String(editing.value[c.config_key]) !== c.config_value
}

const changedCount = () => configs.value.filter(isChanged).length

onMounted(load)
</script>

<template>
  <div class="system-params">
    <div class="page-header-bar">
      <h2 class="page-heading">系统参数</h2>
      <p class="page-desc">
        预排产算法中的可调阈值。修改后下次自动排产生效。橙色行表示有未保存修改。
      </p>
    </div>

    <div class="toolbar">
      <el-button @click="load" :loading="loading">刷新</el-button>
      <el-button
        type="primary"
        @click="saveAll"
        :loading="saving"
        :disabled="changedCount() === 0"
      >
        保存全部 ({{ changedCount() }})
      </el-button>
    </div>

    <el-table :data="configs" v-loading="loading" border style="margin-top:12px">
      <el-table-column prop="config_key" label="参数 Key" min-width="220" />
      <el-table-column label="当前值" width="120">
        <template #default="{ row }">
          <code class="current-value">{{ row.config_value }}</code>
        </template>
      </el-table-column>
      <el-table-column label="新值" width="180">
        <template #default="{ row }">
          <el-input
            v-model="editing[row.config_key]"
            size="small"
            :class="{ 'is-changed': isChanged(row) }"
          />
        </template>
      </el-table-column>
      <el-table-column prop="description" label="说明" min-width="220" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            :disabled="!isChanged(row)"
            @click="saveOne(row.config_key)"
          >保存</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.system-params { padding: 4px 0 24px; }
.toolbar { display: flex; gap: 8px; }
.current-value {
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Consolas', monospace;
  font-size: 13px;
  color: #1e293b;
}
:deep(.is-changed .el-input__wrapper) {
  background: #fef3c7;
  box-shadow: 0 0 0 1px #f59e0b inset;
}
</style>
