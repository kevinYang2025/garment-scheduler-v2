<template>
  <el-popover placement="bottom-end" :width="240" trigger="click">
    <template #reference>
      <button class="switcher-trigger" title="切换数据指标">
        <el-icon><Setting /></el-icon>
      </button>
    </template>
    <div class="switcher-menu">
      <div class="switcher-title">切换数据指标</div>
      <div
        v-for="m in metrics"
        :key="m.key"
        class="switcher-item"
        :class="{ active: m.key === modelValue }"
        @click="select(m.key)"
      >
        <span class="dot" :style="{ background: m.color }"></span>
        <span class="label">{{ m.label }}</span>
        <el-icon v-if="m.key === modelValue" class="check"><Check /></el-icon>
      </div>
    </div>
  </el-popover>
</template>

<script setup>
import { Setting, Check } from '@element-plus/icons-vue'

defineProps({
  modelValue: { type: String, required: true },
  metrics:    { type: Array,  required: true }
})

const emit = defineEmits(['update:modelValue'])

function select(key) {
  emit('update:modelValue', key)
}
</script>

<style scoped>
.switcher-trigger {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #4f46e5;
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s;
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.4);
}
.switcher-trigger:hover {
  transform: rotate(45deg);
}
.switcher-menu {
  max-height: 320px;
  overflow-y: auto;
}
.switcher-title {
  font-size: 11px;
  color: #9ca3af;
  margin-bottom: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.switcher-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  transition: background 0.15s;
}
.switcher-item:hover {
  background: #f9fafb;
}
.switcher-item.active {
  background: #eef2ff;
  color: #4f46e5;
  font-weight: 600;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.label {
  flex: 1;
}
.check {
  color: #4f46e5;
  font-size: 16px;
}
</style>
