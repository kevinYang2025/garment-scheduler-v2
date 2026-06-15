<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const props = defineProps({
  modelValue: Boolean,
  editRecord: { type: Object, default: null },
  scheduleType: { type: String, default: '' },
  secondaryType: { type: String, default: '' },
  workshop: { type: String, default: '' },
  styleNo: { type: String, default: '' },
  color: { type: String, default: '' },
  sizeSpec: { type: String, default: '' },
  date: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const styleOptions = ref([])
const loading = ref(false)
const saving = ref(false)

const form = ref({
  schedule_type: 'sewing',
  secondary_type: '',
  style_no: '',
  style_id: 0,
  color: '',
  size_spec: '',
  production_date: new Date().toISOString().slice(0, 10),
  completed_qty: 0,
  defect_qty: 0,
  workshop: '',
  line_team: '',
  remark: '',
})

const scheduleTypes = [
  { value: 'sewing', label: '缝制' },
  { value: 'cutting', label: '裁剪' },
  { value: 'secondary', label: '二次加工' },
]

const secondaryTypes = [
  { value: '印花', label: '印花' },
  { value: '刺绣', label: '刺绣' },
  { value: '模板', label: '模板' },
  { value: '烫标', label: '烫标' },
]

watch(() => props.modelValue, async (visible) => {
  if (visible) {
    if (props.editRecord) {
      form.value = { ...props.editRecord }
    } else {
      const isFromGantt = !!props.styleNo
      form.value = {
        schedule_type: props.scheduleType || 'sewing',
        secondary_type: props.secondaryType || '',
        style_no: props.styleNo || '',
        style_id: 0,
        color: props.color || '',
        size_spec: props.sizeSpec || '',
        production_date: props.date || new Date().toISOString().slice(0, 10),
        completed_qty: 0,
        defect_qty: 0,
        workshop: props.workshop || localStorage.getItem('last_workshop') || '',
        line_team: isFromGantt ? (localStorage.getItem('last_line_team') || '') : (localStorage.getItem('last_line_team') || ''),
        remark: '',
      }
    }
    if (styleOptions.value.length === 0) {
      loading.value = true
      try {
        const { data } = await api.getDistinctStyles()
        styleOptions.value = data || []
      } catch { /* ignore */ }
      loading.value = false
    }
  }
})

function onStyleSelect(styleNo) {
  const s = styleOptions.value.find(x => x.style_no === styleNo)
  if (s) {
    form.value.style_no = s.style_no
    form.value.style_id = s.id || 0
  }
}

async function save() {
  if (!form.value.style_no) {
    ElMessage.warning('请选择款号')
    return
  }
  if (form.value.completed_qty <= 0) {
    ElMessage.warning('请输入完成数量')
    return
  }
  saving.value = true
  try {
    localStorage.setItem('last_workshop', form.value.workshop || '')
    localStorage.setItem('last_line_team', form.value.line_team || '')

    if (props.editRecord?.id) {
      await api.updateActual(props.editRecord.id, form.value)
      ElMessage.success('修改成功')
    } else {
      await api.saveActual(form.value)
      ElMessage.success('录入成功')
    }
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(props.editRecord?.id ? '修改失败' : '录入失败')
  }
  saving.value = false
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="close"
    :title="editRecord ? '修改报工' : '录入报工'"
    width="460px"
    :close-on-click-modal="false"
  >
    <el-form :model="form" label-width="70px" size="large">
      <el-form-item v-if="!props.scheduleType" label="类型">
        <el-select v-model="form.schedule_type" style="width: 100%">
          <el-option v-for="o in scheduleTypes" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="form.schedule_type === 'secondary' && !props.secondaryType" label="工序">
        <el-select v-model="form.secondary_type" style="width: 100%">
          <el-option v-for="o in secondaryTypes" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item label="款号">
        <el-select
          v-model="form.style_no"
          filterable
          placeholder="搜索款号..."
          :loading="loading"
          :disabled="!!props.styleNo"
          style="width: 100%"
          @change="onStyleSelect"
        >
          <el-option
            v-for="s in styleOptions"
            :key="s.style_no"
            :label="s.style_no"
            :value="s.style_no"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="日期">
        <el-date-picker
          v-model="form.production_date"
          type="date"
          placeholder="选择日期"
          value-format="YYYY-MM-DD"
          :disabled="!!props.date"
          style="width: 100%"
        />
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="14">
          <el-form-item label="完成数">
            <el-input-number
              v-model="form.completed_qty"
              :min="0"
              :step="10"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="10">
          <el-form-item label="次品">
            <el-input-number
              v-model="form.defect_qty"
              :min="0"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="车间">
            <el-input v-model="form.workshop" placeholder="如: A车间" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="班组">
            <el-input v-model="form.line_team" placeholder="如: 1班" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="备注">
        <el-input v-model="form.remark" placeholder="可选" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close" size="large">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save" size="large" style="min-width: 120px">
        {{ editRecord ? '保存' : '提交' }}
      </el-button>
    </template>
  </el-dialog>
</template>
