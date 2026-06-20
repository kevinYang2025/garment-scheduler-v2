<script setup>
// 缝制报工：数据来源 = 缝制排程/班组缝制计划（schedule_master, schedule_type='sewing'）
// 先选班组→再选款式，或直接选款式带出班组
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from '../composables/useI18n'
import api from '../api'
import { todayLocal } from '../utils/date'

const props = defineProps({
  workshop: { type: String, default: '' },
})
const router = useRouter()
const { t } = useI18n()

const records = ref([])
const sewingMasters = ref([])   // 缝制排程主数据（含 workshop/line_team）
const loading = ref(false)
const saving = ref(false)

const showEntry = ref(false)
// [2026-06-20 段17 C-1] 滚动容器 ref(替代 querySelector)
const bodyRef = ref(null)
const form = ref({
  schedule_type: 'sewing',
  style_no: '', product_name: '', color: '', size_spec: '',
  production_date: todayLocal(),  // [F-01 fix]
  completed_qty: 0, defect_qty: 0,
  workshop: '', line_team: '',
  remark: '',
})

// [F-03 fix] workshop 单一可信源:始终用 props.workshop,不让选款式时改
const filteredMasters = computed(() => {
  if (!props.workshop) return sewingMasters.value
  return sewingMasters.value.filter(m => m.workshop === props.workshop)
})

// 所有班组列表
const teams = computed(() => {
  return [...new Set(filteredMasters.value.map(m => `${m.line_team || ''}`).filter(Boolean))]
})

// 选中班组后的款式
const stylesForTeam = computed(() => {
  if (!form.value.line_team) {
    return sewingMasters.value
  }
  return sewingMasters.value.filter(m =>
    (!props.workshop || m.workshop === props.workshop) &&  // 优先用 props.workshop
    m.line_team === form.value.line_team
  )
})

// 选款号后自动带出的信息
const selectedMaster = computed(() => {
  return sewingMasters.value.find(m => m.style_no === form.value.style_no)
})

function onTeamSelect(lineTeam) {
  form.value.line_team = lineTeam
  form.value.workshop = props.workshop  // 单一源:从 props 复制
  form.value.style_no = ''
  form.value.product_name = ''
  form.value.color = ''
  form.value.size_spec = ''
}

function onStyleSelect(styleNo) {
  const master = selectedMaster.value
  if (master) {
    form.value.product_name = master.product_name || ''
    form.value.color = master.color || ''
    form.value.size_spec = master.size_spec || ''
    form.value.line_team = master.line_team || ''
    // [F-03 fix] 不再覆盖 workshop,统一用 props.workshop
  }
}

async function loadSewingMasters() {
  try {
    const { data } = await api.getSchedule('sewing')
    sewingMasters.value = data || []
  } catch (e) {
    console.error('加载缝制排程失败:', e)
    ElMessage.error('加载缝制排程失败')
  }
}

async function loadRecords() {
  loading.value = true
  try {
    const { data } = await api.getActual('sewing')
    records.value = (data || []).sort((a, b) => (b.production_date || '').localeCompare(a.production_date || ''))
  } catch (e) {
    console.error('加载报工记录失败:', e)
    ElMessage.error('加载报工记录失败')
  }
  loading.value = false
}

function openAdd(prefill) {
  form.value = {
    schedule_type: 'sewing',
    style_no: prefill?.style_no || '', product_name: prefill?.product_name || '',
    color: prefill?.color || '', size_spec: prefill?.size_spec || '',
    production_date: todayLocal(),  // [F-01 fix]
    completed_qty: 0, defect_qty: 0,
    workshop: props.workshop || prefill?.workshop || '',  // 优先 props
    line_team: prefill?.line_team || '',
    remark: '',
  }
  showEntry.value = true
}

async function saveEntry() {
  if (!form.value.style_no) { ElMessage.warning('请选择款号'); return }
  if (!form.value.completed_qty || form.value.completed_qty <= 0) { ElMessage.warning('完成数量必须大于0'); return }
  saving.value = true
  try {
    await api.saveActual(form.value)
    ElMessage.success('报工成功')
    showEntry.value = false
    await loadRecords()
  } catch (e) { ElMessage.error('报工失败: ' + (e.response?.data?.error || e.message)) }
  saving.value = false
}

async function deleteRecord(row) {
  try {
    await ElMessageBox.confirm('确定删除这条报工记录？', '提示', { type: 'warning' })
    await api.deleteActual(row.id || row.record_id)
    ElMessage.success('删除成功')
    await loadRecords()
  } catch { /* cancel */ }
}

function scrollToTop() {
  // [2026-06-20 段17 C-1] 用 ref 替代 querySelector
  if (bodyRef.value) bodyRef.value.scrollTop = 0
}

onMounted(async () => {
  await Promise.all([loadSewingMasters(), loadRecords()])
})
</script>

<template>
  <div class="dispatch-page">
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="router.back()"><span style="margin-right:4px">←</span> <span style="white-space:pre-line">{{ t('sewingDispatch.back') }}</span></el-button>
        <h2 style="margin:0 0 0 12px;font-size:18px;font-weight:700;white-space:pre-line">🧵 {{ t('sewingDispatch.sewingReport') }} · {{ props.workshop || t('sewingDispatch.all') }}</h2>
      </div>
      <div class="header-actions">
        <el-button type="primary" size="large" @click="openAdd()"><span style="white-space:pre-line">{{ t('sewingDispatch.addBtn') }}</span></el-button>
      </div>
    </div>

    <div class="summary-bar" v-if="records.length">
      <div class="summary-item">
        <span class="summary-value">{{ records.length }}</span>
        <span class="summary-label" style="white-space:pre-line">{{ t('sewingDispatch.summary.records') }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-value">{{ records.reduce((s, r) => s + (r.completed_qty || 0), 0).toLocaleString() }}</span>
        <span class="summary-label" style="white-space:pre-line">{{ t('sewingDispatch.summary.total') }}</span>
      </div>
    </div>

    <div v-if="loading" style="text-align:center;padding:60px;color:var(--text-tertiary)"><span style="white-space:pre-line">{{ t('common.loading') }}</span></div>

    <div v-else-if="records.length" ref="bodyRef" class="excel-wrap">
      <table class="excel-table">
        <thead>
          <tr>
            <th style="min-width:70px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.workshop') }}</span></th>
            <th style="min-width:60px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.team') }}</span></th>
            <th style="min-width:110px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.styleNo') }}</span></th>
            <th style="min-width:130px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.product') }}</span></th>
            <th style="min-width:80px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.completed') }}</span></th>
            <th style="min-width:70px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.defect') }}</span></th>
            <th style="min-width:100px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.date') }}</span></th>
            <th style="min-width:140px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.recordedAt') }}</span></th>
            <th style="min-width:70px"><span style="white-space:pre-line">{{ t('sewingDispatch.cols.action') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id || r.record_id">
            <td>{{ r.workshop || '-' }}</td>
            <td>{{ r.line_team || '-' }}</td>
            <td style="font-weight:600">{{ r.style_no }}</td>
            <td>{{ r.product_name || r.style_no }}</td>
            <td class="num" style="font-weight:600;color:var(--success)">{{ (r.completed_qty || 0).toLocaleString() }}</td>
            <td class="num" :style="{ color: r.defect_qty > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }">{{ r.defect_qty || 0 }}</td>
            <td>{{ r.production_date || '' }}</td>
            <td style="font-size:11px;color:var(--text-tertiary)">{{ r.recorded_at || '' }}</td>
            <td><el-button size="small" text type="danger" @click="deleteRecord(r)"><span style="white-space:pre-line">{{ t('sewingDispatch.delete') }}</span></el-button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else style="text-align:center;padding:60px;color:var(--text-tertiary);white-space:pre-line">
      {{ t('sewingDispatch.empty') }}
    </div>

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 录入弹窗 -->
    <el-dialog v-model="showEntry" width="520px">
      <template #title><span style="white-space:pre-line">{{ t('sewingDispatch.dialogTitle') }}</span></template>
      <el-form :model="form" label-width="90px" size="default">
        <el-form-item :label="t('sewingDispatch.form.selectTeam')" v-if="!form.style_no">
          <el-select filterable :placeholder="t('sewingDispatch.form.teamFilter')" style="width:100%" @change="onTeamSelect">
            <el-option v-for="team in teams" :key="team" :label="team" :value="team" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('sewingDispatch.form.workshop')">
          <el-tag size="large">{{ props.workshop }}</el-tag>
        </el-form-item>
        <el-form-item :label="t('sewingDispatch.form.styleNo')" required>
          <el-select v-model="form.style_no" filterable :placeholder="t('sewingDispatch.form.stylePh')" style="width:100%" @change="onStyleSelect">
            <el-option v-for="m in filteredMasters" :key="m.style_no + m.id" :label="m.style_no + ' / ' + m.product_name" :value="m.style_no" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedMaster" :label="t('sewingDispatch.form.product')">
          <span style="color:var(--primary)">{{ selectedMaster.product_name }}</span>
        </el-form-item>
        <el-form-item :label="t('sewingDispatch.form.team')">
          <el-input v-model="form.line_team" :placeholder="t('sewingDispatch.form.teamPh')" />
        </el-form-item>
        <el-form-item :label="t('sewingDispatch.form.date')" required>
          <el-input v-model="form.production_date" type="date" />
        </el-form-item>
        <el-form-item :label="t('sewingDispatch.form.completed')" required>
          <el-input-number v-model="form.completed_qty" :min="0" :step="100" style="width:100%" />
        </el-form-item>
        <el-form-item :label="t('sewingDispatch.form.defect')">
          <el-input-number v-model="form.defect_qty" :min="0" :step="10" style="width:100%" />
        </el-form-item>
        <el-form-item :label="t('sewingDispatch.form.remark')">
          <el-input v-model="form.remark" :placeholder="t('sewingDispatch.form.remarkPh')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEntry = false"><span style="white-space:pre-line">{{ t('common.cancel') }}</span></el-button>
        <el-button type="primary" :loading="saving" @click="saveEntry"><span style="white-space:pre-line">{{ t('common.save') }}</span></el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.dispatch-page { display: flex; flex-direction: column; height: 100%; }
.detail-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); gap: 12px; flex-shrink: 0;
}
.header-left { display: flex; align-items: center; flex-shrink: 0; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.summary-bar {
  display: flex; gap: 24px; margin-bottom: 16px; padding: 16px 24px;
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); flex-shrink: 0;
}
.summary-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.summary-value { font-size: 24px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.summary-label { font-size: 11px; color: var(--text-tertiary); }
.excel-wrap {
  flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card);
}
.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); min-width: 100%; }
.excel-table thead th {
  padding: 10px 14px; background: var(--card); color: var(--text-tertiary); font-size: 11px; font-weight: 500;
  letter-spacing: 0.3px; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;
  position: sticky; top: 0; z-index: 3;
}
.excel-table td {
  padding: 12px 16px; border-bottom: 1px solid var(--border-light); white-space: nowrap; text-align: center;
}
tbody tr:hover td { background: var(--primary-light); }
.num { text-align: center !important; font-variant-numeric: tabular-nums; }
.scroll-top-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
  box-shadow: var(--shadow-md);
  z-index: 100;
  transition: var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
}
.scroll-top-btn:hover { background: var(--primary-hover); }
</style>
