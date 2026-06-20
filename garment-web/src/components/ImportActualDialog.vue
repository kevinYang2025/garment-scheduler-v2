<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { useI18n } from '../composables/useI18n'
import * as XLSX from 'xlsx'

const props = defineProps({
  modelValue: Boolean,
  scheduleType: { type: String, default: '' },
  secondaryType: { type: String, default: '' },
  workshop: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'imported'])

const { t } = useI18n()

const importing = ref(false)
const previewData = ref([])
const fileName = ref('')
const fileInputRef = ref(null)

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = (evt) => {
    try {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)
      previewData.value = rows.map(r => ({
        schedule_type: props.scheduleType || r['类型'] || r['schedule_type'] || 'sewing',
        secondary_type: props.secondaryType || r['工序'] || r['secondary_type'] || '',
        style_no: r['款号'] || r['style_no'] || '',
        production_date: r['日期'] || r['production_date'] || '',
        completed_qty: parseInt(r['完成数量'] || r['completed_qty'] || 0),
        defect_qty: parseInt(r['次品数量'] || r['defect_qty'] || 0),
        workshop: props.workshop || r['车间'] || r['workshop'] || '',
        line_team: r['班组'] || r['line_team'] || '',
        remark: r['备注'] || r['remark'] || '',
      })).filter(r => r.style_no && r.production_date)
    } catch {
      ElMessage.error(t('importActual.toast.parseFail'))
    }
  }
  reader.readAsArrayBuffer(file)
}

async function doImport() {
  if (previewData.value.length === 0) {
    ElMessage.warning(t('importActual.toast.empty'))
    return
  }
  importing.value = true
  try {
    const { data } = await api.batchImportActual(previewData.value)
    ElMessage.success(t('importActual.toast.importOk', null, { count: data.inserted }))
    emit('imported')
    emit('update:modelValue', false)
    previewData.value = []
    fileName.value = ''
  } catch {
    ElMessage.error(t('importActual.toast.importFail'))
  }
  importing.value = false
}

function close() {
  emit('update:modelValue', false)
  previewData.value = []
  fileName.value = ''
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['类型', '款号', '日期', '完成数量', '次品数量', '车间', '班组', '备注'],
    ['sewing', 'ABC-001', '2026-06-15', 100, 2, 'A车间', '1班', ''],
    ['cutting', 'DEF-002', '2026-06-15', 500, 0, 'B车间', '2班', ''],
  ])
  XLSX.utils.book_append_sheet(wb, ws, '报工模板')
  XLSX.writeFile(wb, '报工导入模板.xlsx')
}

function typeLabel(s) {
  return s ? t('importActual.type.' + s, null) : ''
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="close"
    :title="t('importActual.title')"
    width="600px"
    :close-on-click-modal="false"
  >
    <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px">
      <el-button size="small" @click="downloadTemplate"><span style="white-space:pre-line">{{ t('importActual.btn.template') }}</span></el-button>
      <input type="file" accept=".xlsx,.xls" @change="onFileChange" style="display:none" ref="fileInputRef" />
      <el-button type="primary" size="small" @click="fileInputRef.click()"><span style="white-space:pre-line">{{ t('importActual.btn.chooseFile') }}</span></el-button>
      <span v-if="fileName" style="color: var(--text-secondary); font-size: 13px">{{ fileName }}</span>
    </div>

    <div v-if="previewData.length > 0" style="margin-bottom: 8px; font-size: 13px; color: var(--text-secondary); white-space:pre-line">
      {{ t('importActual.preview.count', null, { count: previewData.length }) }}
    </div>

    <el-table
      v-if="previewData.length > 0"
      :data="previewData"
      size="small"
      max-height="300"
      stripe
      style="width: 100%"
    >
      <el-table-column prop="schedule_type" :label="t('importActual.cols.type')" width="80">
        <template #default="{ row }">
          {{ typeLabel(row.schedule_type) }}
        </template>
      </el-table-column>
      <el-table-column prop="style_no" :label="t('importActual.cols.styleNo')" min-width="120" show-overflow-tooltip />
      <el-table-column prop="production_date" :label="t('importActual.cols.date')" width="110" />
      <el-table-column prop="completed_qty" :label="t('importActual.cols.completed')" width="80" align="right" />
      <el-table-column prop="defect_qty" :label="t('importActual.cols.defect')" width="70" align="right" />
      <el-table-column prop="workshop" :label="t('importActual.cols.workshop')" width="80" />
      <el-table-column prop="line_team" :label="t('importActual.cols.team')" width="70" />
    </el-table>

    <template #footer>
      <el-button @click="close"><span style="white-space:pre-line">{{ t('importActual.btn.cancel') }}</span></el-button>
      <el-button
        type="primary"
        :loading="importing"
        :disabled="previewData.length === 0"
        @click="doImport"
      >
        <span style="white-space:pre-line">{{ t('importActual.btn.confirm', null, { count: previewData.length }) }}</span>
      </el-button>
    </template>
  </el-dialog>
</template>