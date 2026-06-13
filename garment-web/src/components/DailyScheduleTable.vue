<script setup>
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import ActualEntryDialog from './ActualEntryDialog.vue'

const props = defineProps({
  masterId: { type: Number, required: true },
  scheduleType: { type: String, required: true },
  styleNo: { type: String, default: '' },
  color: { type: String, default: '' },
  sizeSpec: { type: String, default: '' },
})

const emit = defineEmits(['refresh'])

const dailyData = ref([])
const loading = ref(false)
const entryDialogVisible = ref(false)
const selectedDate = ref('')

async function loadDaily() {
  if (!props.masterId) return
  loading.value = true
  try {
    const { data } = await api.getScheduleDaily(props.scheduleType, props.masterId)
    dailyData.value = data
  } catch (e) {
    ElMessage.error('加载每日数据失败')
  }
  loading.value = false
}

function openEntry(date) {
  selectedDate.value = date
  entryDialogVisible.value = true
}

function onSaved() {
  entryDialogVisible.value = false
  loadDaily()
  emit('refresh')
}

watch(() => props.masterId, loadDaily)
onMounted(loadDaily)

defineExpose({ loadDaily })
</script>

<template>
  <div class="daily-table-wrap" v-loading="loading">
    <div v-if="dailyData.length === 0" class="empty-hint">暂无每日数据</div>
    <div v-else class="daily-table-scroll">
      <table class="daily-table">
        <thead>
          <tr>
            <th class="row-label">行类型</th>
            <th v-for="(d, idx) in dailyData" :key="d.date + '-' + idx" class="date-col"
                :class="{ weekend: new Date(d.date).getDay() === 0 || new Date(d.date).getDay() === 6 }">
              {{ d.date.slice(5) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- 计划行 -->
          <tr class="row-plan">
            <td class="row-label">计划</td>
            <td v-for="d in dailyData" :key="d.date + 'plan'" class="plan-cell">
              {{ d.plan || '-' }}
            </td>
          </tr>
          <!-- 实际行 -->
          <tr class="row-actual">
            <td class="row-label">实际</td>
            <td v-for="d in dailyData" :key="d.date + 'actual'" class="actual-cell"
                :class="{ editable: true }" @click="openEntry(d.date)">
              <span class="actual-val">{{ d.actual || '-' }}</span>
              <span class="edit-hint">✎</span>
            </td>
          </tr>
          <!-- 差异行 -->
          <tr class="row-diff">
            <td class="row-label">差异</td>
            <td v-for="d in dailyData" :key="d.date + 'diff'" class="diff-cell"
                :class="{ positive: d.diff > 0, negative: d.diff < 0 }">
              {{ d.diff > 0 ? '+' : '' }}{{ d.diff }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ActualEntryDialog
      v-model="entryDialogVisible"
      :schedule-type="scheduleType"
      :style-no="styleNo"
      :color="color"
      :size-spec="sizeSpec"
      :date="selectedDate"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.daily-table-wrap { margin-top: 8px; background: var(--card); border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow-sm); border: 1px solid var(--border); }
.empty-hint { text-align: center; color: var(--text-tertiary); padding: 24px; font-size: 13px; }
.daily-table-scroll { overflow-x: auto; }
.daily-table { border-collapse: collapse; width: 100%; font-size: 13px; border-radius: var(--radius-sm); overflow: hidden; }
.daily-table th, .daily-table td { border-bottom: 1px solid var(--border-light); padding: 10px 14px; text-align: center; white-space: nowrap; min-width: 72px; }
.daily-table th {
  background: var(--card); font-weight: 500; font-size: 11px; color: var(--text-tertiary);
  letter-spacing: 0.3px; position: sticky; top: 0; z-index: 2;
  border-bottom: 1px solid var(--border);
}
.row-label {
  background: var(--card); font-weight: 500; font-size: 11px; color: var(--text-tertiary);
  text-align: left; padding-left: 14px; min-width: 64px; position: sticky; left: 0; z-index: 1;
  letter-spacing: 0.3px;
}
.date-col.weekend { background: var(--danger-light); color: var(--danger); }

.row-plan .plan-cell { background: var(--primary-light); color: var(--primary-dark); font-weight: 500; }
.row-actual .actual-cell { background: var(--success-light); cursor: pointer; position: relative; transition: background .15s; }
.row-actual .actual-cell:hover { background: var(--primary-light); box-shadow: inset 0 0 0 1px var(--primary); }
.edit-hint { opacity: 0; margin-left: 4px; font-size: 10px; color: var(--primary-dark); transition: opacity .15s; }
.row-actual .actual-cell:hover .edit-hint { opacity: 1; }
.actual-val { font-weight: 500; }

.row-diff .diff-cell { font-weight: 600; }
.row-diff .diff-cell.positive { color: var(--success); background: var(--success-light); }
.row-diff .diff-cell.negative { color: var(--danger); background: var(--danger-light); }
</style>
