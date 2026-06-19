<script setup>
// 裁剪报工：录入报工 + 查看已录入记录
// 基础数据引用裁剪排程（款式/颜色/尺码），录入后存入 actual_production
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from '../composables/useI18n'
import api from '../api'
import { todayLocal } from '../utils/date'

const router = useRouter()
const { t } = useI18n()

const records = ref([])          // 已录入的报工记录
const cuttingStyles = ref([])    // 裁剪排程的款式/颜色/尺码选项
const loading = ref(false)
const saving = ref(false)

// 录入表单
const showEntry = ref(false)
const form = ref(getDefaultForm())

function getDefaultForm() {
  return {
    schedule_type: 'cutting',
    style_no: '', color: '', size_spec: '',
    production_date: todayLocal(),  // [F-01 fix] 本地日期,不用 toISOString
    completed_qty: 0,
    defect_qty: 0,
    remark: '',
  }
}

// 选中的款式对应的可选颜色/尺码
const colorsForStyle = computed(() => {
  if (!form.value.style_no) return []
  const set = new Set(cuttingStyles.value.filter(s => s.style_no === form.value.style_no).map(s => s.color).filter(Boolean))
  return [...set]
})

const sizesForStyleColor = computed(() => {
  if (!form.value.style_no) return []
  return cuttingStyles.value
    .filter(s => s.style_no === form.value.style_no && (!form.value.color || s.color === form.value.color))
    .map(s => s.size_spec)
    .filter(Boolean)
})

// 选中款号时自动带出品名
const selectedProductName = computed(() => {
  const found = cuttingStyles.value.find(s => s.style_no === form.value.style_no)
  return found?.product_name || ''
})

// 加载裁剪排程的款式选项
async function loadCuttingStyles() {
  try {
    const { data } = await api.getCuttingSchedule()
    const rows = data.rows || []
    // 展平为 style_no + color + size_spec + product_name
    const list = []
    for (const r of rows) {
      list.push({
        style_no: r.style_no,
        product_name: r.product_name || '',
        color: r.color || '',
        size_spec: r.size_spec || '',
      })
    }
    cuttingStyles.value = list
  } catch (e) {
    console.error('加载裁剪排程数据失败:', e)
  }
}

// 加载已录入的报工记录
async function loadRecords() {
  loading.value = true
  try {
    const { data } = await api.getActual('cutting')
    records.value = (data || []).sort((a, b) => (b.production_date || '').localeCompare(a.production_date || ''))
  } catch (e) {
    console.error('加载报工记录失败:', e)
    ElMessage.error('加载报工记录失败')
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
  if (!form.value.style_no) { ElMessage.warning('请选择款号'); return }
  if (!form.value.completed_qty || form.value.completed_qty <= 0) { ElMessage.warning('完成数量必须大于0'); return }
  saving.value = true
  try {
    await api.saveActual(form.value)
    ElMessage.success('报工成功')
    showEntry.value = false
    await loadRecords()
  } catch (e) {
    ElMessage.error('报工失败: ' + (e.response?.data?.error || e.message))
  }
  saving.value = false
}

async function deleteRecord(row) {
  try {
    await ElMessageBox.confirm('确定删除这条报工记录？', '提示', { type: 'warning' })
    await api.deleteActual(row.id)  // [F-06 fix] 后端只返回 id 字段
    ElMessage.success('删除成功')
    await loadRecords()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败: ' + (e.response?.data?.error || e.message))
  }
}

// 按款号+颜色+尺码汇总
const summaryRows = computed(() => {
  const map = {}
  for (const r of records.value) {
    const key = `${r.style_no}|${r.color || ''}|${r.size_spec || ''}`
    if (!map[key]) {
      map[key] = {
        style_no: r.style_no, color: r.color || '', size_spec: r.size_spec || '',
        total_qty: 0, total_defect: 0, dates: [], latest_date: '',
      }
    }
    map[key].total_qty += r.completed_qty || 0
    map[key].total_defect += r.defect_qty || 0
    map[key].dates.push(r.production_date)
    if (!map[key].latest_date || r.production_date > map[key].latest_date) map[key].latest_date = r.production_date
  }
  return Object.values(map).sort((a, b) => b.latest_date.localeCompare(a.latest_date))
})

function scrollToTop() {
  const el = document.querySelector('.excel-wrap')
  if (el) el.scrollTop = 0
}

onMounted(async () => {
  await Promise.all([loadCuttingStyles(), loadRecords()])
})
</script>

<template>
  <div class="cutting-dispatch">
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="router.back()"><span style="margin-right:4px">←</span> <span style="white-space:pre-line">{{ t('cuttingDispatch.back') }}</span></el-button>
        <h2 style="margin:0 0 0 12px;font-size:18px;font-weight:700;white-space:pre-line">{{ t('nav.cuttingDispatch') }}</h2>
      </div>
      <div class="header-actions">
        <el-button type="primary" size="large" @click="openAdd()"><span style="white-space:pre-line">{{ t('cuttingDispatch.addBtn') }}</span></el-button>
      </div>
    </div>

    <!-- 汇总卡片 -->
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

    <div v-if="loading" style="text-align:center;padding:60px;color:var(--text-tertiary)"><span style="white-space:pre-line">{{ t('common.loading') }}</span></div>

    <!-- 已录入记录表格 -->
    <div v-else-if="records.length" class="excel-wrap">
      <table class="excel-table">
        <thead>
          <tr>
            <th style="min-width:110px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.styleNo') }}</span></th>
            <th style="min-width:130px"><span style="white-space:pre-line">{{ t('cuttingDispatch.cols.product') }}</span></th>
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
            <td>{{ r.product_name || '' }}</td>
            <td>{{ r.color || '-' }}</td>
            <td>{{ r.size_spec || '-' }}</td>
            <td class="num" style="font-weight:600;color:var(--success)">{{ (r.completed_qty || 0).toLocaleString() }}</td>
            <td class="num" :style="{ color: r.defect_qty > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }">{{ r.defect_qty || 0 }}</td>
            <td>{{ r.production_date || '' }}</td>
            <td style="font-size:11px;color:var(--text-tertiary)">{{ r.recorded_at || '' }}</td>
            <td>{{ r.remark || '' }}</td>
            <td>
              <el-button size="small" text type="danger" @click="deleteRecord(r)"><span style="white-space:pre-line">{{ t('cuttingDispatch.delete') }}</span></el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else style="text-align:center;padding:60px;color:var(--text-tertiary);white-space:pre-line">
      {{ t('cuttingDispatch.empty') }}
    </div>

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 录入报工弹窗 -->
    <el-dialog v-model="showEntry" width="520px">
      <template #title><span style="white-space:pre-line">{{ t('cuttingDispatch.dialogTitle') }}</span></template>
      <el-form :model="form" label-width="90px" size="default">
        <el-form-item :label="t('cuttingDispatch.form.styleNo')" required>
          <el-select v-model="form.style_no" filterable :placeholder="t('cuttingDispatch.form.stylePh')" style="width:100%"
            @change="() => { form.color = ''; form.size_spec = '' }">
            <el-option v-for="s in [...new Set(cuttingStyles.map(s => s.style_no))]" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedProductName" :label="t('cuttingDispatch.cols.product')">
          <span style="color:var(--primary)">{{ selectedProductName }}</span>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item :label="t('cuttingDispatch.form.color')">
              <el-select v-model="form.color" filterable :placeholder="t('cuttingDispatch.form.colorPh')" style="width:100%"
                :disabled="!form.style_no">
                <el-option v-for="c in colorsForStyle" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('cuttingDispatch.form.size')">
              <el-select v-model="form.size_spec" filterable :placeholder="t('cuttingDispatch.form.sizePh')" style="width:100%"
                :disabled="!form.style_no">
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
.cutting-dispatch { display: flex; flex-direction: column; height: 100%; }

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
