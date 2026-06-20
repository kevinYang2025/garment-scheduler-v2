<script setup>
// 通用二次加工报工(印花/刺绣/模板/烫标)
// 录入后存入 actual_production,关联回排程页面
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from '../composables/useI18n'
import api from '../api'
import { todayLocal } from '../utils/date'
import { getSecondaryTypeConfig } from '../constants/secondaryTypes'

const props = defineProps({
  reportType: { type: String, required: true },  // printing/embroidery/template/ironing
})
const router = useRouter()
const { t } = useI18n()

// reportType → nav key
const titleKeyMap = {
  printing: 'nav.printingDispatch',
  embroidery: 'nav.embroideryDispatch',
  template: 'nav.templateDispatch',
  ironing: 'nav.ironingDispatch',
}
const config = computed(() => {
  const c = getSecondaryTypeConfig(props.reportType)
  return { ...c, title: t(titleKeyMap[props.reportType] || 'nav.secondary') }
})

const records = ref([])
const scheduleStyles = ref([])
const loading = ref(false)
const saving = ref(false)

const showEntry = ref(false)
const form = ref(getDefaultForm())

function getDefaultForm() {
  return {
    schedule_type: 'secondary',
    secondary_type: config.value.name,  // '印花'/'刺绣'/'模板'/'烫标' — 后端 secondary_type 字段值
    style_no: '', color: '', size_spec: '',
    production_date: todayLocal(),  // [F-01 fix]
    completed_qty: 0,
    defect_qty: 0,
    remark: '',
  }
}

const colorsForStyle = computed(() => {
  if (!form.value.style_no) return []
  return [...new Set(scheduleStyles.value.filter(s => s.style_no === form.value.style_no).map(s => s.color).filter(Boolean))]
})
const sizesForStyleColor = computed(() => {
  if (!form.value.style_no) return []
  return scheduleStyles.value
    .filter(s => s.style_no === form.value.style_no && (!form.value.color || s.color === form.value.color))
    .map(s => s.size_spec).filter(Boolean)
})
const selectedProductName = computed(() => {
  return scheduleStyles.value.find(s => s.style_no === form.value.style_no)?.product_name || ''
})

async function loadScheduleStyles() {
  try {
    const fn = api[config.value.api]
    if (!fn) {
      console.warn(`api.${config.value.api} not found`)
      return
    }
    const { data } = await fn()
    scheduleStyles.value = (data.rows || []).map(r => ({
      style_no: r.style_no, product_name: r.product_name || '',
      color: r.color || '', size_spec: r.size_spec || '',
    }))
  } catch (e) {
    console.error('加载排程数据失败:', e)
    ElMessage.error(t('secondaryDispatch.toast.loadSchFail'))
  }
}

async function loadRecords() {
  loading.value = true
  try {
    const { data } = await api.getActual('secondary')
    records.value = (data || [])
      .filter(r => r.secondary_type === config.value.name)
      .sort((a, b) => (b.production_date || '').localeCompare(a.production_date || ''))
  } catch (e) {
    console.error('加载报工记录失败:', e)
    ElMessage.error(t('secondaryDispatch.toast.loadListFail'))
  }
  loading.value = false
}

function openAdd(prefill) {
  form.value = { ...getDefaultForm() }
  if (prefill) {
    form.value.style_no = prefill.style_no || ''
    form.value.color = prefill.color || ''
    form.value.size_spec = prefill.size_spec || ''
  }
  showEntry.value = true
}

async function saveEntry() {
  if (!form.value.style_no) { ElMessage.warning(t('secondaryDispatch.toast.noStyle')); return }
  if (!form.value.completed_qty || form.value.completed_qty <= 0) { ElMessage.warning(t('secondaryDispatch.toast.qtyZero')); return }
  saving.value = true
  try {
    form.value.secondary_type = config.value.name  // 后端用短名
    await api.saveActual(form.value)
    ElMessage.success(t('secondaryDispatch.toast.saveOk'))
    showEntry.value = false
    await loadRecords()
  } catch (e) {
    ElMessage.error(t('secondaryDispatch.toast.saveFail', null, { err: e.response?.data?.error || e.message }))
  }
  saving.value = false
}

async function deleteRecord(row) {
  try {
    await ElMessageBox.confirm(t('secondaryDispatch.toast.confirmDel'), t('secondaryDispatch.toast.confirmTitle'), { type: 'warning' })
    await api.deleteActual(row.id)
    ElMessage.success(t('secondaryDispatch.toast.deleteOk'))
    await loadRecords()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(t('secondaryDispatch.toast.deleteFail', null, { err: e.response?.data?.error || e.message }))
  }
}

const summaryRows = computed(() => {
  const map = {}
  for (const r of records.value) {
    const key = `${r.style_no}|${r.color || ''}|${r.size_spec || ''}`
    if (!map[key]) map[key] = { style_no: r.style_no, color: r.color || '', size_spec: r.size_spec || '', total_qty: 0, total_defect: 0, latest_date: '' }
    map[key].total_qty += r.completed_qty || 0
    map[key].total_defect += r.defect_qty || 0
    if (!map[key].latest_date || r.production_date > map[key].latest_date) map[key].latest_date = r.production_date
  }
  return Object.values(map)
})

function scrollToTop() {
  const el = document.querySelector('.excel-wrap')
  if (el) el.scrollTop = 0
}

onMounted(async () => {
  await Promise.all([loadScheduleStyles(), loadRecords()])
})
</script>

<template>
  <div class="dispatch-page">
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="router.back()"><span style="margin-right:4px">←</span> <span style="white-space:pre-line">{{ t('cuttingDispatch.back') }}</span></el-button>
        <h2 style="margin:0 0 0 12px;font-size:18px;font-weight:700;white-space:pre-line">{{ config.icon }} {{ config.title }}</h2>
      </div>
      <div class="header-actions">
        <el-button type="primary" size="large" @click="openAdd()"><span style="white-space:pre-line">{{ t('cuttingDispatch.addBtn') }}</span></el-button>
      </div>
    </div>

    <div class="summary-bar" v-if="records.length">
      <div class="summary-item">
        <span class="summary-value">{{ records.length }}</span>
        <span class="summary-label" style="white-space:pre-line">{{ t('cuttingDispatch.summary.records') }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-value">{{ records.reduce((s, r) => s + (r.completed_qty || 0), 0).toLocaleString() }}</span>
        <span class="summary-label" style="white-space:pre-line">{{ t('cuttingDispatch.summary.total') }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-value">{{ summaryRows.length }}</span>
        <span class="summary-label" style="white-space:pre-line">{{ t('cuttingDispatch.summary.styles') }}</span>
      </div>
    </div>

    <div v-if="loading" style="text-align:center;padding:60px;color:var(--text-tertiary);white-space:pre-line">{{ t('common.loading') }}</div>

    <div v-else-if="records.length" class="excel-wrap">
      <table class="excel-table">
        <thead>
          <tr>
            <th style="min-width:110px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.styleNo') }}</span></th>
            <th style="min-width:70px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.color') }}</span></th>
            <th style="min-width:60px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.size') }}</span></th>
            <th style="min-width:80px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.completed') }}</span></th>
            <th style="min-width:70px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.defect') }}</span></th>
            <th style="min-width:100px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.date') }}</span></th>
            <th style="min-width:140px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.recordedAt') }}</span></th>
            <th style="min-width:80px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.remark') }}</span></th>
            <th style="min-width:70px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.action') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id || r.record_id">
            <td style="font-weight:600">{{ r.style_no }}</td>
            <td>{{ r.color || '-' }}</td>
            <td>{{ r.size_spec || '-' }}</td>
            <td class="num" style="font-weight:600;color:var(--success)">{{ (r.completed_qty || 0).toLocaleString() }}</td>
            <td class="num" :style="{ color: r.defect_qty > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }">{{ r.defect_qty || 0 }}</td>
            <td>{{ r.production_date || '' }}</td>
            <td style="font-size:11px;color:var(--text-tertiary)">{{ r.recorded_at || '' }}</td>
            <td>{{ r.remark || '' }}</td>
            <td><el-button size="small" text type="danger" @click="deleteRecord(r)"><span style="white-space:pre-line">{{ t('cuttingDispatch.delete') }}</span></el-button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else style="text-align:center;padding:60px;color:var(--text-tertiary);white-space:pre-line">
      {{ t('secondaryDispatch.empty') }}
    </div>

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <el-dialog v-model="showEntry" :title="config.title" width="520px">
      <el-form :model="form" label-width="90px" size="default">
        <el-form-item :label="t('cuttingDispatch.form.styleNo')" required>
          <el-select v-model="form.style_no" filterable :placeholder="t('cuttingDispatch.form.stylePh')" style="width:100%"
            @change="() => { form.color = ''; form.size_spec = '' }">
            <el-option v-for="s in [...new Set(scheduleStyles.map(s => s.style_no))]" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedProductName" :label="t('cuttingDispatch.cols.product')">
          <span style="color:var(--primary)">{{ selectedProductName }}</span>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item :label="t('cuttingDispatch.form.color')">
              <el-select v-model="form.color" filterable :placeholder="t('cuttingDispatch.form.colorPh')" style="width:100%" :disabled="!form.style_no">
                <el-option v-for="c in colorsForStyle" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('cuttingDispatch.form.size')">
              <el-select v-model="form.size_spec" filterable :placeholder="t('cuttingDispatch.form.sizePh')" style="width:100%" :disabled="!form.style_no">
                <el-option v-for="s in sizesForStyleColor" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item :label="t('cuttingDispatch.form.date')" required>
          <el-input v-model="form.production_date" type="date" />
        </el-form-item>
        <el-form-item :label="t('cuttingDispatch.form.completed')" required>
          <el-input-number v-model="form.completed_qty" :min="0" :step="100" style="width:100%" />
        </el-form-item>
        <el-form-item :label="t('cuttingDispatch.form.defect')">
          <el-input-number v-model="form.defect_qty" :min="0" :step="10" style="width:100%" />
        </el-form-item>
        <el-form-item :label="t('cuttingDispatch.form.remark')">
          <el-input v-model="form.remark" :placeholder="t('cuttingDispatch.form.remarkPh')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEntry = false"><span style="white-space:pre-line">{{ t('common.cancel') }}</span></el-button>
        <el-button type="primary" :loading="saving" @click="saveEntry"><span style="white-space:pre-line">{{ t('cuttingDispatch.save') }}</span></el-button>
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
.num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }
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