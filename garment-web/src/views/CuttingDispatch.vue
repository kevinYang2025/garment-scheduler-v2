<script setup>
// 裁剪报工：录入报工 + 查看已录入记录
// 基础数据引用裁剪排程（款式/颜色/尺码），录入后存入 actual_production
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const emit = defineEmits(['back'])

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
    production_date: new Date().toISOString().slice(0, 10),
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
    await api.deleteActual(row.id || row.record_id)
    ElMessage.success('删除成功')
    await loadRecords()
  } catch { /* cancel */ }
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
  const el = document.querySelector('.vt-container, .excel-body, .excel-wrap')
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
        <el-button text @click="emit('back')"><span style="margin-right:4px">←</span> 返回</el-button>
        <h2 style="margin:0 0 0 12px;font-size:18px;font-weight:700">裁剪报工</h2>
      </div>
      <div class="header-actions">
        <el-button type="primary" size="large" @click="openAdd()">+ 录入报工</el-button>
      </div>
    </div>

    <!-- 汇总卡片 -->
    <div class="summary-bar" v-if="records.length">
      <div class="summary-item">
        <span class="summary-value">{{ records.length }}</span>
        <span class="summary-label">报工记录</span>
      </div>
      <div class="summary-item">
        <span class="summary-value">{{ records.reduce((s, r) => s + (r.completed_qty || 0), 0).toLocaleString() }}</span>
        <span class="summary-label">总完成数量</span>
      </div>
      <div class="summary-item">
        <span class="summary-value">{{ summaryRows.length }}</span>
        <span class="summary-label">涉及款式</span>
      </div>
    </div>

    <div v-if="loading" style="text-align:center;padding:60px;color:var(--text-tertiary)">加载中...</div>

    <!-- 已录入记录表格 -->
    <div v-else-if="records.length" class="excel-wrap">
      <table class="excel-table">
        <thead>
          <tr>
            <th style="min-width:110px">款号</th>
            <th style="min-width:130px">品名</th>
            <th style="min-width:70px">颜色</th>
            <th style="min-width:60px">尺码</th>
            <th style="min-width:80px">完成数量</th>
            <th style="min-width:70px">不良数量</th>
            <th style="min-width:100px">报工日期</th>
            <th style="min-width:140px">录入时间</th>
            <th style="min-width:80px">备注</th>
            <th style="min-width:70px">操作</th>
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
              <el-button size="small" text type="danger" @click="deleteRecord(r)">删除</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else style="text-align:center;padding:60px;color:var(--text-tertiary)">
      暂无报工记录，点击"录入报工"开始
    </div>

    <!-- 回到顶部 -->
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>

    <!-- 录入报工弹窗 -->
    <el-dialog v-model="showEntry" title="裁剪报工" width="520px">
      <el-form :model="form" label-width="90px" size="default">
        <el-form-item label="款号" required>
          <el-select v-model="form.style_no" filterable placeholder="选择款号" style="width:100%"
            @change="() => { form.color = ''; form.size_spec = '' }">
            <el-option v-for="s in [...new Set(cuttingStyles.map(s => s.style_no))]" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedProductName" label="品名">
          <span style="color:var(--primary)">{{ selectedProductName }}</span>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="颜色">
              <el-select v-model="form.color" filterable placeholder="选择颜色" style="width:100%"
                :disabled="!form.style_no">
                <el-option v-for="c in colorsForStyle" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="尺码">
              <el-select v-model="form.size_spec" filterable placeholder="选择尺码" style="width:100%"
                :disabled="!form.style_no">
                <el-option v-for="s in sizesForStyleColor" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="报工日期" required>
          <el-input v-model="form.production_date" type="date" />
        </el-form-item>
        <el-form-item label="完成数量" required>
          <el-input-number v-model="form.completed_qty" :min="0" :step="100" style="width:100%" />
        </el-form-item>
        <el-form-item label="不良数量">
          <el-input-number v-model="form.defect_qty" :min="0" :step="10" style="width:100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEntry = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEntry">保存</el-button>
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
