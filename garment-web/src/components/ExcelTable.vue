<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import DateFilter from './DateFilter.vue'
import TextFilter from './TextFilter.vue'
import NumberFilter from './NumberFilter.vue'

const props = defineProps({
  /** Column definitions: { field, label, width, type: 'text'|'number'|'date', editable? } */
  columns: { type: Array, required: true },
  /** Row data array */
  data: { type: Array, default: () => [] },
  /** Show checkbox column for selection */
  selectable: { type: Boolean, default: false },
  /** Show action column with edit/delete buttons */
  editable: { type: Boolean, default: false },
  /** Show action column with delete button only */
  removable: { type: Boolean, default: false },
  /** Row key field (default 'id') */
  rowKey: { type: String, default: 'id' },
})

const emit = defineEmits(['selection-change', 'edit-save', 'edit-cancel', 'delete'])

const bodyRef = ref(null)

// --- Filter states ---
const textFilters = ref({})
const numFilters = ref({})
const dateFilters = ref({})
const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })
const precomputedOptions = ref({})

function computeFilterOptions() {
  const opts = {}
  for (const col of props.columns) {
    if (col.type === 'text') {
      const map = new Map()
      let emptyCount = 0
      for (const r of props.data) {
        const v = String(r[col.field] || '')
        if (!v) { emptyCount++; continue }
        map.set(v, (map.get(v) || 0) + 1)
      }
      opts[col.field] = { options: [...map.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count), emptyCount }
    } else if (col.type === 'number') {
      const map = new Map()
      let emptyCount = 0
      for (const r of props.data) {
        const v = r[col.field]
        const key = v != null ? String(v) : ''
        if (!key) { emptyCount++; continue }
        map.set(key, (map.get(key) || 0) + 1)
      }
      opts[col.field] = { options: [...map.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => parseFloat(a.text) - parseFloat(b.text)), emptyCount }
    } else if (col.type === 'date') {
      const dates = new Set()
      let hasEmpty = false
      for (const r of props.data) {
        const d = (r[col.field] || '').slice(0, 10)
        if (!d) { hasEmpty = true; continue }
        dates.add(d)
      }
      opts[col.field] = { dates, hasEmpty }
    }
  }
  precomputedOptions.value = opts
}

function onTextFilter(field, f) { textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } } }
function onNumFilter(field, f) { numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } } }
function onDateFilter(field, f) { dateFilters.value = { ...dateFilters.value, [field]: { ...f, applied: true } } }
function onSort(field, sortBy, dir) { sortState.value = { field, sortBy, dir } }

// --- Filtering + sorting ---
const filteredRecords = computed(() => {
  let list = props.data
  for (const [field, f] of Object.entries(textFilters.value)) {
    if (!f.applied) continue
    if (f.validValues && f.validValues.size > 0) {
      list = list.filter(r => {
        const v = String(r[field] || '')
        return f.validValues.has(v) || (f.hasEmpty && !v)
      })
    }
  }
  for (const [field, f] of Object.entries(dateFilters.value)) {
    if (!f.applied) continue
    if (f.validDates && f.validDates.size > 0) {
      list = list.filter(r => {
        const d = (r[field] || '').slice(0, 10)
        return f.validDates.has(d) || (f.hasEmpty && !d)
      })
    }
  }
  for (const [field, f] of Object.entries(numFilters.value)) {
    if (!f.applied) continue
    if (f.checked && f.checked.size > 0) {
      list = list.filter(r => {
        const v = r[field]
        const key = v != null ? String(v) : ''
        return f.checked.has(key) || (f.includeEmpty && !key)
      })
    }
  }
  if (sortState.value.field) {
    const { field, sortBy, dir } = sortState.value
    const d = dir === 'asc' ? 1 : -1
    if (sortBy === 'count') {
      const countMap = new Map()
      for (const r of list) {
        const v = r[field] ?? ''
        countMap.set(v, (countMap.get(v) || 0) + 1)
      }
      list = [...list].sort((a, b) => (countMap.get(a[field] ?? '') - countMap.get(b[field] ?? '')) * d)
    } else {
      list = [...list].sort((a, b) => {
        if (sortBy === 'date') {
          return ((a[field] || '').localeCompare(b[field] || '')) * d
        }
        const av = a[field] ?? '', bv = b[field] ?? ''
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * d
        return String(av).localeCompare(String(bv)) * d
      })
    }
  }
  return list
})

// Recompute filter options when data changes
watch(() => props.data, () => { nextTick(() => computeFilterOptions()) }, { immediate: true })

// --- Selection ---
const selectedIds = ref(new Set())
const isAllSelected = computed(() => filteredRecords.value.length > 0 && filteredRecords.value.every(r => selectedIds.value.has(r[props.rowKey])))
const selectedCount = computed(() => selectedIds.value.size)

function toggleSelect(id) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedIds.value = s
  emit('selection-change', [...s])
}
function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(filteredRecords.value.map(r => r[props.rowKey]))
  }
  emit('selection-change', [...selectedIds.value])
}
function clearSelection() {
  selectedIds.value = new Set()
  emit('selection-change', [])
}

// --- Inline editing ---
const editingId = ref(null)
const editForm = ref({})

function startEdit(row) {
  editingId.value = row[props.rowKey]
  editForm.value = { ...row }
}
function cancelEdit() {
  editingId.value = null
  editForm.value = {}
  emit('edit-cancel')
}
function saveEdit() {
  emit('edit-save', { ...editForm.value })
  editingId.value = null
  editForm.value = {}
}
function remove(row) {
  emit('delete', row[props.rowKey])
}

// --- Drag to scroll ---
let dragging = false, dragX = 0, dragY = 0, dragSL = 0, dragST = 0, dragWrap = null
function onDragStart(e) {
  if (e.target.tagName !== 'TD' && e.target.tagName !== 'TH') return
  dragWrap = e.currentTarget
  dragging = true
  dragX = e.pageX; dragY = e.pageY
  dragSL = dragWrap.scrollLeft; dragST = dragWrap.scrollTop
  dragWrap.classList.add('dragging')
  e.preventDefault()
}
function onDragMove(e) {
  if (!dragging || !dragWrap) return
  dragWrap.scrollLeft = dragSL - (e.pageX - dragX)
  dragWrap.scrollTop = dragST - (e.pageY - dragY)
}
function onDragEnd() {
  if (dragWrap) dragWrap.classList.remove('dragging')
  dragging = false; dragWrap = null
}

onMounted(() => {
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
})
onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})

// --- Format date ---
function fmtDate(d) {
  if (!d) return ''
  if (typeof d === 'string' && d.includes('T')) return d.slice(0, 10)
  return d
}

// Expose methods for parent
defineExpose({ clearSelection, selectedCount, filteredRecords })
</script>

<template>
  <div class="excel-wrap">
    <div class="excel-body" ref="bodyRef" @mousedown="onDragStart">
      <table class="excel-table">
        <thead>
          <tr>
            <th v-if="selectable" style="width:40px;text-align:center">
              <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" class="chk" />
            </th>
            <th v-for="col in columns" :key="col.field" :style="{ width: col.width + 'px', minWidth: col.width + 'px' }">
              <div class="col-header">
                <DateFilter v-if="col.type==='date'" :data="data" :field="col.field" :label="col.label" @filter="f => onDateFilter(col.field, f)" />
                <NumberFilter v-else-if="col.type==='number'" :data="data" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" @filter="f => onNumFilter(col.field, f)" @sort="onSort" />
                <TextFilter v-else :data="data" :field="col.field" :label="col.label" :precomputed="precomputedOptions[col.field]" @filter="f => onTextFilter(col.field, f)" @sort="onSort" />
              </div>
            </th>
            <th v-if="editable || removable" style="width:120px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredRecords" :key="row[rowKey]" :class="{ 'editing-row': editingId === row[rowKey], 'selected-row': selectedIds.has(row[rowKey]) }">
            <td v-if="selectable" class="chk-cell" style="width:40px">
              <input type="checkbox" :checked="selectedIds.has(row[rowKey])" @change="toggleSelect(row[rowKey])" class="chk" />
            </td>
            <td v-for="col in columns" :key="col.field" :style="{ width: col.width + 'px', minWidth: col.width + 'px' }"
                :class="{ 'num': col.type === 'number' }">
              <template v-if="editingId === row[rowKey] && col.editable !== false">
                <input v-if="col.type === 'date'" class="inp" v-model="editForm[col.field]" type="date" />
                <input v-else-if="col.type === 'number'" class="inp" v-model.number="editForm[col.field]" type="number" min="0" />
                <input v-else class="inp" v-model="editForm[col.field]" />
              </template>
              <template v-else>
                <span v-if="col.type === 'date'">{{ fmtDate(row[col.field]) }}</span>
                <span v-else-if="col.type === 'number'">{{ row[col.field] }}</span>
                <span v-else>{{ row[col.field] }}</span>
              </template>
            </td>
            <td v-if="editable || removable" class="action-cell" style="width:120px">
              <template v-if="editingId === row[rowKey]">
                <el-button size="small" text type="primary" @click="saveEdit">保存</el-button>
                <el-button size="small" text @click="cancelEdit">取消</el-button>
              </template>
              <template v-else>
                <el-button v-if="editable" size="small" text @click="startEdit(row)">编辑</el-button>
                <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!filteredRecords.length" class="empty-table">暂无数据</div>
    </div>
  </div>
</template>

<style scoped>
.excel-wrap { flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
.excel-wrap.dragging,
.excel-wrap.dragging td,
.excel-wrap.dragging th,
.excel-wrap.dragging input { user-select: none !important; }

.excel-body { overflow: auto; flex: 1; }

.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); min-width: 100%; width: 100%; }
.excel-table thead th { padding: 0; background: var(--card); color: var(--text-tertiary); font-size: 11px; font-weight: 500; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap; position: sticky; top: 0; z-index: 3; }
.excel-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-light); white-space: nowrap; text-align: center; }

.col-header { display: flex; align-items: center; justify-content: center; padding: 10px 8px; }
.col-header span { font-weight: 500; font-size: 11px; }

.num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }

.chk-cell { text-align: center !important; }
.chk { width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary); }

tr.selected-row { background: var(--primary-light) !important; }
tr.editing-row { background: var(--primary-light) !important; }
tbody tr:hover td { background: var(--primary-light); }

.action-cell { text-align: center !important; white-space: nowrap; }

.inp { width: 100%; border: 1px solid var(--border); text-align: left; font-size: 13px; padding: 4px 8px; background: var(--card); border-radius: 4px; font-family: inherit; }
.inp:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 2px rgba(0,0,0,.06); }

.empty-table { text-align: center; padding: 40px; color: var(--text-tertiary); font-size: 14px; }
</style>
