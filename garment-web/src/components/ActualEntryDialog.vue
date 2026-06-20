<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { useI18n } from '../composables/useI18n'

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

const { t } = useI18n()

const styleOptions = ref([])
const loading = ref(false)
const saving = ref(false)
const continuousMode = ref(false)

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

// 类型 / 工序 options (走 i18n)
const scheduleTypes = computed(() => [
  { value: 'sewing', label: t('actualEntry.type.sewing') },
  { value: 'cutting', label: t('actualEntry.type.cutting') },
  { value: 'secondary', label: t('actualEntry.type.secondary') },
])

const secondaryTypes = computed(() => [
  { value: '印花', label: t('actualEntry.process.printing') },
  { value: '刺绣', label: t('actualEntry.process.embroidery') },
  { value: '模板', label: t('actualEntry.process.template') },
  { value: '烫标', label: t('actualEntry.process.ironing') },
])

function getToday() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function initForm() {
  if (props.editRecord) {
    form.value = { ...props.editRecord }
  } else {
    form.value = {
      schedule_type: props.scheduleType || localStorage.getItem('last_schedule_type') || 'sewing',
      secondary_type: props.secondaryType || localStorage.getItem('last_secondary_type') || '',
      style_no: props.styleNo || '',
      style_id: 0,
      color: props.color || '',
      size_spec: props.sizeSpec || '',
      production_date: props.date || getToday(),
      completed_qty: 0,
      defect_qty: 0,
      workshop: props.workshop || localStorage.getItem('last_workshop') || '',
      line_team: localStorage.getItem('last_line_team') || '',
      remark: '',
    }
  }
}

watch(() => props.modelValue, async (visible) => {
  if (visible) {
    initForm()
    if (styleOptions.value.length === 0) {
      loading.value = true
      try {
        const { data } = await api.getDistinctStyles()
        styleOptions.value = data || []
      } catch { /* ignore */ }
      loading.value = false
    }
    setTimeout(() => {
      const styleSelect = document.querySelector('.dialog-form .el-select:nth-of-type(1) input')
      if (styleSelect && !props.styleNo) styleSelect.focus()
    }, 100)
  }
})

function onStyleSelect(styleNo) {
  const s = styleOptions.value.find(x => x.style_no === styleNo)
  if (s) {
    form.value.style_no = s.style_no
    form.value.style_id = s.id || 0
  }
}

function addQty(field, amount) {
  form.value[field] = Math.max(0, (form.value[field] || 0) + amount)
}

function validate() {
  if (!form.value.style_no) return t('actualEntry.toast.chooseStyle')
  if (!form.value.production_date) return t('actualEntry.toast.chooseDate')
  if (form.value.completed_qty <= 0) return t('actualEntry.toast.qtyZero')
  if (form.value.production_date > getToday()) return t('actualEntry.toast.futureDate')
  return null
}

async function save() {
  const error = validate()
  if (error) {
    ElMessage.warning(error)
    return
  }
  saving.value = true
  try {
    localStorage.setItem('last_workshop', form.value.workshop || '')
    localStorage.setItem('last_line_team', form.value.line_team || '')
    localStorage.setItem('last_schedule_type', form.value.schedule_type || '')
    localStorage.setItem('last_secondary_type', form.value.secondary_type || '')

    if (props.editRecord?.id) {
      await api.updateActual(props.editRecord.id, form.value)
      ElMessage.success(t('actualEntry.toast.editOk'))
    } else {
      await api.saveActual(form.value)
      ElMessage.success(t('actualEntry.toast.addOk'))
    }
    emit('saved')
    if (continuousMode.value && !props.editRecord) {
      form.value.completed_qty = 0
      form.value.defect_qty = 0
      form.value.remark = ''
    } else {
      emit('update:modelValue', false)
    }
  } catch (e) {
    ElMessage.error(props.editRecord?.id ? t('actualEntry.toast.editFail') : t('actualEntry.toast.addFail'))
  }
  saving.value = false
}

function close() {
  emit('update:modelValue', false)
}

function handleKeydown(e) {
  if (!props.modelValue) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault()
    save()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="close"
    :title="editRecord ? t('actualEntry.title.edit') : t('actualEntry.title.add')"
    width="480px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-form :model="form" label-width="70px" size="large" class="dialog-form">
      <el-form-item v-if="!props.scheduleType" :label="t('actualEntry.cols.type')">
        <el-select v-model="form.schedule_type" style="width: 100%">
          <el-option v-for="o in scheduleTypes" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="form.schedule_type === 'secondary' && !props.secondaryType" :label="t('actualEntry.cols.process')">
        <el-select v-model="form.secondary_type" style="width: 100%">
          <el-option v-for="o in secondaryTypes" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('actualEntry.cols.styleNo')">
        <el-select
          v-model="form.style_no"
          filterable
          :placeholder="t('actualEntry.ph.styleNo')"
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

      <el-form-item :label="t('actualEntry.cols.date')">
        <el-date-picker
          v-model="form.production_date"
          type="date"
          :placeholder="t('actualEntry.ph.date')"
          value-format="YYYY-MM-DD"
          :disabled="!!props.date"
          :disabled-date="(date) => date > new Date()"
          style="width: 100%"
        />
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="14">
          <el-form-item :label="t('actualEntry.cols.completed')">
            <div class="qty-input-group">
              <el-input-number
                v-model="form.completed_qty"
                :min="0"
                :step="10"
                controls-position="right"
                style="width: 100%"
              />
              <div class="qty-quick-btns">
                <el-button size="small" @click="addQty('completed_qty', 10)">{{ t('actualEntry.quick.10') }}</el-button>
                <el-button size="small" @click="addQty('completed_qty', 50)">{{ t('actualEntry.quick.50') }}</el-button>
                <el-button size="small" @click="addQty('completed_qty', 100)">{{ t('actualEntry.quick.100') }}</el-button>
              </div>
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="10">
          <el-form-item :label="t('actualEntry.cols.defect')">
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
          <el-form-item :label="t('actualEntry.cols.workshop')">
            <el-input v-model="form.workshop" :placeholder="t('actualEntry.ph.workshop')" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="t('actualEntry.cols.team')">
            <el-input v-model="form.line_team" :placeholder="t('actualEntry.ph.team')" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item :label="t('actualEntry.cols.remark')">
        <el-input v-model="form.remark" :placeholder="t('actualEntry.ph.remark')" />
      </el-form-item>

      <div class="form-options" v-if="!editRecord">
        <el-checkbox v-model="continuousMode" style="white-space:pre-line">{{ t('actualEntry.continuous') }}</el-checkbox>
        <span class="shortcut-hint" style="white-space:pre-line">{{ t('actualEntry.shortcut') }}</span>
      </div>
    </el-form>

    <template #footer>
      <el-button @click="close" size="large"><span style="white-space:pre-line">{{ t('actualEntry.btn.cancel') }}</span></el-button>
      <el-button type="primary" :loading="saving" @click="save" size="large" style="min-width: 120px">
        <span v-if="editRecord" style="white-space:pre-line">{{ t('actualEntry.btn.save') }}</span>
        <span v-else-if="continuousMode" style="white-space:pre-line">{{ t('actualEntry.btn.submitContinue') }}</span>
        <span v-else style="white-space:pre-line">{{ t('actualEntry.btn.submit') }}</span>
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-form {
  padding: 0 8px;
}

.qty-input-group {
  width: 100%;
}

.qty-quick-btns {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.qty-quick-btns .el-button {
  flex: 1;
  padding: 4px 0;
  font-size: 12px;
}

.form-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.shortcut-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>