<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const props = defineProps({
  modelValue: Boolean,
  scheduleType: { type: String, default: 'sewing' },
  styleNo: { type: String, default: '' },
  color: { type: String, default: '' },
  sizeSpec: { type: String, default: '' },
  date: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const form = ref({})
const saving = ref(false)

watch(() => props.modelValue, (visible) => {
  if (visible) {
    form.value = {
      schedule_type: props.scheduleType,
      style_no: props.styleNo,
      color: props.color,
      size_spec: props.sizeSpec,
      production_date: props.date,
      completed_qty: 0,
      defect_qty: 0,
      workshop: '',
      line_team: '',
      remark: '',
    }
  }
})

async function save() {
  if (!form.value.completed_qty && form.value.completed_qty !== 0) {
    ElMessage.warning('请输入完成数量')
    return
  }
  saving.value = true
  try {
    await api.saveActual(form.value)
    ElMessage.success('录入成功')
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error('录入失败')
  }
  saving.value = false
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" @update:model-value="close" title="录入实际生产数据" width="480px">
    <el-form :model="form" label-width="80px" size="small">
      <el-form-item label="款号">
        <el-input :model-value="styleNo" disabled />
      </el-form-item>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="颜色">
            <el-input :model-value="color" disabled />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="规格">
            <el-input :model-value="sizeSpec" disabled />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="生产日期">
        <el-input :model-value="date" disabled />
      </el-form-item>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="完成数量">
            <el-input-number v-model="form.completed_qty" :min="0" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="次品数量">
            <el-input-number v-model="form.defect_qty" :min="0" style="width:100%" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="车间">
            <el-input v-model="form.workshop" placeholder="如：一车间" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="班组">
            <el-input v-model="form.line_team" placeholder="如：1班" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="备注">
        <el-input v-model="form.remark" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">提交</el-button>
    </template>
  </el-dialog>
</template>
