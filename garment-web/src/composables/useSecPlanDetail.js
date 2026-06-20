// 二次加工排程详情通用逻辑(4 个详情页共用)
// 4 个文件(Printing/Embroidery/Ironing/TemplatePlanDetail.vue)原本 99% 相同,
// 抽到此处统一维护,各视图只保留 create/import 的差异部分。
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { useVirtualScroll } from './useVirtualScroll'
import { todayLocal } from '../utils/date'
import { getSecondaryTypeConfig } from '../constants/secondaryTypes'
import { useAuthStore } from '../stores/auth'
import { canEditActual } from '../utils/permissions'

/**
 * @param {string} secType - 'printing' / 'embroidery' / 'ironing' / 'template'
 * @param {object} [options]
 * @param {Function} [options.createFn] - 自定义 createSchedule 实现(默认走 /schedule/secondary POST)
 * @param {Function} [options.importFn] - 自定义 confirmImport(默认用 importSchedule('secondary', ...))
 * @param {string} [options.exportFilename] - 导出 CSV 文件名前缀
 */
export function useSecPlanDetail(secType, options = {}) {
  const cfg = getSecondaryTypeConfig(secType)
  const config = {
    createFn: options.createFn,
    importFn: options.importFn,
    exportFilename: options.exportFilename || `${cfg.title}排程`,
  }

  // [2026-06-19] 只有 印花/刺绣 显示裁剪二检数行(其它类型无来源)
  const showSecondInspection = ref(secType === 'printing' || secType === 'embroidery')

  // 虚拟滚动
  const vs = useVirtualScroll(38, 8)

  // 数据
  const planRows = ref([])
  const dateRange = ref([])

  // 筛选排序
  const textFilters = ref({})
  const numFilters = ref({})
  const sortState = ref({ field: '', sortBy: 'name', dir: 'asc' })

  function onTextFilter(field, f) { textFilters.value = { ...textFilters.value, [field]: { ...f, applied: true } } }
  function onNumFilter(field, f) { numFilters.value = { ...numFilters.value, [field]: { ...f, applied: true } } }
  function isFilterActive(field) {
    return !!textFilters.value[field]?.applied || !!numFilters.value[field]?.applied
  }
  function onSort(field, sortBy, dir) { sortState.value = { field, sortBy, dir } }

  const filteredPlanRows = computed(() => {
    let list = planRows.value.slice()
    for (const [field, f] of Object.entries(textFilters.value)) {
      if (!f || !f.applied) continue
      list = list.filter(r => {
        const val = r[field] || ''
        if (val && !f.checked.has(val)) return false
        if (!val && !f.includeEmpty) return false
        return true
      })
    }
    for (const [field, f] of Object.entries(numFilters.value)) {
      if (!f || !f.applied) continue
      list = list.filter(r => {
        const v = parseInt(r[field]) || 0
        if (f.min != null && v < f.min) return false
        if (f.max != null && v > f.max) return false
        return true
      })
    }
    if (sortState.value.field) {
      const { field, sortBy, dir } = sortState.value
      const mul = dir === 'asc' ? 1 : -1
      list.sort((a, b) => {
        let va, vb
        if (sortBy === 'number') { va = parseInt(a[field]) || 0; vb = parseInt(b[field]) || 0 }
        else { va = a[field] || ''; vb = b[field] || '' }
        return va < vb ? -mul : va > vb ? mul : 0
      })
    }
    return list
  })

  // 日期窗口导航
  const viewOffset = ref(0)
  function shiftWeek(dir) { viewOffset.value += dir * 7 }

  const today = todayLocal()  // [F-01 fix] 用本地日期工具
  const visibleDates = computed(() => {
    const d = new Date(today + 'T00:00:00')
    const ws = new Date(d); ws.setDate(ws.getDate() - 7 + viewOffset.value)
    const we = new Date(d); we.setDate(we.getDate() + 21 + viewOffset.value)
    const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const dates = []
    const cur = new Date(ws)
    while (cur <= we) { dates.push(fmt(cur)); cur.setDate(cur.getDate() + 1) }
    return dates
  })

  const dateRangeLabel = computed(() => {
    if (!visibleDates.value.length) return ''
    return visibleDates.value[0].slice(5) + ' ~ ' + visibleDates.value[visibleDates.value.length - 1].slice(5)
  })

  // 款号折叠
  const expandedSet = ref(new Set())
  function toggleCollapse(styleNo) {
    if (expandedSet.value.has(styleNo)) expandedSet.value.delete(styleNo)
    else expandedSet.value.add(styleNo)
    expandedSet.value = new Set(expandedSet.value)
  }
  function isCollapsed(styleNo) { return !expandedSet.value.has(styleNo) }
  function groupRowCount(styleNo) { return planRows.value.filter(r => r.style_no === styleNo).length }

  // 分组 + 汇总
  const groupedRows = computed(() => {
    const styleGroups = {}
    for (const r of filteredPlanRows.value) {
      if (!styleGroups[r.style_no]) styleGroups[r.style_no] = { product_name: r.product_name, rows: [] }
      styleGroups[r.style_no].rows.push(r)
    }
    const result = []
    let lastStyle = ''
    for (const r of filteredPlanRows.value) {
      const firstOfGroup = r.style_no !== lastStyle
      lastStyle = r.style_no
      if (firstOfGroup && !expandedSet.value.has(r.style_no)) {
        const group = styleGroups[r.style_no]
        const totalOrder = group.rows.reduce((s, x) => s + x.order_qty, 0)
        const totalPlan = group.rows.reduce((s, x) => s + x.totalPlan, 0)
        const totalActual = group.rows.reduce((s, x) => s + x.totalActual, 0)
        const totalSecondInspection = group.rows.reduce((s, x) => s + (x.totalSecondInspection || 0), 0)
        const dateMap = {}
        for (const rr of group.rows) {
          for (const dd of rr.dateData) {
            if (!dateMap[dd.date]) dateMap[dd.date] = { date: dd.date, plan: 0, actual: 0, secondInspection: 0, diff: 0 }
            dateMap[dd.date].plan += dd.plan
            dateMap[dd.date].actual += dd.actual
            dateMap[dd.date].secondInspection += dd.secondInspection || 0
            dateMap[dd.date].diff += dd.diff
          }
        }
        result.push({
          style_no: r.style_no, product_name: r.product_name,
          color: '', size_spec: '',
          order_qty: totalOrder, totalPlan, totalActual, totalSecondInspection,
          totalDiff: totalActual - totalPlan,
          dateMap, firstOfGroup: true, collapsed: true,
        })
        continue
      }
      if (!firstOfGroup && !expandedSet.value.has(r.style_no)) continue
      const dateMap = {}
      for (const dd of r.dateData) { dateMap[dd.date] = dd }
      const totalSecondInspection = r.dateData.reduce((s, dd) => s + (dd.secondInspection || 0), 0)
      result.push({ ...r, firstOfGroup, dateMap, totalSecondInspection })
    }
    return result
  })

  // 虚拟滚动切片
  const tableRows = computed(() => {
    const out = []
    for (const r of groupedRows.value) {
      const k = `${r.style_no}|${r.color}|${r.size_spec}`
      if (r.collapsed) {
        out.push({ ...r, _key: `sum_${k}`, _type: 'summary' })
      } else {
        out.push({ ...r, _key: `${k}|plan`, _type: 'plan' })
        out.push({ ...r, _key: `${k}|actual`, _type: 'actual' })
        // [2026-06-19] 印花/刺绣 加二检数行(从裁剪报工来,不在此页编辑)
        if (showSecondInspection.value) {
          out.push({ ...r, _key: `${k}|second`, _type: 'second' })
        }
        out.push({ ...r, _key: `${k}|diff`, _type: 'diff' })
      }
    }
    return out
  })
  const vtStartIndex = computed(() => Math.max(0, Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows))
  const vtVisibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
  const vtVisibleRows = computed(() => tableRows.value.slice(vtStartIndex.value, vtStartIndex.value + vtVisibleCount.value))

  // 加载数据
  async function load() {
    try {
      const apiMethod = api[cfg.api]
      if (!apiMethod) { console.error(`api.${cfg.api} not found`); return }
      const { data } = await apiMethod()
      planRows.value = data.rows || []
      dateRange.value = data.dateRange || []
    } catch (e) {
      console.error(`加载${cfg.title}数据失败:`, e)
      ElMessage.error(`加载${cfg.title}数据失败`)
    }
  }

  // 编辑模式
  const editingKey = ref(null)
  const editForm = ref({})

  function startEdit(row) {
    editingKey.value = `${row.style_no}|${row.color}|${row.size_spec}`
    editForm.value = {
      order_qty: row.order_qty,
      totalPlan: row.totalPlan,
      datePlans: {},
    }
    for (const d of visibleDates.value) {
      const dd = row.dateMap[d]
      editForm.value.datePlans[d] = dd ? dd.plan : 0
    }
  }

  function isEditing(row) {
    return editingKey.value === `${row.style_no}|${row.color}|${row.size_spec}`
  }

  function cancelEdit() {
    editingKey.value = null
    editForm.value = {}
  }

  // 保存计划编辑
  async function savePlanEdit(row) {
    const prevOrderQty = row.order_qty
    const prevTotalPlan = row.totalPlan
    const prevTotalDiff = row.totalDiff
    const prevDatePlans = {}
    for (const d of visibleDates.value) {
      const dd = row.dateMap[d]
      if (dd) { prevDatePlans[d] = { plan: dd.plan, diff: dd.diff } }
    }

    row.order_qty = editForm.value.order_qty
    let newTotal = 0
    for (const d of visibleDates.value) {
      const dd = row.dateMap[d]
      const newPlan = parseInt(editForm.value.datePlans[d]) || 0
      if (dd) {
        dd.plan = newPlan
        dd.diff = dd.actual - newPlan
      }
      newTotal += newPlan
    }
    row.totalPlan = newTotal
    row.totalDiff = row.totalActual - row.totalPlan

    try {
      await api.post(`/schedule/${secType}-daily-plan/plan`, {
        style_no: row.style_no,
        color: row.color,
        size_spec: row.size_spec,
        order_qty: row.order_qty,
        datePlans: editForm.value.datePlans,
      })
      ElMessage.success('保存成功')
    } catch (e) {
      row.order_qty = prevOrderQty
      row.totalPlan = prevTotalPlan
      row.totalDiff = prevTotalDiff
      for (const d of visibleDates.value) {
        const dd = row.dateMap[d]
        const prev = prevDatePlans[d]
        if (dd && prev) { dd.plan = prev.plan; dd.diff = prev.diff }
      }
      console.error('保存计划失败:', e)
      ElMessage.error('保存失败')
    }
    editingKey.value = null
    editForm.value = {}
  }

  // 保存实际产量
  async function saveActual(row, date) {
    const dd = row.dateMap?.[date]
    if (!dd) return
    // [2026-06-20] 权限检查:supervisor 必须匹配车间,planner/planning_manager 拒绝
    const auth = useAuthStore()
    const editableRow = { ...row, secondary_type: cfg.name, workshop: cfg.name }
    if (!canEditActual(editableRow, auth.user)) {
      ElMessage.warning('无权编辑该车间数据')
      return
    }
    const prevActual = dd.actual
    const prevDiff = dd.diff
    const prevTotalActual = row.totalActual
    const prevTotalDiff = row.totalDiff
    dd.diff = dd.actual - dd.plan
    row.totalActual = row.dateData.reduce((s, d) => s + d.actual, 0)
    row.totalDiff = row.totalActual - row.totalPlan
    try {
      await api.post('/schedule/sewing-daily-plan/actual', {
        style_no: row.style_no,
        color: row.color,
        size_spec: row.size_spec,
        production_date: date,
        completed_qty: dd.actual,
        secondary_type: cfg.name,
      })
    } catch (e) {
      dd.actual = prevActual
      dd.diff = prevDiff
      row.totalActual = prevTotalActual
      row.totalDiff = prevTotalDiff
      console.error('保存实际产量失败:', e)
      ElMessage.error('保存实际产量失败')
    }
  }

  function dateLabel(d) { return d ? d.slice(5) : '' }

  // 导出 CSV
  function doExport() {
    if (!planRows.value.length) { ElMessage.warning('暂无数据'); return }
    const headers = ['款号', '品名', '颜色', '尺码', '原单量', '合计(计划)', '合计(实际)', '合计(差异)', ...visibleDates.value.map(d => d.slice(5))]
    const lines = [headers.join(',')]
    for (const row of planRows.value) {
      const line = [
        row.style_no, row.product_name, row.color, row.size_spec,
        row.order_qty, row.totalPlan, row.totalActual, row.totalDiff,
        ...visibleDates.value.map(d => {
          const dd = row.dateData?.find(x => x.date === d)
          return dd ? dd.plan : ''
        })
      ]
      lines.push(line.map(v => `"${v ?? ''}"`).join(','))
    }
    const bom = '\uFEFF'  // UTF-8 BOM,Excel 打开不乱码
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${config.exportFilename}_${today}.csv`; a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }

  // 导入实际产量(统一走 importSchedule('secondary', ...))
  const importDialogVisible = ref(false)
  const importFile = ref(null)
  const importing = ref(false)
  const importMode = ref('skip')
  const importPreview = ref(null)

  function onImportFileChange(e) { importFile.value = e.target.files[0] }

  async function doImport() {
    if (!importFile.value) return
    if (importing.value) return
    importing.value = true
    try {
      const XLSX = await import('xlsx')
      const data = await importFile.value.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (rows.length < 2) { importing.value = false; return ElMessage.error('格式不正确') }
      const records = []
      for (const r of rows) {
        const styleNo = r['款号'] || r['style_no'] || ''
        const color = r['颜色'] || r['color'] || ''
        const sizeSpec = r['尺码'] || r['size_spec'] || r['规格'] || ''
        const date = r['日期'] || r['date'] || r['production_date'] || ''
        const qty = parseInt(r['数量'] || r['qty'] || r['completed_qty'] || 0)
        if (styleNo && date && qty > 0) {
          records.push({
            style_no: styleNo, color, size_spec: sizeSpec,
            production_date: date, completed_qty: qty,
            schedule_type: 'secondary', secondary_type: cfg.name,
          })
        }
      }
      importPreview.value = records
    } catch (e) {
      ElMessage.error('文件解析失败: ' + (e.message || '请检查格式'))
      importPreview.value = null
    }
    importing.value = false
  }

  async function confirmImport() {
    if (!importPreview.value?.length) return
    importing.value = true
    try {
      if (config.importFn) {
        // 自定义导入逻辑(printing/template 直接调 confirmPrintingPlan)
        await config.importFn(importPreview.value)
      } else {
        // 默认走 secondary 批量导入
        const { data } = await api.importSchedule('secondary', importPreview.value, importMode.value)
        ElMessage.success(`导入完成: ${data.imported} 条, 跳过 ${data.skipped} 条`)
      }
      importDialogVisible.value = false
      importPreview.value = null; importFile.value = null
      await load()
    } catch (e) {
      ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message))
    }
    importing.value = false
  }

  // 滚动到顶
  function scrollToTop() {
    const el = document.querySelector('.vt-container, .excel-body, .excel-wrap')
    if (el) el.scrollTop = 0
  }

  onMounted(() => { load() })

  return {
    // state
    vs, planRows, dateRange, today, visibleDates, dateRangeLabel, viewOffset,
    textFilters, numFilters, sortState,
    editingKey, editForm,
    filteredPlanRows, groupedRows, tableRows, vtStartIndex, vtVisibleCount, vtVisibleRows,
    importDialogVisible, importFile, importing, importMode, importPreview,
    expandedSet,
    // [2026-06-19] 二检数行
    showSecondInspection,
    // methods
    load, saveActual, savePlanEdit, startEdit, cancelEdit, isEditing,
    onTextFilter, onNumFilter, onSort, isFilterActive,
    toggleCollapse, isCollapsed, groupRowCount,
    shiftWeek, scrollToTop, dateLabel,
    onImportFileChange, doImport, confirmImport, doExport,
  }
}
