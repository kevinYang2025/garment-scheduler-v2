<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] }, // all rows
  field: { type: String, required: true },   // date field key
  label: { type: String, default: '' },
  sortField: { type: String, default: '' },
  sortDir: { type: String, default: 'asc' },
  active: { type: Boolean, default: false },
})

const emit = defineEmits(['filter', 'sort'])

const sortBy = ref('date') // 'date' | 'count'
const sortDir = ref('asc')

const visible = ref(false)
const searchText = ref('')
const checkedKeys = ref([])

// Build tree from date strings
const treeData = computed(() => {
  const map = {}
  for (const row of props.data) {
    const raw = row[props.field]
    if (!raw) continue
    const d = raw.includes('T') ? raw.slice(0, 10) : raw
    if (!d || d.length < 7) continue
    const year = d.slice(0, 4)
    const month = d.slice(0, 7)
    const day = d
    if (!map[year]) map[year] = {}
    if (!map[year][month]) map[year][month] = {}
    map[year][month][day] = (map[year][month][day] || 0) + 1
  }

  const result = []
  let total = 0
  for (const year of Object.keys(map).sort()) {
    const yearNode = { label: year + '年', value: '__year__' + year, children: [] }
    let yearCount = 0
    for (const month of Object.keys(map[year]).sort()) {
      const monthLabel = parseInt(month.slice(5, 7)) + '月'
      const monthNode = { label: monthLabel, value: '__month__' + month, children: [] }
      let monthCount = 0
      for (const day of Object.keys(map[year][month]).sort()) {
        const dayLabel = parseInt(day.slice(8, 10)) + '日'
        monthNode.children.push({ label: dayLabel + ' (' + map[year][month][day] + ')', value: day, count: map[year][month][day] })
        monthCount += map[year][month][day]
      }
      monthNode.label = monthLabel + ' (' + monthCount + ')'
      yearNode.children.push(monthNode)
      yearCount += monthCount
    }
    yearNode.label = year + '年 (' + yearCount + ')'
    result.push(yearNode)
    total += yearCount
  }
  result.unshift({ label: '空白 (0)', value: '__empty__' })
  result.unshift({ label: '全选 (' + total + ')', value: '__all__' })
  return result
})

// Filter tree by search text
const filteredTree = computed(() => {
  if (!searchText.value) return treeData.value
  const kw = searchText.value.toLowerCase()
  return treeData.value.map(n => {
    if (n.value === '__all__' || n.value === '__empty__') return n
    if (!n.children) return n.label.toLowerCase().includes(kw) ? n : null
    const filteredChildren = n.children.map(c => {
      if (!c.children) return c.label.toLowerCase().includes(kw) ? c : null
      const filteredGrandchildren = c.children.filter(cc => cc.label.toLowerCase().includes(kw))
      return filteredGrandchildren.length > 0 || c.label.toLowerCase().includes(kw)
        ? { ...c, children: filteredGrandchildren }
        : null
    }).filter(Boolean)
    return filteredChildren.length > 0 ? { ...n, children: filteredChildren } : null
  }).filter(Boolean)
})

// Initialize checked keys
watch(visible, (v) => {
  if (v && checkedKeys.value.length === 0) {
    // Check all by default
    const keys = []
    for (const yearNode of treeData.value) {
      if (yearNode.value === '__all__' || yearNode.value === '__empty__') continue
      keys.push(yearNode.value)
      if (yearNode.children) {
        for (const monthNode of yearNode.children) {
          keys.push(monthNode.value)
          if (monthNode.children) {
            for (const dayNode of monthNode.children) {
              keys.push(dayNode.value)
            }
          }
        }
      }
    }
    checkedKeys.value = keys
  }
})

function onCheck(data, { checkedKeys: ck }) {
  checkedKeys.value = ck
}

function selectAll() {
  const keys = []
  for (const yearNode of treeData.value) {
    if (yearNode.value === '__all__' || yearNode.value === '__empty__') continue
    keys.push(yearNode.value)
    if (yearNode.children) {
      for (const monthNode of yearNode.children) {
        keys.push(monthNode.value)
        if (monthNode.children) {
          for (const dayNode of monthNode.children) {
            keys.push(dayNode.value)
          }
        }
      }
    }
  }
  checkedKeys.value = keys
}

function selectEmpty() {
  checkedKeys.value = ['__empty__']
}

function clearAll() {
  checkedKeys.value = []
}

function confirm() {
  const checkedSet = new Set(checkedKeys.value)
  const hasEmpty = checkedSet.has('__empty__')
  // Collect all date values that are checked
  const validDates = new Set()
  for (const yearNode of treeData.value) {
    if (yearNode.value === '__all__' || yearNode.value === '__empty__') continue
    if (yearNode.children) {
      for (const monthNode of yearNode.children) {
        if (monthNode.children) {
          for (const dayNode of monthNode.children) {
            if (checkedSet.has(dayNode.value)) {
              validDates.add(dayNode.value)
            }
          }
        }
      }
    }
  }
  emit('filter', { validDates, hasEmpty })
  visible.value = false
}

const activeCount = computed(() => checkedKeys.value.length)

function toggleSort(dir) {
  sortDir.value = dir
  sortBy.value = 'date'
  emit('sort', { field: props.field, sortBy: 'date', dir })
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
  <el-popover placement="bottom" :width="320" trigger="click" v-model:visible="visible">
    <template #reference>
      <span class="filter-trigger" :class="{ active }">
        {{ label }}
        <el-icon class="filter-icon"><svg viewBox="0 0 1024 1024" width="14" height="14"><path d="M349 838c0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0-512 0 0 0 0 512 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0zM512 590l154-154H358l154 154z" fill="currentColor"/></svg></el-icon>
      </span>
    </template>
    <div class="date-filter" @click.stop @mousedown.stop>
      <div class="sort-bar">
        <span :class="{ active: sortDir==='asc' }" @click="toggleSort('asc')">
          {{ sortDir==='asc' ? '↑ 日期升序' : '日期升序' }}
        </span>
        <span :class="{ active: sortDir==='desc' }" @click="toggleSort('desc')">
          {{ sortDir==='desc' ? '↓ 日期降序' : '日期降序' }}
        </span>
      </div>
      <el-input v-model="searchText" placeholder="搜索..." clearable size="small" style="margin-bottom:8px" prefix-icon="Search" />
      <div class="filter-actions">
        <el-button size="small" text @click="selectAll">全选</el-button>
        <el-button size="small" text @click="clearAll">清空</el-button>
        <el-button size="small" text @click="selectEmpty">仅空白</el-button>
      </div>
      <el-tree
        :data="filteredTree"
        show-checkbox
        node-key="value"
        :default-checked-keys="checkedKeys"
        :props="{ label: 'label', children: 'children' }"
        @check="onCheck"
        default-expand-all
        :expand-on-click-node="false"
        style="max-height:300px;overflow-y:auto"
      />
      <div style="text-align:right;margin-top:8px">
        <el-button size="small" @click="visible=false">取消</el-button>
        <el-button size="small" type="primary" @click="confirm">确定</el-button>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12px;
}
.filter-trigger:hover { color: var(--primary-dark); }
.filter-trigger.active { color: var(--primary-dark); font-weight: 600; }
.filter-icon { display: inline-flex; }
.date-filter { font-size: 13px; }
.sort-bar {
  display: flex; gap: 12px; margin-bottom: 8px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border);
}
.sort-bar span {
  cursor: pointer; color: var(--text-secondary);
  font-size: 12px; padding: 2px 6px; border-radius: 4px;
}
.sort-bar span:hover { background: var(--bg); }
.sort-bar span.active { color: var(--primary); font-weight: 600; background: var(--primary-light); }
.filter-actions { display: flex; gap: 4px; margin-bottom: 6px; }
</style>
