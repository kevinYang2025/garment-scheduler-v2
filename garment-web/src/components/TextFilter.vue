<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  field: { type: String, required: true },
  label: { type: String, default: '' },
  sortField: { type: String, default: '' },
  sortDir: { type: String, default: 'asc' },
  precomputed: { type: Object, default: null }, // { options: [{text, count}], emptyCount }
  active: { type: Boolean, default: false },
})

const emit = defineEmits(['filter', 'sort'])

const visible = ref(false)
const searchText = ref('')
const checkedSet = ref(new Set())
const sortBy = ref('name') // 'name' | 'count'
const sortDir = ref('asc') // 'asc' | 'desc'

// Build option list from data (or use precomputed from parent)
const allOptions = computed(() => {
  if (props.precomputed) return props.precomputed.options
  const map = {}
  for (const row of props.data) {
    const val = row[props.field] || ''
    if (!val) continue
    map[val] = (map[val] || 0) + 1
  }
  return Object.entries(map).map(([text, count]) => ({ text, count }))
})

// Filtered + sorted options
const options = computed(() => {
  let list = allOptions.value
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    list = list.filter(o => o.text.toLowerCase().includes(kw))
  }
  list = [...list].sort((a, b) => {
    const mul = sortDir.value === 'asc' ? 1 : -1
    if (sortBy.value === 'count') return (a.count - b.count) * mul
    return a.text.localeCompare(b.text, 'zh') * mul
  })
  return list
})

const totalCount = computed(() => allOptions.value.reduce((s, o) => s + o.count, 0))
const emptyCount = computed(() => props.precomputed ? props.precomputed.emptyCount : props.data.filter(r => !r[props.field]).length)
const checkedCount = computed(() => {
  let n = 0
  for (const o of allOptions.value) {
    if (checkedSet.value.has(o.text)) n += o.count
  }
  return n
})

// Init checked
watch(visible, (v) => {
  if (v && checkedSet.value.size === 0) {
    checkedSet.value = new Set(allOptions.value.map(o => o.text))
  }
})

function toggleAll() {
  if (checkedSet.value.size === allOptions.value.length) {
    checkedSet.value = new Set()
  } else {
    checkedSet.value = new Set(allOptions.value.map(o => o.text))
  }
}

function invert() {
  const next = new Set()
  for (const o of allOptions.value) {
    if (!checkedSet.value.has(o.text)) next.add(o.text)
  }
  checkedSet.value = next
}

function toggle(text) {
  const next = new Set(checkedSet.value)
  if (next.has(text)) next.delete(text)
  else next.add(text)
  checkedSet.value = next
}

function toggleEmpty() {
  // handled separately via emit
}

const includeEmpty = ref(true)

function confirm() {
  emit('filter', { checked: new Set(checkedSet.value), includeEmpty: includeEmpty.value })
  visible.value = false
}

function toggleSort(dir) {
  sortDir.value = dir
  sortBy.value = 'name'
  emit('sort', { field: props.field, sortBy: 'name', dir })
}

// Sync from props when dropdown opens
watch(visible, (v) => {
  if (v) {
    if (props.sortField) sortBy.value = props.sortField
    if (props.sortDir) sortDir.value = props.sortDir
  }
})
</script>

<template>
  <el-popover placement="bottom" :width="380" trigger="click" v-model:visible="visible">
    <template #reference>
      <span class="filter-trigger" :class="{ active }">
        {{ label }}
        <svg viewBox="0 0 1024 1024" width="14" height="14" class="filter-icon"><path d="M349 838c0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0-512 0 0 0 0 512 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0zM512 590l154-154H358l154 154z" fill="currentColor"/></svg>
      </span>
    </template>

    <div class="text-filter" @click.stop @mousedown.stop>
      <!-- Sort bar -->
      <div class="sort-bar">
        <span :class="{ active: sortDir==='asc' }" @click="toggleSort('asc')">
          {{ sortDir==='asc' ? '↑ A→Z 升序' : 'A→Z 升序' }}
        </span>
        <span :class="{ active: sortDir==='desc' }" @click="toggleSort('desc')">
          {{ sortDir==='desc' ? '↓ Z→A 降序' : 'Z→A 降序' }}
        </span>
      </div>

      <!-- Search -->
      <div class="search-row">
        <el-input v-model="searchText" placeholder="搜索..." clearable size="small" />
      </div>

      <!-- Actions -->
      <div class="action-row">
        <el-checkbox :model-value="checkedSet.size === allOptions.length" @change="toggleAll">全选({{ totalCount }})</el-checkbox>
        <el-button size="small" text @click="invert">反选</el-button>
        <el-divider direction="vertical" />
        <el-checkbox v-model="includeEmpty">空白({{ emptyCount }})</el-checkbox>
      </div>

      <!-- List -->
      <div class="option-list">
        <div v-for="opt in options" :key="opt.text" class="option-item" @click="toggle(opt.text)">
          <el-checkbox :model-value="checkedSet.has(opt.text)" @click.stop="toggle(opt.text)" />
          <span class="option-text" :title="opt.text">{{ opt.text }}</span>
          <span class="option-count">({{ opt.count }})</span>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <span class="checked-info">已选 {{ checkedCount }}/{{ totalCount }}</span>
        <el-button size="small" @click="visible=false">取消</el-button>
        <el-button size="small" type="primary" @click="confirm">确定</el-button>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.filter-trigger {
  display: inline-flex; align-items: center; gap: 2px;
  cursor: pointer; color: var(--text-secondary); font-size: 12px;
}
.filter-trigger:hover { color: var(--primary-dark); }
.filter-trigger.active { color: var(--primary); font-weight: 600; }
.filter-icon { display: inline-flex; margin-left: 2px; }
.text-filter { font-size: 13px; }
.sort-bar {
  display: flex; gap: 12px; margin-bottom: 8px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border);
}
.sort-bar span { cursor: pointer; color: var(--text-secondary); font-size: 12px; padding: 2px 6px; border-radius: 4px; }
.sort-bar span:hover { background: var(--bg); }
.sort-bar span.active { color: var(--primary-dark); font-weight: 600; background: var(--primary-light); }
.search-row { margin-bottom: 6px; }
.action-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
.option-list { max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; }
.option-item {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px; cursor: pointer; font-size: 12px;
}
.option-item:hover { background: var(--bg); }
.option-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.option-count { color: var(--text-tertiary); flex-shrink: 0; }
.footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.checked-info { flex: 1; font-size: 12px; color: var(--text-secondary); }
</style>
