<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const props = defineProps({ db: Object })

const ganttConfig = ref({})
const loading = ref(true)
const saving = ref(false)

const allFields = [
  { value: 'styleNo', label: '款号' },
  { value: 'productName', label: '品名' },
  { value: 'planQty', label: '计划数量' },
  { value: 'color', label: '颜色' },
  { value: 'sizeSpec', label: '规格' },
  { value: 'dueDate', label: '交期' },
  { value: 'priority', label: '优先级' },
  { value: 'sewingStart', label: '缝制开始' },
  { value: 'sewingEnd', label: '缝制结束' },
  { value: 'cuttingStart', label: '裁剪开始' },
  { value: 'cuttingEnd', label: '裁剪结束' },
  { value: 'secondaryType', label: '二次加工类型' },
  { value: 'workshop', label: '车间' },
  { value: 'lineTeam', label: '班组' },
]

const scheduleTypes = [
  { key: 'sewing', label: '缝制排程' },
  { key: 'cutting', label: '裁剪排程' },
  { key: 'secondary', label: '二次加工' },
]

async function loadConfig() {
  loading.value = true
  try {
    const { data } = await api.getGanttConfig()
    ganttConfig.value = data
  } catch {
    ElMessage.error('加载配置失败')
  }
  loading.value = false
}

async function saveConfig(type) {
  saving.value = true
  try {
    await api.updateGanttConfig(type, ganttConfig.value[type])
    ElMessage.success('保存成功')
  } catch {
    ElMessage.error('保存失败')
  }
  saving.value = false
}

onMounted(loadConfig)
</script>

<template>
  <div class="settings-page">
    <div class="page-header-bar">
      <h2 class="page-heading">系统设置</h2>
    </div>

    <div v-loading="loading">
      <div v-for="st in scheduleTypes" :key="st.key" class="config-section">
        <h3 class="section-title">{{ st.label }} — 甘特图字段配置</h3>

        <div v-if="ganttConfig[st.key]" class="config-group">
          <div class="config-item">
            <label>任务条显示字段</label>
            <el-select v-model="ganttConfig[st.key].barFields" multiple style="width:100%">
              <el-option v-for="f in allFields" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
            <p class="config-hint">选择在甘特图任务条上显示的字段</p>
          </div>

          <div class="config-item">
            <label>鼠标悬停提示字段</label>
            <el-select v-model="ganttConfig[st.key].tooltipFields" multiple style="width:100%">
              <el-option v-for="f in allFields" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
            <p class="config-hint">选择鼠标悬停时显示的字段</p>
          </div>

          <div class="config-item">
            <label>左侧列表显示字段</label>
            <el-select v-model="ganttConfig[st.key].leftFields" multiple style="width:100%">
              <el-option v-for="f in allFields" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
            <p class="config-hint">选择甘特图左侧显示的字段</p>
          </div>

          <el-button type="primary" @click="saveConfig(st.key)" :loading="saving">保存{{ st.label }}配置</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 800px;
}
.page-header-bar {
  margin-bottom: 24px;
}
.page-heading {
  font-size: 20px;
  font-weight: 700;
}
.config-section {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 20px;
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text);
}
.config-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.config-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.config-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}
</style>
