<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const configs = ref([])
const editing = ref({})  // key -> value
const loading = ref(false)
const saving = ref(false)

// [2026-06-19] system_params (key/value 通用参数, 如特殊水洗时间)
const params = ref([])
const paramsEditing = ref({})
const paramsLoading = ref(false)
const paramsSaving = ref(false)

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

async function loadParams() {
  paramsLoading.value = true
  try {
    const { data } = await api.getSystemParams()
    params.value = data || []
    for (const p of data || []) paramsEditing.value[p.key] = p.value
  } catch (e) {
    ElMessage.error('加载通用参数失败: ' + (e.response?.data?.error || e.message))
  }
  paramsLoading.value = false
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

// [2026-06-19] 保存单个通用参数
async function saveParam(key) {
  const value = paramsEditing.value[key]
  const param = params.value.find(p => p.key === key)
  if (!param) return
  // 数值类校验
  if (key === 'special_wash_days') {
    const n = parseInt(value)
    if (!Number.isFinite(n) || n < 0 || n > 365) {
      ElMessage.error('特殊水洗时间必须是 0-365 之间的整数')
      return
    }
  }
  paramsSaving.value = true
  try {
    await api.updateSystemParam(key, value)
    ElMessage.success('已保存')
    param.value = String(value)
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.response?.data?.error || e.message))
  }
  paramsSaving.value = false
}

function isChanged(c) {
  return String(editing.value[c.config_key]) !== c.config_value
}
function isParamChanged(p) {
  return String(paramsEditing.value[p.key]) !== p.value
}

// [2026-06-19] 通用参数 key → 中文标签
const PARAM_LABELS = {
  special_wash_days: '特殊水洗前置天数',
}
function paramLabel(key) {
  return PARAM_LABELS[key] || key
}

const changedCount = () => configs.value.filter(isChanged).length

onMounted(() => { load(); loadParams() })
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

    <!-- [2026-06-19] 通用参数区(用户可调,如特殊水洗时间) -->
    <div class="page-header-bar" style="margin-top:32px">
      <h3 class="page-heading" style="font-size:16px">通用参数</h3>
      <p class="page-desc">影响业务规则的用户可调参数,即时生效。</p>
    </div>

    <el-table :data="params" v-loading="paramsLoading" border>
      <el-table-column label="参数名称" min-width="180">
        <template #default="{ row }">
          <span style="font-weight:600">{{ paramLabel(row.key) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Key" min-width="160">
        <template #default="{ row }">
          <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px">{{ row.key }}</code>
        </template>
      </el-table-column>
      <el-table-column label="当前值" width="120">
        <template #default="{ row }">
          <code class="current-value">{{ row.value }}</code>
        </template>
      </el-table-column>
      <el-table-column label="新值" width="180">
        <template #default="{ row }">
          <el-input-number
            v-if="row.key === 'special_wash_days'"
            v-model="paramsEditing[row.key]"
            :min="0" :max="365" size="small" controls-position="right" style="width:100%"
            :class="{ 'is-changed': isParamChanged(row) }"
          />
          <el-input
            v-else
            v-model="paramsEditing[row.key]"
            size="small"
            :class="{ 'is-changed': isParamChanged(row) }"
          />
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="说明" min-width="260" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            :disabled="!isParamChanged(row)"
            :loading="paramsSaving"
            @click="saveParam(row.key)"
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
:deep(.is-changed .el-input__wrapper),
:deep(.is-changed .el-input-number .el-input__wrapper) {
  background: #fef3c7;
  box-shadow: 0 0 0 1px #f59e0b inset;
}
</style>
