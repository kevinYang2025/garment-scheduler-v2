<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import * as XLSX from 'xlsx'

const props = defineProps({
  modelValue: Boolean,
  scheduleType: { type: String, default: '' },
  secondaryType: { type: String, default: '' },
  workshop: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'imported'])

const importing = ref(false)
const previewData = ref([])
const fileName = ref('')

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
      ElMessage.error('文件解析失败')
    }
  }
  reader.readAsArrayBuffer(file)
}

async function doImport() {
  if (previewData.value.length === 0) {
    ElMessage.warning('没有可导入的数据')
    return
  }
  importing.value = true
  try {
    const { data } = await api.batchImportActual(previewData.value)
    ElMessage.success(`成功导入 ${data.inserted} 条记录`)
    emit('imported')
    emit('update:modelValue', false)
    previewData.value = []
    fileName.value = ''
  } catch {
    ElMessage.error('导入失败')
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
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="close"
    title="批量导入报工"
    width="600px"
    :close-on-click-modal="false"
  >
    <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px">
      <el-button size="small" @click="downloadTemplate">下载模板</el-button>
      <input type="file" accept=".xlsx,.xls" @change="onFileChange" style="display:none" ref="fileInput" />
      <el-button type="primary" size="small" @click="$refs.fileInput.click()">选择文件</el-button>
      <span v-if="fileName" style="color: var(--text-secondary); font-size: 13px">{{ fileName }}</span>
    </div>

    <div v-if="previewData.length > 0" style="margin-bottom: 8px; font-size: 13px; color: var(--text-secondary)">
      预览：共 {{ previewData.length }} 条记录
    </div>

    <el-table
      v-if="previewData.length > 0"
      :data="previewData"
      size="small"
      max-height="300"
      stripe
      style="width: 100%"
    >
      <el-table-column prop="schedule_type" label="类型" width="80">
        <template #default="{ row }">
          {{ row.schedule_type === 'sewing' ? '缝制' : row.schedule_type === 'cutting' ? '裁剪' : '二次' }}
        </template>
      </el-table-column>
      <el-table-column prop="style_no" label="款号" min-width="120" show-overflow-tooltip />
      <el-table-column prop="production_date" label="日期" width="110" />
      <el-table-column prop="completed_qty" label="完成数" width="80" align="right" />
      <el-table-column prop="defect_qty" label="次品" width="70" align="right" />
      <el-table-column prop="workshop" label="车间" width="80" />
      <el-table-column prop="line_team" label="班组" width="70" />
    </el-table>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button
        type="primary"
        :loading="importing"
        :disabled="previewData.length === 0"
        @click="doImport"
      >
        确认导入 ({{ previewData.length }}条)
      </el-button>
    </template>
  </el-dialog>
</template>
