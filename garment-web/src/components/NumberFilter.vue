<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  field: { type: String, required: true },
  label: { type: String, default: '' },
  sortField: { type: String, default: '' },
  sortDir: { type: String, default: 'asc' },
  precomputed: { type: Object, default: null },
})

const emit = defineEmits(['filter', 'sort'])

const visible = ref(false)
const searchText = ref('')
const checkedSet = ref(new Set())
const sortBy = ref('name')
const sortDir = ref('asc')

// Number filter state
const numFilterMode = ref('')
const numFilterVal = ref('')
const numFilterVal2 = ref('')
const numFilterActive = ref(false)
const showNumMenu = ref(false)

const numFilterLabel = computed(() => {
  const map = {
    '': '数字筛选',
    'eq': '等于...', 'ne': '不等于...',
    'gt': '大于...', 'gte': '大于或等于...',
    'lt': '小于...', 'lte': '小于或等于...',
    'between': '介于...',
  }
  return map[numFilterMode.value] || '数字筛选'
})

const popoverRef = ref(null)

// Build option list
const allOptions = computed(() => {
  if (props.precomputed) return props.precomputed.options.map(o => ({ ...o, num: parseFloat(o.text) || 0 })).sort((a, b) => a.num - b.num)
  const map = {}
  for (const row of props.data) {
    const val = row[props.field]
    const key = val != null ? String(val) : ''
    if (!key) continue
    map[key] = (map[key] || 0) + 1
  }
  return Object.entries(map)
    .map(([text, count]) => ({ text, count, num: parseFloat(text) || 0 }))
    .sort((a, b) => a.num - b.num)
})

// Filtered + sorted options
const options = computed(() => {
  let list = allOptions.value
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    list = list.filter(o => o.text.toLowerCase().includes(kw))
  }
  if (numFilterActive.value && numFilterMode.value) {
    list = list.filter(o => {
      const n = o.num
      const v = parseFloat(numFilterVal.value) || 0
      const v2 = parseFloat(numFilterVal2.value) || 0
      switch (numFilterMode.value) {
        case 'eq': return n === v
        case 'ne': return n !== v
        case 'gt': return n > v
        case 'gte': return n >= v
        case 'lt': return n < v
        case 'lte': return n <= v
        case 'between': return n >= v && n <= v2
        default: return true
      }
    })
  }
  list = [...list].sort((a, b) => {
    const mul = sortDir.value === 'asc' ? 1 : -1
    if (sortBy.value === 'count') return (a.count - b.count) * mul
    return a.text.localeCompare(b.text, 'zh') * mul
  })
  return list
})

const totalCount = computed(() => allOptions.value.reduce((s, o) => s + o.count, 0))
const emptyCount = computed(() => props.precomputed ? props.precomputed.emptyCount : props.data.filter(r => !r[props.field] && r[props.field] !== 0).length)
const checkedCount = computed(() => {
  let n = 0
  for (const o of allOptions.value) {
    if (checkedSet.value.has(o.text)) n += o.count
  }
  return n
})

watch(visible, (v) => {
  if (v && checkedSet.value.size === 0) {
    checkedSet.value = new Set(allOptions.value.map(o => o.text))
  }
})

function toggleAll() {
  if (checkedSet.value.size === allOptions.value.length) checkedSet.value = new Set()
  else checkedSet.value = new Set(allOptions.value.map(o => o.text))
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

function applyNumFilter(mode) {
  numFilterMode.value = mode
  numFilterActive.value = false
  showNumMenu.value = false
}

function confirmNumFilter() {
  numFilterActive.value = true
}

function clearNumFilter() {
  numFilterMode.value = ''
  numFilterVal.value = ''
  numFilterVal2.value = ''
  numFilterActive.value = false
  showNumMenu.value = false
}

// Click outside handler - close popover AND custom menu
function handleClickOutside(e) {
  if (!popoverRef.value) return
  const popEl = popoverRef.value.$el || popoverRef.value
  // Check if click is inside the popover content
  if (popEl && popEl.contains && popEl.contains(e.target)) return
  // Click is outside - close everything
  visible.value = false
  showNumMenu.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})
</script>

<template>
  <el-popover ref="popoverRef" placement="bottom" :width="420" trigger="click" v-model:visible="visible">
    <template #reference>
      <span class="filter-trigger">
        {{ label }}
        <svg viewBox="0 0 1024 1024" width="14" height="14" class="filter-icon"><path d="M349 838c0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0-512 0 0 0 0 512 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0zM512 590l154-154H358l154 154z" fill="currentColor"/></svg>
      </span>
    </template>

    <div class="num-filter" @click.stop @mousedown.stop>
      <!-- Sort bar -->
      <div class="sort-bar">
        <span :class="{ active: sortDir==='asc' }" @click="toggleSort('asc')">
          {{ sortDir==='asc' ? '↑ A→Z' : 'A→Z 升序' }}
        </span>
        <span :class="{ active: sortDir==='desc' }" @click="toggleSort('desc')">
          {{ sortDir==='desc' ? '↓ Z→A' : 'Z→A 降序' }}
        </span>
      </div>

      <!-- Actions row -->
      <div class="action-row" @click.stop>
        <el-checkbox :model-value="checkedSet.size === allOptions.length" @change="toggleAll">全选({{ totalCount }})</el-checkbox>
        <el-button size="small" text @click="invert">反选</el-button>
        <el-divider direction="vertical" />
        <el-checkbox v-model="includeEmpty">空白({{ emptyCount }})</el-checkbox>
        <!-- Custom number filter dropdown -->
        <span class="num-filter-link" :class="{ active: numFilterMode }" @click.stop="showNumMenu = !showNumMenu">
          {{ numFilterLabel }} ▾
        </span>
        <el-button v-if="numFilterMode" size="small" text type="danger" @click="clearNumFilter">✕</el-button>
      </div>

      <!-- Custom number filter menu -->
      <div v-if="showNumMenu" class="custom-menu" @click.stop @mousedown.stop>
        <div class="custom-menu-item" @click="applyNumFilter('eq')">等于...</div>
        <div class="custom-menu-item" @click="applyNumFilter('ne')">不等于...</div>
        <div class="custom-menu-divider"></div>
        <div class="custom-menu-item" @click="applyNumFilter('gt')">大于...</div>
        <div class="custom-menu-item" @click="applyNumFilter('gte')">大于或等于...</div>
        <div class="custom-menu-item" @click="applyNumFilter('lt')">小于...</div>
        <div class="custom-menu-item" @click="applyNumFilter('lte')">小于或等于...</div>
        <div class="custom-menu-divider"></div>
        <div class="custom-menu-item" @click="applyNumFilter('between')">介于...</div>
        <div class="custom-menu-divider"></div>
        <div class="custom-menu-item" @click="clearNumFilter">清除筛选</div>
      </div>

      <!-- Number filter inputs -->
      <div v-if="numFilterMode && numFilterMode !== 'between'" class="num-input-row" @click.stop>
        <span class="num-op">{{ numFilterLabel.replace('...', '') }}</span>
        <el-input-number v-model="numFilterVal" size="small" controls-position="right" style="width:140px" />
        <el-button size="small" :type="numFilterActive ? '' : 'primary'" @click="confirmNumFilter">{{ numFilterActive ? '更新' : '应用' }}</el-button>
      </div>
      <div v-if="numFilterMode === 'between'" class="num-input-row" @click.stop>
        <el-input-number v-model="numFilterVal" size="small" controls-position="right" style="width:120px" />
        <span class="num-op">至</span>
        <el-input-number v-model="numFilterVal2" size="small" controls-position="right" style="width:120px" />
        <el-button size="small" :type="numFilterActive ? '' : 'primary'" @click="confirmNumFilter">{{ numFilterActive ? '更新' : '应用' }}</el-button>
      </div>

      <!-- Search -->
      <div class="search-row" @click.stop>
        <el-input v-model="searchText" placeholder="搜索..." clearable size="small" />
      </div>

      <!-- List -->
      <div class="option-list" @click.stop>
        <div v-for="opt in options" :key="opt.text" class="option-item" @click="toggle(opt.text)">
          <el-checkbox :model-value="checkedSet.has(opt.text)" @click.stop="toggle(opt.text)" />
          <span class="option-text" :title="opt.text">{{ opt.text }}</span>
          <span class="option-count">({{ opt.count }})</span>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer" @click.stop>
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
  cursor: pointer; color: var(--text-secondary, #909399); font-size: 12px;
}
.filter-trigger:hover { color: var(--primary-dark, #409eff); }
.filter-icon { display: inline-flex; margin-left: 2px; }
.num-filter { font-size: 13px; position: relative; }
.sort-bar {
  display: flex; gap: 12px; margin-bottom: 8px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border, #e4e7ed);
}
.sort-bar span { cursor: pointer; color: var(--text-secondary, #909399); font-size: 12px; padding: 2px 6px; border-radius: 4px; }
.sort-bar span:hover { background: var(--bg, #f5f7fa); }
.sort-bar span.active { color: var(--primary); font-weight: 600; background: var(--primary-light); }
.num-filter-link {
  cursor: pointer; font-size: 12px; color: var(--text-secondary);
}
.num-filter-link:hover, .num-filter-link.active { color: var(--primary); }
.custom-menu {
  position: absolute; left: 50%; top: 70px; transform: translateX(-50%);
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md); z-index: 10; min-width: 180px; padding: 4px 0;
}
.custom-menu-item {
  padding: 6px 16px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.custom-menu-item:hover { background: var(--primary-light); color: var(--primary); }
.custom-menu-divider { height: 1px; background: var(--border); margin: 4px 0; }
.num-input-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.num-op { font-size: 12px; color: var(--text-secondary, #909399); flex-shrink: 0; }
.search-row { margin-bottom: 6px; }
.action-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
.option-list { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.option-item {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px; cursor: pointer; font-size: 12px;
}
.option-item:hover { background: var(--bg, #f5f7fa); }
.option-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.option-count { color: var(--text-tertiary); flex-shrink: 0; }
.footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.checked-info { flex: 1; font-size: 12px; color: var(--text-secondary, #909399); }
</style>
