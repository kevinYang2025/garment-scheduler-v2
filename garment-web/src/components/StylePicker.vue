<script setup>
import { ref, onMounted, computed } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import api from '../api'

const props = defineProps({
  modelValue: { type: Object, default: null },
  multiple: { type: Boolean, default: false },
  scheduleType: { type: String, default: '' }, // cutting / secondary / sewing
})

const emit = defineEmits(['update:modelValue', 'select'])

const visible = ref(false)
const styles = ref([])
const searchKeyword = ref('')
const selectedId = ref(null)

const groupedStyles = computed(() => {
  const groups = {}
  for (const s of styles.value) {
    const key = s.style_no
    if (!groups[key]) groups[key] = { style_no: s.style_no, product_name: s.product_name, fabric_code: s.fabric_code, category: s.category, customer: s.customer, due_date: s.due_date, secondary_types: s.secondary_types, items: [] }
    groups[key].items.push(s)
  }
  return Object.values(groups)
})

async function loadStyles() {
  const { data } = await api.getStyles(searchKeyword.value || '')
  styles.value = data
}

function select(item) {
  selectedId.value = item.id
  emit('update:modelValue', item)
  emit('select', item)
}

function confirm() {
  const item = styles.value.find(s => s.id === selectedId.value)
  if (item) {
    emit('update:modelValue', item)
    emit('select', item)
  }
  visible.value = false
}

function open() {
  visible.value = true
  selectedId.value = props.modelValue?.id || null
  loadStyles()
}

onMounted(loadStyles)

defineExpose({ open })
</script>

<template>
  <div class="style-picker">
    <div class="picker-trigger" @click="open">
      <span v-if="modelValue" class="selected">
        {{ modelValue.style_no }} - {{ modelValue.product_name }} {{ modelValue.color }} {{ modelValue.size_spec }}
      </span>
      <span v-else class="placeholder">点击选择款式...</span>
      <el-icon><ArrowDown /></el-icon>
    </div>

    <el-dialog v-model="visible" title="选择款式" width="750px">
      <el-input v-model="searchKeyword" placeholder="搜索款号、品名、客户、颜色..." clearable @input="loadStyles" style="margin-bottom:16px" />

      <div class="picker-list">
        <div v-for="group in groupedStyles" :key="group.style_no" class="picker-group">
          <div class="picker-group-header">
            <strong>{{ group.style_no }}</strong> {{ group.product_name }}
            <el-tag size="small" type="info">{{ group.fabric_code }}</el-tag>
            <el-tag size="small">{{ group.category }}</el-tag>
            <span style="color:var(--text-secondary);font-size:12px">{{ group.customer }} | 交期: {{ group.due_date }}</span>
          </div>
          <div
            v-for="item in group.items"
            :key="item.id"
            class="picker-item"
            :class="{ selected: selectedId === item.id }"
            @click="select(item)"
          >
            <span class="picker-color"><el-tag size="small" effect="plain">{{ item.color }}</el-tag></span>
            <span>尺码: {{ item.size_spec }}</span>
            <span class="picker-qty">{{ item.plan_qty?.toLocaleString() }}件</span>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="confirm">确定选择</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.picker-trigger { display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; cursor: pointer; background: var(--card); min-height: 32px; font-size: 13px; }
.picker-trigger:hover { border-color: var(--primary); }
.selected { color: var(--text); }
.placeholder { color: var(--text-tertiary); }
.picker-list { max-height: 450px; overflow-y: auto; }
.picker-group { margin-bottom: 12px; }
.picker-group-header { padding: 8px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm) var(--radius-sm) 0 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.picker-item { padding: 8px 12px; border: 1px solid var(--border); border-top: none; cursor: pointer; display: flex; align-items: center; gap: 16px; font-size: 13px; transition: background .15s; }
.picker-item:hover { background: var(--bg); }
.picker-item.selected { background: var(--primary-light); border-left: 3px solid var(--primary); }
.picker-item:last-child { border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
.picker-color { min-width: 60px; }
.picker-qty { margin-left: auto; font-weight: 500; }
</style>
